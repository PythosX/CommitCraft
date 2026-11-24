/** Publishing history with filters and commit details. */

import { initShell } from '../components/app-shell.js';
import { icon } from '../components/icons.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { fetchHistory } from '../services/history-service.js';
import { escapeHtml, formatDateTime, formatDuration, formatNumber, shortSha, statusLabel, statusTone, timeAgo, pluralize } from '../utils/format-utils.js';
import { friendlyError } from '../utils/error-handler.js';

await initShell({ active: 'history', title: 'Publishing history' });

let records = [];
let statusFilter = 'all';
let query = '';

const bodyEl = document.getElementById('historyBody');

async function load({ quiet = false } = {}) {
  if (!quiet) {
    bodyEl.innerHTML = `<div style="padding:var(--space-4)"><div class="skeleton skeleton--line" style="width:70%;margin-bottom:12px"></div><div class="skeleton skeleton--line" style="width:50%"></div></div>`;
  }
  try {
    const result = await fetchHistory();
    records = result.history || [];
    renderStats(result.totals || { commits: 0, files: 0, jobs: 0 });
    renderTable();
  } catch (error) {
    bodyEl.innerHTML = `
      <div class="empty" style="border:0;background:none">
        <span class="empty__icon">${icon('alert-circle', { size: 18 })}</span>
        <h3 class="empty__title">Could not load history</h3>
        <p class="empty__text">${escapeHtml(friendlyError(error))}</p>
        <button class="btn btn--secondary btn--sm" type="button" id="retryHistory">Try again</button>
      </div>
    `;
    document.getElementById('retryHistory')?.addEventListener('click', () => load());
    toast.error('Could not load history', friendlyError(error));
  }
}

function renderStats(totals) {
  const failed = records.reduce((total, record) => total + (record.filesFailed || 0), 0);
  document.getElementById('historyStats').innerHTML = [
    { label: 'Publishing jobs', value: totals.jobs || 0, icon: 'history' },
    { label: 'Commits created', value: totals.commits || 0, icon: 'git-commit', accent: true },
    { label: 'Files published', value: totals.files || 0, icon: 'file' },
    { label: 'Files failed', value: failed, icon: 'alert-circle' },
  ]
    .map(
      (stat) => `
      <article class="stat">
        <div class="stat__top">
          <span class="stat__label">${escapeHtml(stat.label)}</span>
          <span class="stat__icon ${stat.accent ? 'stat__icon--accent' : ''}">${icon(stat.icon, { size: 16 })}</span>
        </div>
        <div class="stat__value">${formatNumber(stat.value)}</div>
        <div class="stat__meta">From recorded jobs</div>
      </article>
    `
    )
    .join('');
}

function filtered() {
  const term = query.trim().toLowerCase();
  return records.filter((record) => {
    if (statusFilter !== 'all' && record.status !== statusFilter) return false;
    if (!term) return true;
    return (
      (record.repoFullName || '').toLowerCase().includes(term) ||
      (record.repo || '').toLowerCase().includes(term)
    );
  });
}

