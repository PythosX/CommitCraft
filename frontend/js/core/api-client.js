/** Fetch wrapper for the CommitCraft API. Cookies only — no tokens in JS. */

import { APP_CONFIG } from '../config/app-config.js';
import { bus } from './event-bus.js';

let csrfToken = '';

export class ApiClientError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', details = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export function setCsrfToken(token) {
  csrfToken = token || '';
}

export function getCsrfToken() {
  return csrfToken;
}

function buildUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${APP_CONFIG.apiBase}${path}`;
}

export async function apiRequest(path, { method = 'GET', body, signal, headers = {} } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (csrfToken && method !== 'GET') requestHeaders['x-csrf-token'] = csrfToken;

  let response;
  try {
    response = await fetch(buildUrl(path), {
      method,
      credentials: 'include',
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiClientError(
      'Cannot reach the CommitCraft API. Check that the backend is running and the API URL is correct.',
      { code: 'NETWORK_ERROR' }
    );
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
    const error = new ApiClientError(payload?.error?.message || `Request failed (${response.status}).`, {
      status: response.status,
      code: payload?.error?.code || 'REQUEST_FAILED',
      details: payload?.error?.details || null,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
    });
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      bus.emit('auth:expired', error);
    }
    throw error;
  }

  return payload;
}

export const api = {
  get: (path, options) => apiRequest(path, { ...options, method: 'GET' }),
  post: (path, body, options) => apiRequest(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => apiRequest(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => apiRequest(path, { ...options, method: 'DELETE' }),
};
