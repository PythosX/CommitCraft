/**
 * Environment configuration.
 * Every value is validated once per request so a misconfigured deployment
 * fails loudly with a clear message instead of silently misbehaving.
 */

const DEFAULTS = {
  sessionTtlSeconds: 60 * 60 * 24 * 14,
  oauthStateTtlSeconds: 60 * 10,
  publishBatchSize: 4,
  maxJobBytes: 25 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxFilesPerJob: 200,
  jobTtlSeconds: 60 * 60 * 24 * 7,
};

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function getConfig(env = {}) {
  const frontendUrl = trimTrailingSlash(env.FRONTEND_URL || 'http://localhost:3000');
  const extraOrigins = String(env.EXTRA_ORIGINS || '')
    .split(',')
    .map((origin) => trimTrailingSlash(origin.trim()))
    .filter(Boolean);

  return {
    frontendUrl,
    allowedOrigins: Array.from(new Set([frontendUrl, ...extraOrigins])),
    clientId: env.GITHUB_CLIENT_ID || '',
    clientSecret: env.GITHUB_CLIENT_SECRET || '',
    callbackUrl: env.GITHUB_CALLBACK_URL || `${frontendUrl}/api/auth/github/callback`,
    sessionSecret: env.SESSION_SECRET || '',
    encryptionKey: env.ENCRYPTION_KEY || '',
    isProduction: String(env.ENVIRONMENT || '').toLowerCase() === 'production',
    sessionTtlSeconds: int(env.SESSION_TTL_SECONDS, DEFAULTS.sessionTtlSeconds),
    oauthStateTtlSeconds: DEFAULTS.oauthStateTtlSeconds,
    publishBatchSize: Math.min(int(env.PUBLISH_BATCH_SIZE, DEFAULTS.publishBatchSize), 20),
    maxJobBytes: int(env.MAX_JOB_BYTES, DEFAULTS.maxJobBytes),
    maxFileBytes: int(env.MAX_FILE_BYTES, DEFAULTS.maxFileBytes),
    maxFilesPerJob: Math.min(int(env.MAX_FILES_PER_JOB, DEFAULTS.maxFilesPerJob), 500),
    jobTtlSeconds: DEFAULTS.jobTtlSeconds,
    userAgent: 'CommitCraft/1.0',
  };
}

/** Throws when a required secret is missing so failures are unambiguous. */
export function requireConfig(config, keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length > 0) {
    const error = new Error(`Server is missing required configuration: ${missing.join(', ')}`);
    error.status = 500;
    error.code = 'CONFIG_MISSING';
    throw error;
  }
  return config;
}

export function storageBindings(env) {
  const fallback = env.KV;
  return {
    sessions: env.SESSIONS || fallback,
    jobs: env.JOBS || fallback,
    history: env.HISTORY || fallback,
  };
}
