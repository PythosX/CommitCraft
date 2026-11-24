/** Crypto helpers: session ids, token encryption, Git blob hashing. */

const encoder = new TextEncoder();

export function randomId(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64StringToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(secret, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 60000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypts a GitHub access token before it is written to KV. */
export async function encryptText(plainText, secret) {
  if (!plainText) return null;
  const salt = randomId(16);
  const key = await deriveKey(secret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plainText));
  return { v: 1, salt, iv: base64UrlEncode(iv), data: base64UrlEncode(new Uint8Array(cipher)) };
}

export async function decryptText(payload, secret) {
  if (!payload || typeof payload !== 'object' || !payload.data) return null;
  const key = await deriveKey(secret, payload.salt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64StringToBytes(payload.iv) },
    key,
    base64StringToBytes(payload.data)
  );
  return new TextDecoder().decode(plain);
}

export function base64ToBytes(base64) {
  return base64StringToBytes(base64);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Computes the Git object id of a blob exactly like `git hash-object`.
 * Used to detect a file that was already committed before a crash.
 */
export async function gitBlobSha(base64Content) {
  const bytes = base64ToBytes(base64Content);
  const header = encoder.encode(`blob ${bytes.length}\u0000`);
  const combined = new Uint8Array(header.length + bytes.length);
  combined.set(header, 0);
  combined.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', combined);
  return toHex(digest);
}

export function timingSafeEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
