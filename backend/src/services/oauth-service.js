/** GitHub OAuth (web application flow) + account lookup. */

import { requireConfig } from '../config/env.js';
import { randomId, timingSafeEqual } from '../utils/crypto.js';
import { GitHubError, githubRequest } from './github-api.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

// `repo` is required to create commits in private repositories.
export const OAUTH_SCOPE = 'repo read:user';

export function createOAuthState() {
  return randomId(24);
}

export function buildAuthorizeUrl(config, state) {
  requireConfig(config, ['clientId', 'callbackUrl']);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    scope: OAUTH_SCOPE,
    state,
    allow_signup: 'true',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function validateState(received, expected) {
  if (!received || !expected) return false;
  return timingSafeEqual(received, expected);
}

export async function exchangeCodeForToken(config, code, { fetchImpl = fetch } = {}) {
  requireConfig(config, ['clientId', 'clientSecret', 'callbackUrl']);
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'CommitCraft/1.0',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });

  if (!response.ok) {
    throw new GitHubError('GitHub rejected the sign-in attempt. Please try again.', {
      status: 502,
      code: 'OAUTH_EXCHANGE_FAILED',
    });
  }

  const data = await response.json();
  if (data.error) {
    const description = data.error_description || data.error;
    throw new GitHubError(`GitHub sign-in failed: ${description}`, {
      status: 401,
      code: 'OAUTH_DENIED',
    });
  }
  if (!data.access_token) {
    throw new GitHubError('GitHub did not return an access token.', {
      status: 502,
      code: 'OAUTH_NO_TOKEN',
    });
  }
  return {
    token: data.access_token,
    scope: data.scope || '',
    tokenType: data.token_type || 'bearer',
  };
}

export async function fetchGitHubUser(env, token) {
  const { data } = await githubRequest(env, token, '/user');
  if (!data?.login) {
    throw new GitHubError('Could not read your GitHub account.', {
      status: 502,
      code: 'USER_UNREADABLE',
    });
  }
  return data;
}

export function hasRepoScope(scopeString) {
  const scopes = String(scopeString || '')
    .split(/[,\s]+/)
    .filter(Boolean);
  return scopes.includes('repo') || scopes.includes('public_repo');
}
