/** Repository listing, creation and filtering (via the API proxy). */

import { api } from '../core/api-client.js';

export async function listRepositories({ page = 1, perPage = 50, sort = 'updated' } = {}) {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage), sort });
  return api.get(`/api/github/repos?${params.toString()}`);
}

export async function fetchRepository(owner, repo) {
  const params = new URLSearchParams({ owner, repo });
  const result = await api.get(`/api/github/repository?${params.toString()}`);
  return result.repository;
}

export async function createRepository({ name, description = '', isPrivate = false, autoInit = false }) {
  const result = await api.post('/api/github/repos', {
    name,
    description,
    private: isPrivate,
    autoInit,
  });
  return result.repository;
}

export function filterRepositories(repositories, { query = '', visibility = 'all' } = {}) {
  const term = query.trim().toLowerCase();
  return repositories.filter((repo) => {
    if (visibility === 'public' && repo.private) return false;
    if (visibility === 'private' && !repo.private) return false;
    if (!term) return true;
    return (
      repo.fullName.toLowerCase().includes(term) ||
      (repo.description || '').toLowerCase().includes(term)
    );
  });
}

export function sortRepositories(repositories, mode = 'updated') {
  const items = [...repositories];
  if (mode === 'name') items.sort((a, b) => a.fullName.localeCompare(b.fullName));
  else items.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return items;
}
