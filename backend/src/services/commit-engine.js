/**
 * Commit engine: one real Git commit per file, via the Git Database API.
 *
 * Sequence per file (existing branch):
 *   current ref -> current tree -> blob -> tree (+file) -> commit (parent=head) -> ref update
 *
 * The ref update uses `force: false`, so if another writer moved the branch
 * between our read and our write GitHub rejects it and we stop cleanly.
 */

import { githubRequest } from './github-api.js';
import {
  createBlob,
  createBranchRef,
  createCommit,
  createTree,
  getBranchRef,
  getCommit,
  updateBranchRef,
} from './git-data-service.js';

export class PublishConflictError extends Error {
  constructor(message, { code = 'BRANCH_CONFLICT', details } = {}) {
    super(message);
    this.name = 'PublishConflictError';
    this.code = code;
    this.status = 409;
    this.details = details;
  }
}

/**
 * Resolves the state a publish can build on.
 * @returns {{mode: 'empty'|'existing', headSha: string|null, baseTreeSha: string|null, truncated: boolean}}
 */
export async function resolveBaseState(env, token, owner, repo, branch) {
  const ref = await getBranchRef(env, token, owner, repo, branch);
  if (!ref.exists) {
    return { mode: 'empty', headSha: null, baseTreeSha: null, truncated: false };
  }
  if (!ref.sha) {
    throw new PublishConflictError('This branch does not point at a commit yet.', { code: 'BRANCH_EMPTY' });
  }
  const commit = await getCommit(env, token, owner, repo, ref.sha);
  if (!commit.treeSha) {
    throw new PublishConflictError('Could not read the current branch tree from GitHub.', {
      code: 'TREE_UNREADABLE',
    });
  }
  return { mode: 'existing', headSha: ref.sha, baseTreeSha: commit.treeSha, truncated: false };
}

/**
 * Creates one commit that adds or updates a single file on top of `headSha`.
 * The caller owns job state; this function only talks to GitHub.
 */
export async function commitFile(env, token, owner, repo, params) {
  const {
    branch,
    headSha,
    baseTreeSha,
    filePath,
    message,
    content,
    author,
  } = params;

  const blobSha = await createBlob(env, token, owner, repo, content);
  const treeSha = await createTree(env, token, owner, repo, {
    baseTree: baseTreeSha,
    entry: { path: filePath, sha: blobSha },
  });
  const commitSha = await createCommit(env, token, owner, repo, {
    message,
    tree: treeSha,
    parents: headSha ? [headSha] : [],
    author,
  });
  await updateBranchRef(env, token, owner, repo, branch, commitSha);

  return { blobSha, treeSha, commitSha };
}

/** First commit of an empty repository: no base tree, no parent, then create the ref. */
export async function createInitialCommit(env, token, owner, repo, params) {
  const { branch, filePath, message, content, author } = params;
  const blobSha = await createBlob(env, token, owner, repo, content);
  const treeSha = await createTree(env, token, owner, repo, {
    baseTree: null,
    entry: { path: filePath, sha: blobSha },
  });
  const commitSha = await createCommit(env, token, owner, repo, {
    message,
    tree: treeSha,
    parents: [],
    author,
  });
  await createBranchRef(env, token, owner, repo, branch, commitSha);
  return { blobSha, treeSha, commitSha };
}

/**
 * Used by recovery: did `sha` already receive this file?
 * Checks the commit message, the parent chain and the blob at the path.
 */
export async function commitContainsFile(env, token, owner, repo, params) {
  const { sha, expectedParent, filePath, blobSha } = params;
  let commit;
  try {
    commit = await getCommit(env, token, owner, repo, sha);
  } catch {
    return false;
  }
  if (commit.parents.length > 0 && expectedParent && commit.parents[0] !== expectedParent) return false;
  if (commit.parents.length === 0 && expectedParent) return false;
  try {
    const { data } = await githubRequest(
      env,
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commit.treeSha}?recursive=1`
    );
    return (data.tree || []).some(
      (entry) => entry.type === 'blob' && entry.path === filePath && entry.sha === blobSha
    );
  } catch {
    return false;
  }
}
