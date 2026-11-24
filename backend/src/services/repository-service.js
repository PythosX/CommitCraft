/** Repository listing / creation, proxied so the browser never sees a token. */

import { githubRequest, hasNextPage } from './github-api.js';
import { getRepo, listBranches } from './git-data-service.js';

function normalizeRepo(repo) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login,
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch || 'main',
    description: repo.description || '',
    updatedAt: repo.updated_at,
    htmlUrl: repo.html_url,
    permissions: {
      push: repo.permissions?.push !== false,
      admin: Boolean(repo.permissions?.admin),
    },
  };
}

/**
 * Lists repositories the user can push to.
 * `affiliation=owner,collaborator,organization_member` keeps forks out by default.
 */
export async function listUserRepositories(env, token, { page = 1, perPage = 50, sort = 'updated' } = {}) {
  const params = new URLSearchParams({
    affiliation: 'owner,collaborator,organization_member',
    sort: ['updated', 'created', 'full_name'].includes(sort) ? sort : 'updated',
    direction: 'desc',
    per_page: String(perPage),
    page: String(page),
  });
  const { data, link } = await githubRequest(env, token, `/user/repos?${params.toString()}`);
  return {
    repositories: (data || []).map(normalizeRepo),
    hasMore: hasNextPage(link),
    page,
  };
}

export async function createRepository(env, token, input) {
  const body = {
    name: input.name,
    private: Boolean(input.private),
    auto_init: Boolean(input.autoInit),
    description: input.description || '',
  };
  const { data } = await githubRequest(env, token, '/user/repos', { method: 'POST', body });
  return normalizeRepo(data);
}

export async function getRepositoryDetail(env, token, owner, repo) {
  const info = await getRepo(env, token, owner, repo);
  let branches = [];
  try {
    branches = await listBranches(env, token, owner, repo);
  } catch {
    branches = [];
  }
  return { ...info, branches };
}
