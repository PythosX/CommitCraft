/**
 * CommitCraft API — Cloudflare Worker entry point.
 *
 * A tiny hand-rolled router keeps cold starts fast and the dependency surface
 * at zero. Every /api response is JSON, no-store, and CORS-restricted to the
 * configured frontend origin.
 */

import { getConfig } from './config/env.js';
import { assertCsrf, assertOrigin, loadAuth } from './middleware/auth-middleware.js';
import { corsPreflight, isAllowedOrigin } from './middleware/cors-middleware.js';
import { ApiError, handleError } from './middleware/error-middleware.js';
import { handleAuthRoutes } from './routes/auth-routes.js';
import { handleGithubRoutes } from './routes/github-routes.js';
import { handleHistoryRoutes } from './routes/history-routes.js';
import { handlePublishingRoutes } from './routes/publishing-routes.js';
import { handleSettingsRoutes } from './routes/settings-routes.js';
import { fail } from './utils/response.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_ROUTES = new Set([
  '/api/health',
  '/api/auth/github',
  '/api/auth/github/callback',
  '/api/auth/session',
  '/api/auth/logout',
]);

async function readJsonBody(request, config) {
  const contentType = request.headers.get('content-type') || '';
  const declaredLength = Number.parseInt(request.headers.get('content-length') || '0', 10);
  if (declaredLength && declaredLength > config.maxJobBytes + 1024 * 1024) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'This upload exceeds the maximum size for a publishing job.');
  }

  const raw = await request.text();
  // Body-less POSTs (start / resume / retry / cancel / logout) are valid.
  if (!raw) return {};
  if (raw.length > config.maxJobBytes + 1024 * 1024) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'This upload exceeds the maximum size for a publishing job.');
  }
  if (!contentType.includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
}

export async function handleRequest(request, env) {
  const config = getConfig(env);
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  const requestId = crypto.randomUUID();

  const base = { origin, allowedOrigins: config.allowedOrigins };
  const respond = (data, options = {}) =>
    new Response(JSON.stringify(data), {
      status: options.status || 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-request-id': requestId,
        ...(base.allowedOrigins.includes(origin)
          ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
          : {}),
        vary: 'Origin',
        ...(options.headers || {}),
      },
    });

  if (request.method === 'OPTIONS') return corsPreflight(request, config);

  if (url.pathname === '/api/health') {
    return respond({ ok: true, service: 'commitcraft-api', version: '1.0.0', time: new Date().toISOString() });
  }

  if (!url.pathname.startsWith('/api/')) {
    return respond(
      { error: { code: 'NOT_FOUND', message: 'CommitCraft API. See /api/health.' } },
      { status: 404 }
    );
  }

  if (!isAllowedOrigin(request, config)) {
    return fail(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed to call the API.', base);
  }

  const ctx = {
    request,
    env,
    config,
    url,
    method: request.method,
    origin: base.origin,
    respond,
    body: undefined,
    auth: null,
    log: () => {},
  };

  try {
    ctx.auth = await loadAuth(request, env, config);

    // CSRF + origin checks for state-changing requests (except the OAuth handshake).
    if (MUTATING.has(request.method) && !PUBLIC_ROUTES.has(url.pathname)) {
      assertOrigin(request, config);
      assertCsrf(request, ctx.auth);
    }

    const needsBody =
      request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH';
    if (needsBody && !PUBLIC_ROUTES.has(url.pathname)) {
      ctx.body = await readJsonBody(request, config);
    }

    const handlers = [
      handleAuthRoutes,
      handleHistoryRoutes,
      handleSettingsRoutes,
      handleGithubRoutes,
      handlePublishingRoutes,
    ];

    for (const handler of handlers) {
      const response = await handler(ctx);
      if (response) {
        response.headers.set('x-request-id', requestId);
        return response;
      }
    }

    throw new ApiError(404, 'NOT_FOUND', 'That API endpoint does not exist.');
  } catch (error) {
    return handleError(error, {
      origin: base.origin,
      allowedOrigins: base.allowedOrigins,
      requestId,
      path: url.pathname,
    });
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
