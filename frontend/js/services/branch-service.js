/** Branch listing and selection helpers. */

import { api } from '../core/api-client.js';

export async function listBranches(owner, repo) {
  const params = new URLSearchParams({ owner, repo });
  const result = await api.get(`/api/github/branches?${params.toString()}`);
  return {
    branches: result.branches || [],
    defaultBranch: result.defaultBranch || 'main',
    empty: Boolean(result.empty),
  };
}

export async function loadRepositoryBranches(owner, repo) {
  const [detail, branches] = await Promise.all([
    api.get(`/api/github/repository?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`),
    listBranches(owner, repo),
  ]);
  return {
    repository: detail.repository,
    branches: branches.branches,
    defaultBranch: detail.repository.defaultBranch || branches.defaultBranch,
    empty: branches.empty,
  };
}

export function branchExists(branches, name) {
  return branches.some((branch) => branch.name === name);
}

export function isProtected(branches, name) {
  return branches.find((branch) => branch.name === name)?.protected || false;
}
