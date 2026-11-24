/** Minimal in-memory KV namespace matching the Workers KV binding surface. */

export function createFakeKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, options = {}) {
      store.set(key, {
        value: String(value),
        expiresAt: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null,
      });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit);
      return { keys: keys.map((name) => ({ name })), list_complete: true };
    },
  };
}
