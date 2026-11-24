/**
 * GitHub REST client.
 * Every failure becomes a typed GitHubError so routes can answer with a
 * meaningful status code and the UI can show an actionable message.
 */

const API_ROOT = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, { status = 502, code = 'GITHUB_ERROR', method, path, details, retryAfter } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.code = code;
    this.method = method;
    this.path = path;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

function rateLimitFromHeaders(headers) {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (remaining === '0') {
    const resetMs = Number.parseInt(reset || '0', 10) * 1000;
    return {
      limited: true,
      retryAfter: resetMs ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)) : 60,
    };
  }
  return { limited: false };
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function mapError(status, body, { method, path, headers }) {
  const message = typeof body === 'object' && body?.message ? body.message : `GitHub returned ${status}`;
  const rate = rateLimitFromHeaders(headers);
  const retryAfterHeader = Number.parseInt(headers.get('retry-after') || '0', 10);

  if (status === 401) {
    return new GitHubError('Your GitHub authorization is no longer valid. Sign in again.', {
      status: 401,
      code: 'SESSION_EXPIRED',
      method,
      path,
    });
  }
  if (status === 403 && (rate.limited || /rate limit|secondary rate/i.test(message))) {
    return new GitHubError('GitHub rate limit reached. Wait a moment and retry.', {
      status: 429,
      code: 'RATE_LIMITED',
      method,
      path,
      retryAfter: rate.retryAfter || retryAfterHeader || 60,
    });
  }
  if (status === 429) {
    return new GitHubError('GitHub rate limit reached. Wait a moment and retry.', {
      status: 429,
      code: 'RATE_LIMITED',
      method,
      path,
      retryAfter: rate.retryAfter || retryAfterHeader || 60,
    });
  }
  if (status === 403) {
    return new GitHubError(
      'GitHub refused this action. Check that your account has write access to this repository.',
      { status: 403, code: 'GITHUB_FORBIDDEN', method, path }
    );
  }
  if (status === 404) {
    return new GitHubError('That repository, branch or file was not found on GitHub.', {
      status: 404,
      code: 'GITHUB_NOT_FOUND',
      method,
      path,
    });
  }
  if (status === 409) {
    return new GitHubError('The repository is in a state that cannot be edited right now.', {
      status: 409,
      code: 'GITHUB_CONFLICT',
      method,
      path,
    });
  }
  if (status === 422) {
    return new GitHubError(message || 'GitHub rejected the request payload.', {
      status: 422,
      code: 'GITHUB_VALIDATION',
      method,
      path,
      details: body?.errors,
    });
  }
  return new GitHubError(`GitHub request failed: ${message}`, {
    status: 502,
    code: 'GITHUB_ERROR',
    method,
    path,
    details: body,
  });
}

/**
 * Performs an authenticated GitHub API request.
 * @param {object} env Worker env
 * @param {string} token GitHub access token
 * @param {string} path API path beginning with "/"
 */
export async function githubRequest(env, token, path, options = {}) {
  const {
    method = 'GET',
    body,
    accept = 'application/vnd.github+json',
    apiVersion = '2022-11-28',
    timeoutMs = 20000,
    fetchImpl = fetch,
  } = options;

  if (!token) {
    throw new GitHubError('No GitHub token available for this session.', {
      status: 401,
      code: 'NO_TOKEN',
      method,
      path,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${path.startsWith('http') ? '' : API_ROOT}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept,
        'x-github-api-version': apiVersion,
        'user-agent': 'CommitCraft/1.0',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    throw new GitHubError(
      aborted ? 'GitHub took too long to respond. Retry in a moment.' : 'Could not reach GitHub. Check the connection and retry.',
      { status: 502, code: aborted ? 'GITHUB_TIMEOUT' : 'NETWORK_ERROR', method, path }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await parseBody(response);
    throw mapError(response.status, errorBody, { method, path, headers: response.headers });
  }

  const data = await parseBody(response);
  return {
    data,
    status: response.status,
    headers: response.headers,
    link: response.headers.get('link') || '',
  };
}

export function hasNextPage(linkHeader) {
  return /rel="next"/.test(linkHeader || '');
}
