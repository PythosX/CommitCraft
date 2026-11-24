/** Small KV helpers with JSON encoding and optional TTL. */

function requireNamespace(namespace, label) {
  if (!namespace || typeof namespace.get !== 'function') {
    const error = new Error(`Storage binding "${label}" is not configured`);
    error.status = 500;
    error.code = 'STORAGE_MISSING';
    throw error;
  }
  return namespace;
}

export async function kvGetJSON(namespace, key) {
  if (!namespace) return null;
  const raw = await namespace.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function kvPutJSON(namespace, key, value, { ttlSeconds } = {}) {
  const ns = requireNamespace(namespace, 'KV');
  const options = ttlSeconds ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : undefined;
  await ns.put(key, JSON.stringify(value), options);
  return value;
}

export async function kvDelete(namespace, key) {
  if (!namespace) return;
  await namespace.delete(key);
}

export async function kvListKeys(namespace, prefix, limit = 100) {
  if (!namespace) return [];
  const result = await namespace.list({ prefix, limit });
  return (result?.keys || []).map((key) => key.name);
}

export function encodeKeyPart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}
