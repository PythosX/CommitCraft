/** Publishing history access. */

import { api } from '../core/api-client.js';

export async function fetchHistory() {
  return api.get('/api/publish/history');
}

export async function clearHistory() {
  return api.delete('/api/publish/history');
}

export function computeTotals(history = []) {
  return history.reduce(
    (accumulator, record) => ({
      jobs: accumulator.jobs + 1,
      files: accumulator.files + (record.filesPublished || 0),
      commits: accumulator.commits + (record.commitsCreated || 0),
      failed: accumulator.failed + (record.filesFailed || 0),
    }),
    { jobs: 0, files: 0, commits: 0, failed: 0 }
  );
}

export function groupByRepository(history = []) {
  const map = new Map();
  for (const record of history) {
    const key = record.repoFullName || `${record.owner}/${record.repo}`;
    if (!map.has(key)) map.set(key, { repository: key, url: record.repoUrl, lastPublishedAt: record.finishedAt, jobs: 0, commits: 0 });
    const entry = map.get(key);
    entry.jobs += 1;
    entry.commits += record.commitsCreated || 0;
    if (!entry.lastPublishedAt || new Date(record.finishedAt) > new Date(entry.lastPublishedAt)) {
      entry.lastPublishedAt = record.finishedAt;
    }
  }
  return [...map.values()].sort((a, b) => new Date(b.lastPublishedAt) - new Date(a.lastPublishedAt));
}
