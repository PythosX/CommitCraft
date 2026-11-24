/**
 * Fixed-window rate limiting on KV.
 * KV is eventually consistent, so limits are approximate — enough to blunt
 * abuse and runaway retry loops while keeping V1 free to run.
 */

import { storageBindings } from '../config/env.js';
import { ApiError } from './error-middleware.js';

function clientKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  return String(ip).split(',')[0].trim().replace(/[^a-zA-Z0-9.:_-]/g, '');
}

export async function enforceRateLimit(env, request, { bucket, limit, windowSeconds, userId }) {
  const namespace = storageBindings(env).sessions;
  if (!namespace) return;

  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rate:${bucket}:${userId || clientKey(request)}:${window}`;
  let count = 1;
  try {
    const raw = await namespace.get(key);
    count = (Number.parseInt(raw || '0', 10) || 0) + 1;
    await namespace.put(key, String(count), { expirationTtl: windowSeconds + 5 });
  } catch {
    return; // never block traffic because the limiter itself failed
  }

  if (count > limit) {
    const error = new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and retry.');
    error.retryAfter = windowSeconds;
    throw error;
  }
}

export const LIMITS = {
  read: { bucket: 'read', limit: 120, windowSeconds: 60 },
  write: { bucket: 'write', limit: 30, windowSeconds: 60 },
  publish: { bucket: 'publish', limit: 120, windowSeconds: 60 },
  auth: { bucket: 'auth', limit: 20, windowSeconds: 60 },
};
