/** Publishing history + dashboard statistics (real data only). */

import { requireSession } from '../middleware/auth-middleware.js';
import { ApiError } from '../middleware/error-middleware.js';
import { LIMITS, enforceRateLimit } from '../middleware/rate-limit.js';
import { clearHistory, listHistory } from '../storage/history-store.js';
import { listJobsForUser } from '../storage/job-store.js';
import { publicJob } from '../services/publishing-engine.js';

export async function handleHistoryRoutes(ctx) {
  const { method, url, auth, request, env } = ctx;
  if (url.pathname !== '/api/publish/history') return null;
  requireSession(auth);
  const userId = auth.session.user.id;

  if (method === 'GET') {
    await enforceRateLimit(env, request, { ...LIMITS.read, userId });
    const [history, jobs] = await Promise.all([
      listHistory(env, userId, 50),
      listJobsForUser(env, userId, 10),
    ]);

    const totals = history.reduce(
      (accumulator, record) => ({
        commits: accumulator.commits + (record.commitsCreated || 0),
        files: accumulator.files + (record.filesPublished || 0),
        jobs: accumulator.jobs + 1,
      }),
      { commits: 0, files: 0, jobs: 0 }
    );

    return ctx.respond({
      history,
      recentJobs: jobs.map(publicJob).slice(0, 6),
      totals,
    });
  }

  if (method === 'DELETE') {
    await enforceRateLimit(env, request, { ...LIMITS.write, userId });
    await clearHistory(env, userId);
    return ctx.respond({ ok: true });
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or DELETE for this endpoint.');
}
