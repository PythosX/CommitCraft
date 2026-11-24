/**
 * File analysis: gitignore-style filtering, sensitive-file detection,
 * summaries and previews. Runs entirely in the browser on user data.
 */

import { APP_CONFIG } from '../config/app-config.js';
import { basename, folderOf, extname } from '../utils/path-utils.js';
import { formatBytes } from '../utils/format-utils.js';

const SENSITIVE_PATTERNS = [
  /^\.env$/i,
  /^\.env\.(?!example$|sample$|template$)[\w.-]+$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.?git-credentials$/i,
  /^secrets?\.(json|ya?ml|toml)$/i,
  /^credentials(\.json)?$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^serviceaccount.*\.json$/i,
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Converts a gitignore-lite pattern into a matcher. */
export function compilePattern(pattern) {
  let value = String(pattern || '').trim();
  if (!value || value.startsWith('#')) return null;
  const negate = value.startsWith('!');
  if (negate) value = value.slice(1);
  value = value.replace(/\/+$/, '');
  if (!value) return null;

  const anchored = value.includes('/');
  const segments = value.split('/').map((segment) => {
    if (segment === '**') return '.*';
    return escapeRegExp(segment).replace(/\\\*/g, '[^/]*').replace(/\?/g, '[^/]');
  });
  let source = segments.join('/');
  source = anchored ? `^${source}` : `(?:^|/)${source}`;
  return {
    pattern,
    negate,
    regex: new RegExp(`${source}(?:/|$)`, 'i'),
  };
}

export function findIgnoreMatch(filePath, patterns) {
  let matched = null;
  for (const pattern of patterns) {
    const compiled = typeof pattern === 'string' ? compilePattern(pattern) : pattern;
    if (!compiled) continue;
    if (compiled.regex.test(filePath)) matched = compiled;
  }
  if (!matched || matched.negate) return null;
  return matched.pattern;
}

export function isSensitivePath(filePath) {
  const name = basename(filePath);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
}

export function allIgnorePatterns(customPatterns = [], useDefaults = true) {
  const base = useDefaults ? APP_CONFIG.defaultIgnore : [];
  return [...base, ...customPatterns]
    .map((pattern) => String(pattern || '').trim())
    .filter(Boolean);
}

/**
 * Applies ignore rules to the file model. Files the user explicitly restored
 * keep their override until rules change and they no longer match.
 */
export function applyIgnoreRules(files, { customPatterns = [], useDefaults = true } = {}) {
  const patterns = allIgnorePatterns(customPatterns, useDefaults).map(compilePattern).filter(Boolean);

  for (const file of files) {
    if (file.oversized) {
      file.excluded = true;
      file.excludeReason = `Exceeds the ${formatBytes(APP_CONFIG.maxFileBytes)} file limit`;
      file.selected = false;
      file.locked = true;
      continue;
    }
    if (file.sensitive) {
      file.excluded = true;
      file.excludeReason = 'Secret file — never published';
      file.selected = false;
      file.locked = true;
      continue;
    }
    if (file.manualInclude) {
      file.excluded = false;
      file.excludeReason = '';
      file.locked = false;
      continue;
    }
    if (!file.content) {
      file.excluded = true;
      file.excludeReason = file.skipReason || 'Not loaded — workspace size limit';
      file.selected = false;
      file.locked = true;
      continue;
    }
    const match = findIgnoreMatch(file.path, patterns);
    if (match) {
      file.excluded = true;
      file.excludeReason = `Ignored by "${match}"`;
      file.selected = false;
      file.locked = false;
    } else {
      file.excluded = false;
      file.excludeReason = '';
      file.locked = false;
    }
  }

  return summarize(files);
}

export function restoreFile(file) {
  if (file.locked || !file.content) return false;
  file.manualInclude = true;
  file.excluded = false;
  file.excludeReason = '';
  file.selected = true;
  return true;
}

export function isSelectable(file) {
  return !file.excluded && Boolean(file.content) && !file.locked;
}

export function summarize(files) {
  const selected = files.filter((file) => file.selected && !file.excluded);
  const excluded = files.filter((file) => file.excluded);
  const folders = new Set();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'));
    }
  }
  return {
    totalFiles: files.length,
    totalBytes: files.reduce((total, file) => total + (file.size || 0), 0),
    folders: folders.size,
    selectedFiles: selected.length,
    selectedBytes: selected.reduce((total, file) => total + (file.size || 0), 0),
    excludedFiles: excluded.length,
    excludedBytes: excluded.reduce((total, file) => total + (file.size || 0), 0),
  };
}

export function selectionWithinLimits(files) {
  const selected = files.filter((file) => file.selected && !file.excluded);
  if (selected.length === 0) return { ok: false, message: 'Select at least one file to continue.' };
  if (selected.length > APP_CONFIG.maxFiles) {
    return {
      ok: false,
      message: `Select at most ${APP_CONFIG.maxFiles} files per publishing job.`,
    };
  }
  const bytes = selected.reduce((total, file) => total + (file.size || 0), 0);
  if (bytes > APP_CONFIG.maxJobBytes) {
    return {
      ok: false,
      message: `Selected files exceed ${formatBytes(APP_CONFIG.maxJobBytes)}. Deselect some files.`,
    };
  }
  return { ok: true, message: '' };
}

export function typeBreakdown(files) {
  const counts = new Map();
  for (const file of files) {
    const ext = extname(file.path) || 'other';
    counts.set(ext, (counts.get(ext) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

export function searchFiles(files, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return files;
  return files.filter((file) => file.path.toLowerCase().includes(term));
}

export function sortFiles(files, mode = 'path') {
  const sorted = [...files];
  if (mode === 'size') sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (mode === 'type') sorted.sort((a, b) => extname(a.path).localeCompare(extname(b.path)) || a.path.localeCompare(b.path));
  else sorted.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return sorted;
}

export function folderLabel(filePath) {
  return folderOf(filePath);
}

export function fileSummaryLine(files) {
  const stats = summarize(files);
  return `${stats.selectedFiles} of ${stats.totalFiles} files · ${formatBytes(stats.selectedBytes)}`;
}
