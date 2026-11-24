/** File reading, typing and preview helpers. */

import { APP_CONFIG } from '../config/app-config.js';
import { escapeHtml } from './format-utils.js';
import { extname } from './path-utils.js';

const KIND_BY_EXTENSION = {
  image: APP_CONFIG.imageExtensions,
  archive: APP_CONFIG.archiveExtensions,
  code: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'php', 'sh', 'sql'],
  style: ['css', 'scss', 'sass', 'less'],
  markup: ['html', 'htm', 'xml', 'svg'],
  data: ['json', 'yml', 'yaml', 'toml', 'csv'],
  doc: ['md', 'markdown', 'txt', 'pdf'],
};

export function fileKind(filePath) {
  const ext = extname(filePath);
  for (const [kind, extensions] of Object.entries(KIND_BY_EXTENSION)) {
    if (extensions.includes(ext)) return kind;
  }
  return 'file';
}

export function isTextFile(filePath) {
  return APP_CONFIG.textExtensions.includes(extname(filePath));
}

export function fileTypeLabel(filePath) {
  const ext = extname(filePath);
  return ext ? ext.toUpperCase() : 'FILE';
}

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file, limitBytes = 256 * 1024) {
  return new Promise((resolve) => {
    if (!isTextFile(file.name) || file.size > limitBytes) {
      resolve({ ok: false, reason: file.size > limitBytes ? 'too-large' : 'binary' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ ok: true, text: String(reader.result || '') });
    reader.onerror = () => resolve({ ok: false, reason: 'unreadable' });
    reader.readAsText(file.slice(0, limitBytes));
  });
}

export function base64ToText(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/** Lightweight syntax tinting for previews — never executes file content. */
export function highlightPreview(text) {
  return escapeHtml(text);
}

export function isProbablyBinary(name, sampleBase64) {
  if (isTextFile(name)) return false;
  if (!sampleBase64) return false;
  const sample = sampleBase64.slice(0, 200);
  return sample.includes('\u0000') || fileKind(name) === 'image' || fileKind(name) === 'archive';
}

export function fileIconName(filePath) {
  const kind = fileKind(filePath);
  if (kind === 'image') return 'file-image';
  if (kind === 'archive') return 'file-archive';
  if (kind === 'code' || kind === 'style' || kind === 'markup') return 'file-code';
  if (kind === 'doc') return 'file-text';
  if (kind === 'data') return 'file-json';
  return 'file';
}
