/**
 * Publishing engine.
 *
 * A job is persisted in KV and advanced in bounded batches ("ticks") so a
 * Worker never exceeds its subrequest or CPU budget. Each tick:
 *   1. verifies the branch head (recovery-service),
 *   2. commits at most N files, one genuine commit each,
 *   3. persists progress after every file.
 *
 * Because state is persisted per file, an interrupted job can be resumed from
 * a different tab, browser or request without duplicating commits.
 */

import { appendHistory } from '../storage/history-store.js';
import {
  addJobToUserIndex,
  deleteFileContent,
  getFileContent,
  saveFileContent,
  saveJob,
} from '../storage/job-store.js';
import { gitBlobSha, randomId } from '../utils/crypto.js';
import { commitFile, createInitialCommit, resolveBaseState } from './commit-engine.js';
import { getRepo, getTreeMap } from './git-data-service.js';
import { reconcileJobHead } from './recovery-service.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'partial', 'cancelled']);

export function isTerminal(job) {
  return TERMINAL_STATUSES.has(job.status);
}

export function describeJobError(error) {
  if (!error) return 'Unknown error';
  if (error.code === 'RATE_LIMITED') return 'GitHub rate limit reached. Wait a minute, then retry.';
  if (error.code === 'SESSION_EXPIRED') return 'Your GitHub authorization expired. Sign in again.';
  if (error.code === 'NETWORK_ERROR' || error.code === 'GITHUB_TIMEOUT') {
    return 'GitHub could not be reached. Check your connection and retry.';
  }
  if (error.code === 'GITHUB_VALIDATION' && /fast forward|sha/i.test(error.message || '')) {
    return 'The branch moved while this commit was being applied.';
  }
  return error.message || 'The commit failed.';
}

function isConflict(error) {
  if (error?.name === 'PublishConflictError') return true;
  if (error?.status === 409) return true;
  return error?.status === 422 && /fast forward|does not match|sha/i.test(error.message || '');
}

function isStopTheBatch(error) {
  return ['SESSION_EXPIRED', 'RATE_LIMITED', 'GITHUB_FORBIDDEN', 'NO_TOKEN'].includes(error?.code);
}

export function jobStats(job) {
  const files = job.files || [];
  const completed = files.filter((file) => file.status === 'completed').length;
  const failed = files.filter((file) => file.status === 'failed').length;
  const skipped = files.filter((file) => file.status === 'skipped').length;
  const committed = files.filter((file) => file.existed && file.status === 'completed').length;
  return {
    total: files.length,
    completed,
    failed,
    skipped,
    pending: files.length - completed - failed - skipped,
    added: completed - committed,
    updated: committed,
    commits: completed,
    percent: files.length === 0 ? 0 : Math.round((completed / files.length) * 100),
  };
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    owner: job.owner,
    repo: job.repo,
    repoFullName: job.repoFullName,
    repoUrl: job.repoUrl,
    branch: job.branch,
    branchUrl: job.repoUrl ? `${job.repoUrl}/tree/${encodeURIComponent(job.branch)}` : null,
    mode: job.mode,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    error: job.error || null,
    blockedReason: job.blockedReason || null,
    stats: jobStats(job),
    files: (job.files || []).map((file) => ({
      index: file.index,
      path: file.path,
      message: file.message,
      size: file.size,
      status: file.status,
      existed: Boolean(file.existed),
      commitSha: file.commitSha || null,
      commitUrl: file.commitSha && job.repoUrl ? `${job.repoUrl}/commit/${file.commitSha}` : null,
      error: file.error || null,
      attempts: file.attempts || 0,
      updated: Boolean(file.existed),
    })),
  };
}

/** Creates a draft job: validates access, records base state, stores contents. */
export async function createPublishJob(env, config, { user, token, owner, repo, branch, files }) {
  const repository = await getRepo(env, token, owner, repo);
  if (repository.permissions?.push === false) {
    const error = new Error('Your GitHub account does not have write access to this repository.');
    error.status = 403;
    error.code = 'NO_WRITE_ACCESS';
    throw error;
  }

  const targetBranch = branch || repository.defaultBranch;
  const base = await resolveBaseState(env, token, owner, repo, targetBranch);

  let existingPaths = new Map();
  let truncated = false;
  if (base.mode === 'existing') {
    const tree = await getTreeMap(env, token, owner, repo, base.baseTreeSha);
    existingPaths = tree.map;
    truncated = tree.truncated;
  }

  const now = new Date().toISOString();
  const job = {
    id: `job_${randomId(10)}`,
    userId: user.id,
    userLogin: user.login,
    owner,
    repo,
    repoFullName: repository.fullName,
    repoUrl: repository.htmlUrl,
    branch: targetBranch,
    mode: base.mode,
    headSha: base.headSha,
    headTreeSha: base.baseTreeSha,
    treeTruncated: truncated,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    blockedReason: null,
    files: files.map((file, index) => ({
      index,
      path: file.path,
      message: file.message,
      size: file.size,
      existed: existingPaths.has(file.path),
      status: 'waiting',
      attempts: 0,
    })),
  };

  for (let index = 0; index < files.length; index += 1) {
    await saveFileContent(env, job.id, index, files[index].content);
  }

  await saveJob(env, job);
  await addJobToUserIndex(env, user.id, job.id);
  return job;
}

