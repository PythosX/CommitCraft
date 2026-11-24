/** Server-side session storage. GitHub tokens are encrypted at rest. */

import { decryptText, encryptText, randomId } from '../utils/crypto.js';
import { kvDelete, kvGetJSON, kvPutJSON } from './kv.js';
import { storageBindings } from '../config/env.js';

const PREFIX = 'session:';

export function sessionCookieName(config) {
  return config.isProduction ? '__Host-cc_session' : 'cc_session';
}

function cookieSecurity(config) {
  // __Host- cookies must be Secure + Path=/ + no Domain, so only use them on HTTPS.
  return config.isProduction ? 'Secure; SameSite=None' : 'SameSite=Lax';
}

export function buildSessionCookie(sessionId, config, maxAge = config.sessionTtlSeconds) {
  return [
    `${sessionCookieName(config)}=${sessionId}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAge}`,
    cookieSecurity(config),
  ].join('; ');
}

export function clearSessionCookie(config) {
  return [buildSessionCookie('', config, 0), 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'].join('; ');
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    if (trimmed.slice(0, index) === name) return decodeURIComponent(trimmed.slice(index + 1));
  }
  return null;
}

export async function createSession(env, config, { token, user }) {
  const bindings = storageBindings(env);
  const sessionId = randomId(32);
  const session = {
    id: sessionId,
    userId: user.id,
    csrfToken: randomId(24),
    createdAt: Date.now(),
    expiresAt: Date.now() + config.sessionTtlSeconds * 1000,
    user: {
      id: user.id,
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      htmlUrl: user.html_url,
    },
    token: await encryptText(token, config.sessionSecret || config.encryptionKey),
  };
  await kvPutJSON(bindings.sessions, `${PREFIX}${sessionId}`, session, {
    ttlSeconds: config.sessionTtlSeconds,
  });
  return session;
}

export async function getSession(env, config, sessionId) {
  if (!sessionId) return null;
  const bindings = storageBindings(env);
  const session = await kvGetJSON(bindings.sessions, `${PREFIX}${sessionId}`);
  if (!session) return null;
  if (!session.expiresAt || session.expiresAt < Date.now()) {
    await kvDelete(bindings.sessions, `${PREFIX}${sessionId}`);
    return null;
  }
  return session;
}

export async function getSessionToken(config, session) {
  if (!session?.token) return null;
  try {
    return await decryptText(session.token, config.sessionSecret || config.encryptionKey);
  } catch {
    return null;
  }
}

export async function destroySession(env, sessionId) {
  if (!sessionId) return;
  const bindings = storageBindings(env);
  await kvDelete(bindings.sessions, `${PREFIX}${sessionId}`);
}

export function startSessionRefresh(env, config, session) {
  const bindings = storageBindings(env);
  const ttl = config.sessionTtlSeconds;
  return kvPutJSON(bindings.sessions, `${PREFIX}${session.id}`, session, { ttlSeconds: ttl });
}
