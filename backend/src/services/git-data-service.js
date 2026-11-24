/**
 * Thin wrapper over GitHub's Git Database API.
 * All paths are repository-relative and already validated by callers.
 */

import { githubRequest } from './github-api.js';

const enc = encodeURIComponent;

export async function getRepo(env, token, owner, repo) {
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}`);
  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    owner: data.owner?.login,
    private: Boolean(data.private),
    defaultBranch: data.default_branch || 'main',
    sizeKb: data.size ?? 0,
    htmlUrl: data.html_url,
    description: data.description || '',
    permissions: {
      admin: Boolean(data.permissions?.admin),
      push: data.permissions?.push !== false,
    },
    empty: (data.size ?? 0) === 0,
  };
}

export async function listBranches(env, token, owner, repo) {
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}/branches?per_page=100`);
  return (data || []).map((branch) => ({
    name: branch.name,
    sha: branch.commit?.sha,
    protected: Boolean(branch.protected),
  }));
}

/** @returns {{exists: boolean, sha: string|null}} */
export async function getBranchRef(env, token, owner, repo, branch) {
  try {
    const { data } = await githubRequest(
      env,
      token,
      `/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(branch)}`
    );
    return { exists: true, sha: data?.object?.sha || null };
  } catch (error) {
    if (error.status === 404 || error.status === 409) return { exists: false, sha: null };
    throw error;
  }
}

export async function listRefs(env, token, owner, repo) {
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}/git/refs?per_page=100`);
  return data || [];
}

/** A repository is empty when it has no refs at all. */
export async function isRepositoryEmpty(env, token, owner, repo) {
  try {
    const refs = await listRefs(env, token, owner, repo);
    return refs.length === 0;
  } catch (error) {
    if (error.status === 409) return true;
    throw error;
  }
}

export async function getCommit(env, token, owner, repo, sha) {
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}/git/commits/${enc(sha)}`);
  return {
    sha: data.sha,
    message: data.message || '',
    treeSha: data.tree?.sha,
    parents: (data.parents || []).map((parent) => parent.sha),
  };
}

/**
 * Flat map of every blob in a tree: path -> { sha, mode, size }.
 * Truncated trees are flagged so callers do not assume completeness.
 */
export async function getTreeMap(env, token, owner, repo, treeSha) {
  const { data } = await githubRequest(
    env,
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(treeSha)}?recursive=1`
  );
  const map = new Map();
  for (const entry of data.tree || []) {
    if (entry.type === 'blob') {
      map.set(entry.path, { sha: entry.sha, mode: entry.mode, size: entry.size });
    }
  }
  return { map, truncated: Boolean(data.truncated) };
}

export async function getContentSha(env, token, owner, repo, path, ref) {
  try {
    const { data } = await githubRequest(
      env,
      token,
      `/repos/${enc(owner)}/${enc(repo)}/contents/${path.split('/').map(enc).join('/')}?ref=${enc(ref)}`
    );
    if (Array.isArray(data)) return null;
    return data?.sha || null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function createBlob(env, token, owner, repo, base64Content) {
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}/git/blobs`, {
    method: 'POST',
    body: { content: base64Content, encoding: 'base64' },
  });
  return data.sha;
}

export async function createTree(env, token, owner, repo, { baseTree, entry }) {
  const body = { tree: [{ path: entry.path, mode: '100644', type: 'blob', sha: entry.sha }] };
  if (baseTree) body.base_tree = baseTree;
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}/git/trees`, {
    method: 'POST',
    body,
  });
  return data.sha;
}

export async function createCommit(env, token, owner, repo, { message, tree, parents = [], author }) {
  const body = { message, tree };
  if (parents.length > 0) body.parents = parents;
  if (author) body.author = author;
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}/git/commits`, {
    method: 'POST',
    body,
  });
  return data.sha;
}

export async function updateBranchRef(env, token, owner, repo, branch, sha) {
  const { data } = await githubRequest(
    env,
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${enc(branch)}`,
    { method: 'PATCH', body: { sha, force: false } }
  );
  return data?.object?.sha || sha;
}

export async function createBranchRef(env, token, owner, repo, branch, sha) {
  const { data } = await githubRequest(env, token, `/repos/${enc(owner)}/${enc(repo)}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha },
  });
  return data?.object?.sha || sha;
}
