/**
 * Recovery: before every publishing tick we verify the branch still points
 * where the job thinks it does. Two legitimate cases exist:
 *   1. Head is exactly what we recorded — normal.
 *   2. Head is our own commit that landed just before a crash — adopt it,
 *      never duplicate the commit.
 * Anything else is a real branch conflict and publishing stops.
 */

import { saveJob } from '../storage/job-store.js';
import { commitContainsFile } from './commit-engine.js';
import { getBranchRef, getCommit } from './git-data-service.js';

export async function reconcileJobHead(env, token, job) {
  // Files interrupted mid-flight are retried from a clean state.
  for (const file of job.files) {
    if (file.status === 'processing') file.status = 'waiting';
  }

  const ref = await getBranchRef(env, token, job.owner, job.repo, job.branch);

  if (!job.headSha) {
    if (!ref.exists) return { ok: true };
    // Branch appeared since the job was created (empty repository).
    return adoptOrConflict(env, token, job, ref.sha);
  }

  if (!ref.exists) {
    return {
      ok: false,
      reason: 'branch-missing',
      message: `The branch "${job.branch}" no longer exists on GitHub.`,
    };
  }

  if (ref.sha === job.headSha) {
    const pending = job.files.find((file) => file.status === 'committing');
    if (pending) pending.status = 'waiting';
    return { ok: true };
  }

  return adoptOrConflict(env, token, job, ref.sha);
}

async function adoptOrConflict(env, token, job, remoteSha) {
  const pending = job.files.find((file) => file.status === 'committing' && file.expectedBlobSha);
  if (pending) {
    const alreadyLanded = await commitContainsFile(env, token, job.owner, job.repo, {
      sha: remoteSha,
      expectedParent: job.headSha,
      filePath: pending.path,
      blobSha: pending.expectedBlobSha,
    });
    if (alreadyLanded) {
      const commit = await getCommit(env, token, job.owner, job.repo, remoteSha);
      pending.status = 'completed';
      pending.commitSha = remoteSha;
      pending.blobSha = pending.expectedBlobSha;
      delete pending.expectedBlobSha;
      delete pending.error;
      job.headSha = remoteSha;
      job.headTreeSha = commit.treeSha;
      job.mode = 'existing';
      await saveJob(env, job);
      return { ok: true, recovered: true, message: `Recovered commit ${remoteSha.slice(0, 7)}.` };
    }
  }

  return {
    ok: false,
    reason: 'conflict',
    message:
      'The branch changed on GitHub while publishing. Nothing was overwritten contact-free — review the branch and resume.',
    remoteSha,
  };
}
