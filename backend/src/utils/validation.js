/** Request payload validation helpers. */

import { validateBranchName, validateFilePath, validateOwner, validateRepoName } from './path-validator.js';

export class ValidationError extends Error {
  constructor(message, { code = 'VALIDATION_ERROR', status = 400, details } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireObject(value, label = 'body') {
  if (!isPlainObject(value)) {
    throw new ValidationError(`Request ${label} must be a JSON object`);
  }
  return value;
}

export function requireString(value, field, { min = 1, max = 200, pattern } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`"${field}" is required`, { details: { field } });
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new ValidationError(`"${field}" must be at least ${min} character(s)`, { details: { field } });
  }
  if (trimmed.length > max) {
    throw new ValidationError(`"${field}" must be at most ${max} characters`, { details: { field } });
  }
  if (pattern && !pattern.test(trimmed)) {
    throw new ValidationError(`"${field}" is not valid`, { details: { field } });
  }
  return trimmed;
}

export function enumValue(value, allowed, field, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) {
    throw new ValidationError(`"${field}" must be one of: ${allowed.join(', ')}`, { details: { field } });
  }
  return value;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function decodeBase64Size(content) {
  if (typeof content !== 'string') return -1;
  const cleaned = content.replace(/\s+/g, '');
  if (!cleaned || cleaned.length % 4 !== 0 || !BASE64_RE.test(cleaned)) return -1;
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return (cleaned.length / 4) * 3 - padding;
}

export function validateCommitMessage(message, field = 'message') {
  const value = requireString(message, field, { min: 1, max: 500 });
  // Git rejects messages that are pure whitespace; newlines are allowed but
  // carriage returns are normalised away so messages stay consistent.
  return value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
}

export function validateFiles(files, config) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError('Select at least one file to publish');
  }
  if (files.length > config.maxFilesPerJob) {
    throw new ValidationError(`A publishing job can contain at most ${config.maxFilesPerJob} files`);
  }

  const seen = new Set();
  let totalBytes = 0;

  return files.map((file, index) => {
    if (!isPlainObject(file)) {
      throw new ValidationError(`files[${index}] must be an object`);
    }
    const path = validateFilePath(file.path);
    if (seen.has(path)) {
      throw new ValidationError(`Duplicate file path: ${path}`, { code: 'DUPLICATE_PATH' });
    }
    seen.add(path);

    const size = decodeBase64Size(file.content);
    if (size < 0) {
      throw new ValidationError(`File "${path}" has invalid content encoding`, { code: 'INVALID_CONTENT' });
    }
    if (size > config.maxFileBytes) {
      throw new ValidationError(
        `File "${path}" is larger than the ${Math.round(config.maxFileBytes / 1024 / 1024)} MB limit`,
        { code: 'FILE_TOO_LARGE', status: 413 }
      );
    }
    totalBytes += size;
    if (totalBytes > config.maxJobBytes) {
      throw new ValidationError('This publishing job exceeds the total upload limit', {
        code: 'JOB_TOO_LARGE',
        status: 413,
      });
    }

    return {
      path,
      message: validateCommitMessage(file.message ?? `Add ${path}`),
      size,
      content: file.content.replace(/\s+/g, ''),
    };
  });
}

export function parseRepoInput(body) {
  const owner = validateOwner(body.owner);
  const repo = validateRepoName(body.repo);
  const branch = body.branch === undefined ? '' : validateBranchName(body.branch);
  return { owner, repo, branch };
}

export function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
