/** GitHub session state. The GitHub token never reaches this code. */

import { api, setCsrfToken } from './api-client.js';
import { bus } from './event-bus.js';
import { APP_CONFIG } from '../config/app-config.js';

let cachedSession = null;
let inflight = null;

export async function loadSession({ force = false } = {}) {
  if (cachedSession && !force) return cachedSession;
  if (inflight) return inflight;

  inflight = api
    .get('/api/auth/session')
    .then((session) => {
      cachedSession = session;
      if (session?.csrfToken) setCsrfToken(session.csrfToken);
      bus.emit('auth:changed', session);
      return session;
    })
    .catch((error) => {
      cachedSession = { authenticated: false, error };
      return cachedSession;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function getSession() {
  return cachedSession;
}

export function isAuthenticated() {
  return Boolean(cachedSession?.authenticated);
}

export function signIn() {
  window.location.href = `${APP_CONFIG.apiBase}/api/auth/github`;
}

export async function requireAuth() {
  const session = await loadSession();
  if (!session.authenticated) {
    const next = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);
    window.location.replace(`${APP_CONFIG.pages.landing}?auth=required&next=${next}`);
    throw new Error('AUTH_REQUIRED');
  }
  return session;
}

export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    /* the session is cleared locally regardless */
  }
  cachedSession = { authenticated: false };
  setCsrfToken('');
  window.location.href = APP_CONFIG.pages.landing;
}

bus.on('auth:expired', () => {
  cachedSession = { authenticated: false };
  const current = window.location.pathname.split('/').pop();
  if (current === APP_CONFIG.pages.landing) return;
  window.location.replace(`${APP_CONFIG.pages.landing}?auth=expired`);
});
