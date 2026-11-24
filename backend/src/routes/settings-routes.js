/** Per-user settings (stored per account, never in the browser as secrets). */

import { requireSession } from '../middleware/auth-middleware.js';
import { ApiError } from '../middleware/error-middleware.js';
import { LIMITS, enforceRateLimit } from '../middleware/rate-limit.js';
import { storageBindings } from '../config/env.js';
import { kvGetJSON, kvPutJSON } from '../storage/kv.js';
import { enumValue, requireObject } from '../utils/validation.js';

export const DEFAULT_SETTINGS = {
  theme: 'system',
  defaultTemplate: 'add',
  publishMode: 'standard',
  ignorePatterns: [],
  defaultFileFilters: ['node_modules', '.git', 'dist', 'build', '.env'],
};

const TEMPLATES = ['add', 'create', 'update', 'folder'];
const THEMES = ['dark', 'light', 'system'];
const MODES = ['standard', 'careful'];

function settingsKey(userId) {
  return `settings:${userId}`;
}

function sanitizePatterns(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, 'VALIDATION_ERROR', `"${field}" must be an array.`);
  if (value.length > 50) throw new ApiError(400, 'VALIDATION_ERROR', `Too many entries in "${field}".`);
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, 120));
}

export async function handleSettingsRoutes(ctx) {
  const { method, url, auth, request, env, body } = ctx;
  if (url.pathname !== '/api/settings') return null;
  requireSession(auth);
  const userId = auth.session.user.id;

  if (method === 'GET') {
    await enforceRateLimit(env, request, { ...LIMITS.read, userId });
    const stored = (await kvGetJSON(storageBindings(env).sessions, settingsKey(userId))) || {};
    return ctx.respond({
      settings: { ...DEFAULT_SETTINGS, ...stored },
      account: {
        login: auth.session.user.login,
        name: auth.session.user.name,
        avatarUrl: auth.session.user.avatarUrl,
        htmlUrl: auth.session.user.htmlUrl,
        scopes: auth.session.scopes || '',
      },
      session: {
        createdAt: new Date(auth.session.createdAt).toISOString(),
        expiresAt: new Date(auth.session.expiresAt).toISOString(),
      },
    });
  }

  if (method === 'PUT' || method === 'PATCH') {
    await enforceRateLimit(env, request, { ...LIMITS.write, userId });
    const payload = requireObject(body);
    const stored = (await kvGetJSON(storageBindings(env).sessions, settingsKey(userId))) || {};

    const next = {
      ...DEFAULT_SETTINGS,
      ...stored,
      ...(payload.theme !== undefined && { theme: enumValue(payload.theme, THEMES, 'theme') }),
      ...(payload.defaultTemplate !== undefined && {
        defaultTemplate: enumValue(payload.defaultTemplate, TEMPLATES, 'defaultTemplate'),
      }),
      ...(payload.publishMode !== undefined && {
        publishMode: enumValue(payload.publishMode, MODES, 'publishMode'),
      }),
      ...(payload.ignorePatterns !== undefined && {
        ignorePatterns: sanitizePatterns(payload.ignorePatterns, 'ignorePatterns'),
      }),
      ...(payload.defaultFileFilters !== undefined && {
        defaultFileFilters: sanitizePatterns(payload.defaultFileFilters, 'defaultFileFilters'),
      }),
      updatedAt: new Date().toISOString(),
    };

    await kvPutJSON(storageBindings(env).sessions, settingsKey(userId), next);
    return ctx.respond({ settings: next });
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or PUT for this endpoint.');
}
