/**
 * File path validation. Never trust a path that arrives from a browser:
 * GitHub will happily create a tree entry named "../x" or "a//b".
 */

const MAX_PATH_LENGTH = 400;
const SEGMENT_RE = /^[^<>:"|?*\u0000-\u001f\\/]+$/;

/** Names that must never be published by accident. */
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

const BLOCKED_SEGMENTS = new Set(['.git', '.hg', '.svn']);

export class PathValidationError extends Error {
  constructor(message, code = 'INVALID_PATH', status = 400) {
    super(message);
    this.name = 'PathValidationError';
    this.code = code;
    this.status = status;
  }
}

export function isSensitivePath(filePath) {
  const name = String(filePath).split('/').pop() || '';
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Normalizes and validates a repository-relative path.
 * @returns {string} normalized path using forward slashes
 */
export function validateFilePath(input) {
  if (typeof input !== 'string') {
    throw new PathValidationError('File path must be a string');
  }
  const raw = input.trim();
  if (!raw) throw new PathValidationError('File path cannot be empty');
  if (raw.length > MAX_PATH_LENGTH) {
    throw new PathValidationError('File path is too long (max 400 characters)');
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new PathValidationError('Absolute paths are not allowed', 'ABSOLUTE_PATH');
  }
  if (raw.includes('\\')) {
    throw new PathValidationError('Backslashes are not allowed in file paths');
  }
  if (raw.includes('\u0000')) {
    throw new PathValidationError('Null bytes are not allowed in file paths');
  }

  const segments = raw.split('/');
  const normalized = [];
  for (const segment of segments) {
    if (!segment || segment === '.') {
      throw new PathValidationError('File paths cannot contain empty or "." segments', 'DOT_SEGMENT');
    }
    if (segment === '..') {
      throw new PathValidationError('Path traversal ("..") is not allowed', 'PATH_TRAVERSAL');
    }
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) {
      throw new PathValidationError(`"${segment}" paths cannot be published`, 'BLOCKED_SEGMENT');
    }
    if (!SEGMENT_RE.test(segment)) {
      throw new PathValidationError(`Invalid characters in path segment "${segment}"`, 'INVALID_PATH');
    }
    normalized.push(segment);
  }

  const joined = normalized.join('/');
  if (normalized.length > 20) {
    throw new PathValidationError('File path is nested too deeply (max 20 levels)');
  }
  if (isSensitivePath(joined)) {
    throw new PathValidationError(
      `"${joined}" looks like a secret file. Remove it from the publishing plan or rename it.`,
      'SENSITIVE_FILE'
    );
  }
  return joined;
}

export function validateRepoName(name) {
  if (typeof name !== 'string') throw new PathValidationError('Repository name is required', 'INVALID_REPO');
  const value = name.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(value)) {
    throw new PathValidationError(
      'Repository names may only contain letters, numbers, dots, hyphens and underscores',
      'INVALID_REPO'
    );
  }
  if (value === '.' || value === '..' || value.endsWith('.git')) {
    throw new PathValidationError('That repository name is not allowed', 'INVALID_REPO');
  }
  return value;
}

export function validateOwner(owner) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner.trim())) {
    throw new PathValidationError('Invalid GitHub account name', 'INVALID_OWNER');
  }
  return owner.trim();
}

export function validateBranchName(branch) {
  if (typeof branch !== 'string') throw new PathValidationError('Branch name is required', 'INVALID_BRANCH');
  const value = branch.trim();
  if (value.length < 1 || value.length > 255) {
    throw new PathValidationError('Branch name must be 1-255 characters', 'INVALID_BRANCH');
  }
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[\s~^:?*[\]\\\u0000-\u001f]/.test(value)
  ) {
    throw new PathValidationError('That branch name is not valid for Git', 'INVALID_BRANCH');
  }
  return value;
}
