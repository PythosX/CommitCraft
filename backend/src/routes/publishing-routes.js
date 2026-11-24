/** Publishing job routes: create, inspect, advance, retry, resume, cancel. */

import { requireSession } from '../middleware/auth-middleware.js';
import { ApiError } from '../middleware/error-middleware.js';
import { LIMITS, enforceRateLimit } from '../middleware/rate-limit.js';
import {
  advanceJob,
  cancelJob,
  createPublishJob,
  isTerminal,
  jobStats,
  publicJob,
} from '../services/publishing-engine.js';
import { getJob, listJobsForUser, saveJob } from '../storage/job-store.js';
import { parseRepoInput, requireObject, validateFiles } from '../utils/validation.js';

const JOB_ROUTE_RE = /^\/api\/publish\/jobs\/([A-Za-z0-9_-]{4,80})(?:\/(start|retry|resume|cancel))?$/;

async function loadOwnedJob(env, auth, jobId) {
  const job = await getJob(env, jobId);
  // A job belonging to someone else must be indistinguishable from a missing one.
  if (!job || job.userId !== auth.session.user.id) {
    throw new ApiError(404, 'JOB_NOT_FOUND', 'That publishing job was not found.');
  }
  return job;
}

function advanceResponse(job, result) {
  return {
    job: publicJob(job),
    done: Boolean(result?.done),
    progressed: result?.progressed || 0,
    conflict: result?.conflict || null,
    stats: jobStats(job),
  };
}

export async function handlePublishingRoutes(ctx) {
  const { method, url, auth, request, env, config, body } = ctx;
  if (!url.pathname.startsWith('/api/publish/')) return null;
  requireSession(auth);

  if (url.pathname === '/api/publish/jobs') {
    if (method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST to create a job.');
    await enforceRateLimit(env, request, { ...LIMITS.write, userId: auth.session.user.id });

    const payload = requireObject(body);
    const { owner, repo, branch } = parseRepoInput(payload);
    const files = validateFiles(payload.files, config);

    const job = await createPublishJob(env, config, {
      user: auth.session.user,
      token: auth.token,
      owner,
      repo,
      branch,
      files,
    });

    return ctx.respond(
      {
        job: publicJob(job),
        settings: { batchSize: config.publishBatchSize },
      },
      { status: 201 }
    );
  }

  const match = url.pathname.match(JOB_ROUTE_RE);
  if (match) {
    const [, jobId, action] = match;
    const job = await loadOwnedJob(env, auth, jobId);

    if (!action) {
      if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET to read a job.');
      await enforceRateLimit(env, request, { ...LIMITS.read, userId: auth.session.user.id });
      return ctx.respond({ job: publicJob(job) });
    }

    if (method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST to update a job.');
    await enforceRateLimit(env, request, { ...LIMITS.publish, userId: auth.session.user.id });

    if (action === 'cancel') {
      if (isTerminal(job)) return ctx.respond({ job: publicJob(job), done: true, progressed: 0 });
      const cancelled = await cancelJob(env, job);
      return ctx.respond({ job: publicJob(cancelled), done: true, progressed: 0 });
    }

    if (isTerminal(job)) {
      return ctx.respond({ job: publicJob(job), done: true, progressed: 0, stats: jobStats(job) });
    }

    if (action === 'resume' && job.status === 'paused') {
      job.status = 'running';
      job.error = null;
      job.blockedReason = null;
      await saveJob(env, job);
    }

    const result = await advanceJob(env, config, job, auth.token, {
      retryFailed: action === 'retry',
    });
    const payload = advanceResponse(result.job, result);
    if (result.conflict) payload.message = result.job.error;
    if (result.error) payload.message = result.job.error;
    return ctx.respond(payload);
  }

  if (url.pathname === '/api/publish/recent') {
    if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    const jobs = await listJobsForUser(env, auth.session.user.id, 8);
    return ctx.respond({ jobs: jobs.map(publicJob) });
  }

  throw new ApiError(404, 'NOT_FOUND', 'Unknown publishing endpoint.');
}
