/** Session authentication + CSRF verification for mutating requests. */

import { getSession, getSessionToken, readCookie, sessionCookieName } from '../storage/session-store.js';
import { ApiError } from './error-middleware.js';
import { timingSafeEqual } from '../utils/crypto.js';

export async function loadAuth(request, env, config) {
  const sessionId = readCookie(request, sessionCookieName(config));
  const session = await getSession(env, config, sessionId);
  if (!session) return { session: null, token: null, sessionId: null };
  const token = await getSessionToken(config, session);
  if (!token) return { session: null, token: null, sessionId: null };
  return { session, token, sessionId };
}

export function requireSession(auth) {
  if (!auth?.session) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Sign in with GitHub to continue.');
  }
  return auth;
}

/**
 * CSRF: a synchronizer token tied to the session. Cross-origin JavaScript
 * cannot read the token (CORS + no-store), so a forged request cannot supply it.
 */
export function assertCsrf(request, auth) {
  if (!auth?.session) return;
  const provided = request.headers.get('x-csrf-token') || '';
  if (!provided || !timingSafeEqual(provided, auth.session.csrfToken || '')) {
    throw new ApiError(403, 'CSRF_MISMATCH', 'Your session token is invalid. Refresh the page and retry.');
  }
}

/** Mutations must come from an allowed origin when the browser sends one. */
export function assertOrigin(request, config) {
  const origin = request.headers.get('origin');
  if (!origin) return; // non-browser client; CSRF token still required
  if (!config.allowedOrigins.includes(origin)) {
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed to call the API.');
  }
}
