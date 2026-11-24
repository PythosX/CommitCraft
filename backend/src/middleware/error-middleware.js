/** Unified error handling for every route. */

import { fail } from '../utils/response.js';
import { errorLogFields, logger } from '../utils/logger.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const STATUS_FALLBACK = {
  400: ['BAD_REQUEST', 'The request could not be processed.'],
  401: ['UNAUTHORIZED', 'Sign in with GitHub to continue.'],
  403: ['FORBIDDEN', 'You do not have access to this resource.'],
  404: ['NOT_FOUND', 'Not found.'],
  405: ['METHOD_NOT_ALLOWED', 'Method not allowed.'],
  409: ['CONFLICT', 'The resource changed. Refresh and try again.'],
  413: ['PAYLOAD_TOO_LARGE', 'The upload is too large.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.'],
  429: ['RATE_LIMITED', 'Too many requests. Slow down and retry.'],
  500: ['INTERNAL_ERROR', 'Something went wrong on our side.'],
};

export function handleError(error, context = {}) {
  const { origin, allowedOrigins = [], requestId } = context;
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const [fallbackCode, fallbackMessage] = STATUS_FALLBACK[status] || STATUS_FALLBACK[500];
  const code = error?.code || fallbackCode;
  const message = status >= 500 && !error?.expose ? fallbackMessage : error?.message || fallbackMessage;

  if (status >= 500) {
    logger.error('request_failed', { requestId, ...errorLogFields(error), path: context.path });
  } else {
    logger.warn('request_rejected', { requestId, code, status, path: context.path });
  }

  const headers = {};
  if (error?.retryAfter) headers['retry-after'] = String(error.retryAfter);

  return fail(status, code, message, {
    details: error?.details,
    headers,
    origin,
    allowedOrigins,
  });
}