function buildHistoryRecord(job) {
  const stats = jobStats(job);
  const startedAt = job.startedAt || job.createdAt;
  return {
    id: job.id,
    owner: job.owner,
    repo: job.repo,
    repoFullName: job.repoFullName,
    repoUrl: job.repoUrl,
    branch: job.branch,
    status: job.status,
    filesTotal: stats.total,
    filesPublished: stats.completed,
    filesFailed: stats.failed,
    commitsCreated: stats.commits,
    startedAt,
    finishedAt: job.finishedAt,
    durationMs:
      job.finishedAt && startedAt ? new Date(job.finishedAt).getTime() - new Date(startedAt).getTime() : null,
    commits: (job.files || [])
      .filter((file) => file.status === 'completed' && file.commitSha)
      .slice(0, 100)
      .map((file) => ({ path: file.path, message: file.message, sha: file.commitSha })),
  };
}

export async function finalizeJob(env, job) {
  const stats = jobStats(job);
  job.finishedAt = new Date().toISOString();
  if (job.status !== 'cancelled') {
    if (stats.failed === 0 && stats.completed > 0) job.status = 'completed';
    else if (stats.completed === 0) job.status = 'failed';
    else job.status = 'partial';
  }
  await saveJob(env, job);
  await appendHistory(env, job.userId, buildHistoryRecord(job));
  return job;
}

/**
 * Advances a job by one batch. Safe to call repeatedly; idempotent for
 * terminal jobs and duplicate commit protected by the recovery step.
 */
export async function advanceJob(env, config, job, token, { retryFailed = false } = {}) {
  if (isTerminal(job)) return { job, progressed: 0, done: true };

  if (retryFailed) {
    for (const file of job.files) {
      if (file.status === 'failed') {
        file.status = 'waiting';
        file.error = null;
      }
    }
  }

  job.error = null;
  job.blockedReason = null;
  if (!job.startedAt) job.startedAt = new Date().toISOString();
  job.status = 'running';

  let reconciled;
  try {
    reconciled = await reconcileJobHead(env, token, job);
  } catch (error) {
    job.status = 'paused';
    job.error = describeJobError(error);
    job.blockedReason = isStopTheBatch(error) ? 'auth-or-rate-limit' : isConflict(error) ? 'conflict' : 'error';
    await saveJob(env, job);
    return { job, progressed: 0, done: false, error };
  }
  if (!reconciled.ok) {
    job.status = 'paused';
    job.error = reconciled.message;
    job.blockedReason = reconciled.reason;
    await saveJob(env, job);
    return { job, progressed: 0, done: false, conflict: reconciled.reason };
  }

  let progressed = 0;
  let attempted = 0;
  for (const file of job.files) {
    if (attempted >= config.publishBatchSize) break;
    if (file.status !== 'waiting') continue;
    attempted += 1;

    const content = await getFileContent(env, job.id, file.index);
    if (!content) {
      file.status = 'failed';
      file.error = 'Uploaded content expired. Re-create the publishing job with this file.';
      await saveJob(env, job);
      continue;
    }

    file.attempts = (file.attempts || 0) + 1;
    file.expectedBlobSha = await gitBlobSha(content);
    file.status = 'committing';
    await saveJob(env, job);

    try {
      const result = job.headSha
        ? await commitFile(env, token, job.owner, job.repo, {
            branch: job.branch,
            headSha: job.headSha,
            baseTreeSha: job.headTreeSha,
            filePath: file.path,
            message: file.message,
            content,
            author: job.author,
          })
        : await createInitialCommit(env, token, job.owner, job.repo, {
            branch: job.branch,
            filePath: file.path,
            message: file.message,
            content,
            author: job.author,
          });

      file.status = 'completed';
      file.commitSha = result.commitSha;
      file.blobSha = result.blobSha;
      delete file.expectedBlobSha;
      delete file.error;
      job.headSha = result.commitSha;
      job.headTreeSha = result.treeSha;
      job.mode = 'existing';
      progressed += 1;
      await saveJob(env, job);
      await deleteFileContent(env, job.id, file.index);
    } catch (error) {
      file.status = 'failed';
      file.error = describeJobError(error);
      file.errorCode = error.code || 'COMMIT_FAILED';
      delete file.expectedBlobSha;
      await saveJob(env, job);

      if (isConflict(error)) {
        job.status = 'paused';
        job.error = 'The branch changed on GitHub while publishing. Review the branch, then resume.';
        job.blockedReason = 'conflict';
        await saveJob(env, job);
        return { job, progressed, done: false, conflict: 'conflict' };
      }
      if (isStopTheBatch(error)) {
        job.status = 'paused';
        job.error = describeJobError(error);
        job.blockedReason = 'auth-or-rate-limit';
        await saveJob(env, job);
        return { job, progressed, done: false, error };
      }
    }
  }

  const remaining = job.files.some((file) => file.status === 'waiting');
  if (!remaining) {
    await finalizeJob(env, job);
    return { job, progressed, done: true };
  }

  await saveJob(env, job);
  return { job, progressed, done: false };
}

export async function cancelJob(env, job) {
  if (isTerminal(job)) return job;
  for (const file of job.files) {
    if (file.status === 'waiting' || file.status === 'committing' || file.status === 'processing') {
      file.status = 'skipped';
    }
  }
  job.status = 'cancelled';
  job.error = null;
  job.finishedAt = new Date().toISOString();
  await saveJob(env, job);
  await appendHistory(env, job.userId, buildHistoryRecord(job));
  return job;
}

export async function listUserJobs(env, userId, limit = 10) {
  const { listJobsForUser } = await import('../storage/job-store.js');
  const jobs = await listJobsForUser(env, userId, limit);
  return jobs.map(publicJob);
}
