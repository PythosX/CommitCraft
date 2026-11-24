/** Minimal structured logger — never logs tokens or file contents. */
const REDACTED_KEYS = /token|secret|password|authorization|cookie|content|code/i;

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = REDACTED_KEYS.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return output;
}

function emit(level, message, fields = {}) {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...(fields && typeof fields === 'object' ? redact(fields) : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  info: (message, fields) => emit('info', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  error: (message, fields) => emit('error', message, fields),
};

export function errorLogFields(error) {
  return {
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: error?.message,
    stack: error?.stack?.split('\n').slice(0, 4).join(' | '),
  };
}