function renderTable() {
  const rows = filtered();
  document.getElementById('historyCount').textContent = `${rows.length} of ${records.length} jobs`;

  if (rows.length === 0) {
    bodyEl.innerHTML = `
      <div class="empty" style="border:0;background:none">
        <span class="empty__icon">${icon('history', { size: 18 })}</span>
        <h3 class="empty__title">${records.length === 0 ? 'No publishing history yet' : 'No jobs match this filter'}</h3>
        <p class="empty__text">
          ${
            records.length === 0
              ? 'Once you publish a folder, every job and its commits will be recorded here.'
              : 'Try another status or clear the search.'
          }
        </p>
        ${records.length === 0 ? '<a class="btn btn--primary btn--sm" href="upload.html">Start your first publish</a>' : ''}
      </div>
    `;
    return;
  }

  bodyEl.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Branch</th>
            <th>Date</th>
            <th>Files</th>
            <th>Commits</th>
            <th>Duration</th>
            <th>Status</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (record) => `
            <tr>
              <td data-label="Repository">
                <strong class="mono-xs" style="font-size:var(--text-xs)">${escapeHtml(record.repoFullName || `${record.owner}/${record.repo}`)}</strong>
              </td>
              <td data-label="Branch"><span class="badge">${escapeHtml(record.branch)}</span></td>
              <td data-label="Date" title="${escapeHtml(formatDateTime(record.finishedAt || record.startedAt))}">
                ${escapeHtml(timeAgo(record.finishedAt || record.startedAt))}
              </td>
              <td data-label="Files" class="table__num">${record.filesPublished || 0}/${record.filesTotal || 0}</td>
              <td data-label="Commits" class="table__num">${record.commitsCreated || 0}</td>
              <td data-label="Duration" class="table__num">${escapeHtml(formatDuration(record.durationMs))}</td>
              <td data-label="Status">
                <span class="badge badge--${statusTone(record.status)}">${escapeHtml(statusLabel(record.status))}</span>
              </td>
              <td data-label="Actions">
                <div class="row" style="gap:6px;justify-content:flex-end">
                  <a class="btn btn--ghost btn--sm" href="${escapeHtml(record.repoUrl || '#')}" target="_blank" rel="noopener noreferrer" title="Open repository">
                    ${icon('github', { size: 13 })}
                  </a>
                  <button class="btn btn--ghost btn--sm" type="button" data-details="${escapeHtml(record.id)}">
                    Details
                  </button>
                </div>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  bodyEl.querySelectorAll('[data-details]').forEach((button) => {
    button.addEventListener('click', () => showDetails(button.dataset.details));
  });
}

function showDetails(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  const body = document.createElement('div');
  const commits = record.commits || [];
  body.innerHTML = `
    <div class="kv">
      <dt>Repository</dt><dd>${escapeHtml(record.repoFullName || '')}</dd>
      <dt>Branch</dt><dd>${escapeHtml(record.branch)}</dd>
      <dt>Status</dt><dd><span class="badge badge--${statusTone(record.status)}">${escapeHtml(statusLabel(record.status))}</span></dd>
      <dt>Started</dt><dd>${escapeHtml(formatDateTime(record.startedAt))}</dd>
      <dt>Finished</dt><dd>${escapeHtml(formatDateTime(record.finishedAt))}</dd>
      <dt>Duration</dt><dd>${escapeHtml(formatDuration(record.durationMs))}</dd>
      <dt>Files</dt><dd>${record.filesPublished || 0} published · ${record.filesFailed || 0} failed of ${record.filesTotal || 0}</dd>
    </div>
    <div class="divider"></div>
    <div>
      <div class="row" style="justify-content:space-between;margin-bottom:var(--space-2)">
        <strong class="text-sm">Commits</strong>
        <span class="badge badge--muted">${pluralize(commits.length, 'commit')}</span>
      </div>
      ${
        commits.length === 0
          ? '<p class="text-xs muted">No commits were recorded for this job.</p>'
          : `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden">
              ${commits
                .map(
                  (commit) => `
                <div class="list-row" style="padding:var(--space-2) var(--space-3)">
                  <span class="list-row__icon" style="width:26px;height:26px">${icon('git-commit', { size: 13 })}</span>
                  <div class="list-row__main">
                    <div class="list-row__title" style="font-size:var(--text-xs)">${escapeHtml(commit.message)}</div>
                    <div class="list-row__meta mono-xs">${escapeHtml(commit.path)}</div>
                  </div>
                  <a class="commit-sha" href="${escapeHtml(record.repoUrl)}/commit/${escapeHtml(commit.sha)}" target="_blank" rel="noopener noreferrer">
                    ${escapeHtml(shortSha(commit.sha))}
                  </a>
                </div>
              `
                )
                .join('')}
            </div>`
      }
    </div>
  `;

  openModal({
    title: `Job ${record.id.slice(0, 14)}`,
    body,
    actions: [
      { label: 'Close', value: 'close', variant: 'ghost' },
      ...(record.repoUrl
        ? [{ label: 'Open repository', value: 'repo', variant: 'secondary' }]
        : []),
    ],
    wide: true,
  }).then((result) => {
    if (result === 'repo' && record.repoUrl) window.open(record.repoUrl, '_blank', 'noopener');
  });
}

document.getElementById('refreshHistory').addEventListener('click', () => {
  load({ quiet: true });
  toast.info('Refreshing history', 'Fetching the latest job records.');
});

document.getElementById('historySearch').addEventListener('input', (event) => {
  query = event.target.value;
  renderTable();
});

document.querySelectorAll('[data-status]').forEach((button) => {
  button.addEventListener('click', () => {
    statusFilter = button.dataset.status;
    document.querySelectorAll('[data-status]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderTable();
  });
});

load();
