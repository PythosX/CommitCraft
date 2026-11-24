/** GitHub OAuth routes. Tokens are encrypted server-side and never sent to the browser. */

import { requireConfig, storageBindings } from '../config/env.js';
import { assertCsrf } from '../middleware/auth-middleware.js';
import { ApiError } from '../middleware/error-middleware.js';
import { LIMITS, enforceRateLimit } from '../middleware/rate-limit.js';
import {
  buildAuthorizeUrl,
  createOAuthState,
  exchangeCodeForToken,
  fetchGitHubUser,
  validateState,
} from '../services/oauth-service.js';
import { kvDelete, kvGetJSON, kvPutJSON } from '../storage/kv.js';
import {
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  destroySession,
  readCookie,
  sessionCookieName,
} from '../storage/session-store.js';
import { redirect } from '../utils/response.js';

const STATE_PREFIX = 'oauth:';
const STATE_COOKIE = 'cc_oauth_state';

function stateCookie(value, config, maxAge) {
  const attributes = ['Path=/', 'HttpOnly', `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if (config.isProduction) attributes.unshift('Secure');
  return [`${STATE_COOKIE}=${value}`, ...attributes].join('; ');
}

function frontendRedirect(config, path, params = {}) {
  const url = new URL(path, `${config.frontendUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return redirect(url.toString());
}

async function startOAuth(ctx) {
  const { request, env, config } = ctx;
  requireConfig(config, ['clientId', 'clientSecret', 'callbackUrl']);
  await enforceRateLimit(env, request, LIMITS.auth);

  const state = createOAuthState();
  const bindings = storageBindings(env);
  await kvPutJSON(bindings.sessions, `${STATE_PREFIX}${state}`, { createdAt: Date.now() }, {
    ttlSeconds: config.oauthStateTtlSeconds,
  });

  const headers = new Headers({
    'cache-control': 'no-store',
    'set-cookie': stateCookie(state, config, config.oauthStateTtlSeconds),
  });
  return new Response(null, {
    status: 302,
    headers: { ...Object.fromEntries(headers), location: buildAuthorizeUrl(config, state) },
  });
}

async function completeOAuth(ctx) {
  const { request, env, config, url } = ctx;
  requireConfig(config, ['clientId', 'clientSecret', 'callbackUrl']);

  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    return frontendRedirect(config, '/index.html', {
      auth_error: errorParam === 'access_denied' ? 'access_denied' : 'github_error',
    });
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = readCookie(request, STATE_COOKIE);
  const bindings = storageBindings(env);
  const stored = state ? await kvGetJSON(bindings.sessions, `${STATE_PREFIX}${state}`) : null;

  if (!code || !state || !stored || !validateState(state, cookieState)) {
    return frontendRedirect(config, '/index.html', { auth_error: 'state_mismatch' });
  }
  await kvDelete(bindings.sessions, `${STATE_PREFIX}${state}`);

  try {
    const { token, scope } = await exchangeCodeForToken(config, code);
    const user = await fetchGitHubUser(env, token);
    const session = await createSession(env, config, { token, user });
    session.scopes = scope;

    const headers = new Headers({ 'cache-control': 'no-store' });
    headers.append('set-cookie', buildSessionCookie(session.id, config));
    headers.append('set-cookie', stateCookie('', config, 0));
    headers.set('location', new URL('/dashboard.html?connected=1', `${config.frontendUrl}/`).toString());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    ctx.log?.('oauth_failed', { code: error.code });
    return frontendRedirect(config, '/index.html', { auth_error: 'exchange_failed' });
  }
}

async function logout(ctx) {
  const { request, env, config, auth } = ctx;
  assertCsrf(request, auth);
  await destroySession(env, auth.sessionId);
  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
      'set-cookie': clearSessionCookie(config),
    },
  });
}

function sessionInfo(ctx) {
  const { auth, config } = ctx;
  if (!auth?.session) {
    return ctx.respond({ authenticated: false });
  }
  return ctx.respond({
    authenticated: true,
    user: auth.session.user,
    csrfToken: auth.session.csrfToken,
    scopes: auth.session.scopes || '',
    expiresAt: new Date(auth.session.expiresAt).toISOString(),
    secureCookies: config.isProduction,
  });
}

export async function handleAuthRoutes(ctx) {
  const { method, url } = ctx;
  const path = url.pathname;

  if (path === '/api/auth/github') {
    if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    return startOAuth(ctx);
  }
  if (path === '/api/auth/github/callback') {
    if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    return completeOAuth(ctx);
  }
  if (path === '/api/auth/session') {
    if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    return sessionInfo(ctx);
  }
  if (path === '/api/auth/logout') {
    if (method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST for this endpoint.');
    if (!ctx.auth?.session) return ctx.respond({ ok: true });
    return logout(ctx);
  }
  return null;
}

export { sessionCookieName };
