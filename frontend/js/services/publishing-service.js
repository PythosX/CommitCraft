/**
 * Publishing client.
 * The Worker commits a bounded batch per request; this module drives the loop,
 * surfaces progress and stops cleanly on pause/conflict.
 */

import { api } from '../core/api-client.js';
import { formatDuration, formatNumber } from '../utils/format-utils.js';

const DONE_STATUSES = new Set(['completed', 'failed', 'partial', 'cancelled']);

export function isDone(job) {
  return !job || DONE_STATUSES.has(job.status);
}

export async function createJob({ owner, repo, branch, files }) {
  return api.post('/api/publish/jobs', { owner, repo, branch, files });
}

export async function getJob(jobId) {
  return api.get(`/api/publish/jobs/${encodeURIComponent(jobId)}`);
}

export async function advanceJob(jobId, action = 'start') {
  return api.post(`/api/publish/jobs/${encodeURIComponent(jobId)}/${action}`);
}

export async function cancelJob(jobId) {
  return api.post(`/api/publish/jobs/${encodeURIComponent(jobId)}/cancel`);
}

export async function retryJob(jobId) {
  return api.post(`/api/publish/jobs/${encodeURIComponent(jobId)}/retry`);
}

/**
 * Continues a job until it finishes, pauses or is aborted.
 * @param {{jobId: string, job?: object, onUpdate?: Function, signal?: AbortSignal}} options
 */
export async function runPublishLoop({ jobId, job, onUpdate, signal }) {
  let current = job || (await getJob(jobId)).job;
  onUpdate?.(current, { initial: true });

  let lastProgressed = 0;
  let idleTicks = 0;
  let action = (current.files || []).some((file) => file.status === 'failed') ? 'retry' : 'start';

  if (isDone(current)) return current;

  if (current.status === 'paused') {
    action = 'resume';
  }

  while (!isDone(current)) {
    if (signal?.aborted) return current;

    // A job paused on the server cannot be advanced by a plain start.
    if (current.status === 'paused' && action === 'start') {
      action = 'resume';
    }

    const result = await advanceJob(jobId, action);
    current = result.job;
    lastProgressed = result.progressed || 0;
    onUpdate?.(current, result);

    if (result.done || isDone(current)) break;
    if (current.status === 'paused') break;

    if (lastProgressed === 0) {
      idleTicks += 1;
      if (idleTicks > 2) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    } else {
      idleTicks = 0;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    action = 'start';
  }

  return current;
}

export function jobMetrics(job, startedAtMs) {
  const stats = job?.stats || { completed: 0, total: 0, percent: 0, failed: 0 };
  const elapsedMs = startedAtMs ? Date.now() - startedAtMs : 0;
  const perFile = stats.completed > 0 ? elapsedMs / stats.completed : 0;
  const remaining = Math.max(0, stats.total - stats.completed);
  const etaMs = perFile > 0 && remaining > 0 ? perFile * remaining : null;
  return {
    elapsedMs,
    perFileMs: perFile,
    etaMs,
    speedLabel: perFile > 0 ? `${formatNumber(60000 / perFile)} files/min` : '—',
    etaLabel: etaMs ? formatDuration(etaMs) : '—',
  };
}

export function statusCopy(job) {
  if (!job) return { title: 'Loading job', tone: 'info' };
  if (job.status === 'queued') return { title: 'Ready to publish', tone: 'info' };
  if (job.status === 'running') return { title: 'Publishing commits', tone: 'info' };
  if (job.status === 'paused') {
    return {
      title: job.blockedReason === 'conflict' ? 'Branch conflict — publishing stopped' : 'Publishing paused',
      tone: 'warning',
    };
  }
  if (job.status === 'completed') return { title: 'All commits published', tone: 'success' };
  if (job.status === 'partial') return { title: 'Published with failures', tone: 'warning' };
  if (job.status === 'cancelled') return { title: 'Publishing cancelled', tone: 'muted' };
  if (job.status === 'failed') return { title: 'Publishing failed', tone: 'error' };
  return { title: job.status, tone: 'muted' };
}
