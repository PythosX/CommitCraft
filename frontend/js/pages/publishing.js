/** Real-time publishing progress, retry, resume and completion. */

import { initShell } from '../components/app-shell.js';
import { icon } from '../components/icons.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { commitRowHtml } from '../components/commit-card.js';
import { cancelJob, getJob, isDone, jobMetrics, retryJob, runPublishLoop, statusCopy } from '../services/publishing-service.js';
import { escapeHtml, formatDuration, pluralize, statusLabel, statusTone } from '../utils/format-utils.js';
import { friendlyError } from '../utils/error-handler.js';

await initShell({ active: 'upload', title: 'Publishing' });

const params = new URLSearchParams(window.location.search);
const jobId = params.get('job');

const emptyEl = document.getElementById('publishEmpty');
const bodyEl = document.getElementById('publishBody');
const alertEl = document.getElementById('publishAlert');
const commitListEl = document.getElementById('commitList');
const statsEl = document.getElementById('publishStats');
const actionsEl = document.getElementById('publishActions');
const donePanelEl = document.getElementById('donePanel');

let job = null;
let running = false;
let startedMs = null;
let ticker = null;
let loopController = null;

if (!jobId) {
  emptyEl.hidden = false;
  bodyEl.hidden = true;
} else {
  bodyEl.hidden = false;
  boot();
}

async function boot() {
  try {
    const result = await getJob(jobId);
    job = result.job;
    startedMs = job.startedAt ? new Date(job.startedAt).getTime() : Date.now();
    render();
    if (!isDone(job) && job.status !== 'paused') continuePublishing();
  } catch (error) {
    bodyEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector('.empty__title').textContent = 'Could not load this publishing job';
    emptyEl.querySelector('.empty__text').textContent = friendlyError(error);
    emptyEl.querySelector('a').textContent = 'Back to dashboard';
    emptyEl.querySelector('a').href = 'dashboard.html';
  }
}

function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (job && !isDone(job)) renderStats();
  }, 1000);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

async function continuePublishing({ retry = false } = {}) {
  if (running) return;
  running = true;
  loopController = new AbortController();
  render();

  try {
    if (!startedMs) startedMs = Date.now();
    if (retry) {
      const result = await retryJob(jobId);
      job = result.job;
      render();
      if (isDone(job) || job.status === 'paused') return;
    }
    startTicker();
    await runPublishLoop({
      jobId,
      job,
      signal: loopController.signal,
      onUpdate: (updated) => {
        job = updated;
        render();
      },
    });
  } catch (error) {
    console.error(error);
    toast.error('Publishing stopped', friendlyError(error), { duration: 8000 });
    try {
      job = (await getJob(jobId)).job;
    } catch {
      /* keep the last known state */
    }
  } finally {
    running = false;
    stopTicker();
    render();
    if (job && isDone(job)) announceCompletion();
  }
}

function announceCompletion() {
  if (job.status === 'completed') {
    toast.success('Publishing complete', `${pluralize(job.stats.commits, 'commit')} created on ${job.repoFullName}.`);
  } else if (job.status === 'partial') {
    toast.info('Publishing finished with failures', `${job.stats.failed} files could not be committed.`);
  } else if (job.status === 'failed') {
    toast.error('Publishing failed', job.error || 'No commits were created.');
  }
}

/* ---------- Rendering ---------- */

function render() {
  if (!job) return;
  renderHero();
  renderStats();
  renderActions();
  renderCommits();
  renderDone();
  renderBanner();
}

function renderHero() {
  document.getElementById('heroRepo').innerHTML = `
    ${icon('github', { size: 15 })}
    <span>${escapeHtml(job.repoFullName)}</span>
    <span class="badge">${escapeHtml(job.branch)}</span>
    <a class="commit-link" href="${escapeHtml(job.repoUrl)}" target="_blank" rel="noopener noreferrer">
      open ${icon('external-link', { size: 10 })}
    </a>
  `;

  const copy = statusCopy(job);
  document.getElementById('heroStatus').innerHTML = `
    <span class="badge badge--${statusTone(job.status)}">${escapeHtml(copy.title)}</span>
    <span class="badge badge--muted">${escapeHtml(job.stats.total)} files</span>
    <span class="badge badge--muted">${job.mode === 'empty' ? 'new branch' : 'existing branch'}</span>
    <span class="live-indicator ${running ? '' : job.status === 'paused' ? 'live-indicator--error' : 'live-indicator--idle'}" id="liveIndicator">
      <i></i>${running ? 'live' : job.status === 'paused' ? 'paused' : 'idle'}
    </span>
  `;

  const current =
    job.files.find((file) => file.status === 'committing') ||
    job.files.find((file) => file.status === 'processing') ||
    job.files.find((file) => file.status === 'waiting');

  document.getElementById('heroNow').innerHTML = current
    ? `${icon('git-commit', { size: 13 })} <span class="mono-xs">${escapeHtml(current.message)}</span> <span class="faint">·</span> <code>${escapeHtml(current.path)}</code>`
    : `${icon('check-circle', { size: 13 })} ${job.stats.completed} of ${job.stats.total} commits written`;

  document.getElementById('heroProgress').style.setProperty('--p', String(job.stats.percent / 100));
  document.getElementById('heroProgress').setAttribute('aria-valuenow', String(job.stats.percent));

  const metrics = jobMetrics(job, startedMs);
  document.getElementById('heroMeta').innerHTML = `
    <span>${job.stats.completed} / ${job.stats.total} files · ${job.stats.percent}%</span>
    <span>${escapeHtml(metrics.speedLabel)} · ${escapeHtml(formatDuration(metrics.elapsedMs))} elapsed${
      running && metrics.etaMs ? ` · ~${escapeHtml(metrics.etaLabel)} remaining` : ''
    }</span>
  `;

  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - job.stats.percent / 100);
  document.getElementById('heroRing').innerHTML = `
    <div class="ring" style="--p:${job.stats.percent / 100}">
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle class="ring__track" cx="66" cy="66" r="${radius}" fill="none" stroke-width="8" />
        <circle class="ring__value" cx="66" cy="66" r="${radius}" fill="none" stroke-width="8"
          stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" />
      </svg>
      <div class="ring__label">
        <strong>${job.stats.percent}%</strong>
        <span>complete</span>
      </div>
    </div>
  `;
}

function renderStats() {
  if (!job) return;
  const metrics = jobMetrics(job, startedMs);
  statsEl.innerHTML = [
    { label: 'Total files', value: String(job.stats.total) },
    { label: 'Commits created', value: String(job.stats.completed) },
    { label: 'Failed', value: String(job.stats.failed) },
    {
      label: running ? 'Elapsed / ETA' : 'Duration',
      value: running
        ? `${formatDuration(metrics.elapsedMs)} / ${metrics.etaMs ? formatDuration(metrics.etaMs) : '—'}`
        : job.finishedAt && job.startedAt
          ? formatDuration(new Date(job.finishedAt) - new Date(job.startedAt))
          : formatDuration(metrics.elapsedMs),
    },
  ]
    .map(
      (item) => `
      <div class="publish-stat">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </div>
    `
    )
    .join('');
}

function renderActions() {
  const buttons = [];
  const openRepo = `<a class="btn btn--secondary" href="${escapeHtml(job.repoUrl)}" target="_blank" rel="noopener noreferrer">${icon('github', { size: 15 })} Open repository</a>`;
  const newPublish = `<a class="btn btn--secondary" href="upload.html">${icon('folder-up', { size: 15 })} Publish another folder</a>`;

  if (running) {
    buttons.push(
      `<button class="btn btn--danger" type="button" id="cancelButton">${icon('pause', { size: 15 })} Cancel publishing</button>`,
      openRepo
    );
  } else if (job.status === 'paused') {
    buttons.push(
      `<button class="btn btn--primary" type="button" id="resumeButton">${icon('play', { size: 15 })} Resume publishing</button>`
    );
    if (job.stats.failed > 0) {
      buttons.push(
        `<button class="btn btn--secondary" type="button" id="retryButton">${icon('refresh', { size: 15 })} Retry failed files</button>`
      );
    }
    buttons.push(openRepo);
  } else if (job.status === 'completed') {
    buttons.push(
      `<a class="btn btn--primary" href="${escapeHtml(job.repoUrl)}" target="_blank" rel="noopener noreferrer">${icon('github', { size: 15 })} Open repository</a>`,
      `<a class="btn btn--secondary" href="${escapeHtml(job.repoUrl)}/commits/${encodeURIComponent(job.branch)}" target="_blank" rel="noopener noreferrer">${icon('git-commit', { size: 15 })} View commit history</a>`,
      newPublish
    );
  } else if (isDone(job)) {
    if (job.stats.failed > 0) {
      buttons.push(
        `<button class="btn btn--primary" type="button" id="retryButton">${icon('refresh', { size: 15 })} Retry failed files</button>`
      );
    }
    buttons.push(openRepo, newPublish);
  } else {
    buttons.push(
      `<button class="btn btn--primary" type="button" id="startButton">${icon('play', { size: 15 })} Start publishing</button>`
    );
  }

  actionsEl.innerHTML = buttons.join('');

  document.getElementById('cancelButton')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Cancel this publishing job?',
      message:
        'Files already committed stay on GitHub. Remaining files will be marked as skipped. This cannot be undone.',
      confirmLabel: 'Cancel job',
      cancelLabel: 'Keep publishing',
      danger: true,
    });
    if (!confirmed) return;
    loopController?.abort();
    try {
      const result = await cancelJob(jobId);
      job = result.job;
      running = false;
      stopTicker();
      render();
      toast.info('Publishing cancelled', 'Committed files remain on GitHub.');
    } catch (error) {
      toast.error('Could not cancel', friendlyError(error));
    }
  });

  document.getElementById('resumeButton')?.addEventListener('click', () => continuePublishing());
  document.getElementById('retryButton')?.addEventListener('click', () => continuePublishing({ retry: true }));
  document.getElementById('startButton')?.addEventListener('click', () => continuePublishing());
}

function renderCommits() {
  const files = job.files || [];
  const completed = files.filter((file) => file.status === 'completed').length;
  document.getElementById('commitListSummary').textContent = `${completed} of ${files.length} commits written${
    job.stats.failed > 0 ? ` · ${job.stats.failed} failed` : ''
  }`;

  // Commit order is the publishing plan; the current file is highlighted in place.
  commitListEl.innerHTML = files.map((file) => commitRowHtml(file)).join('');
}

function renderBanner() {
  if (job.status === 'paused') {
    alertEl.innerHTML = `
      <div class="publish-banner publish-banner--warning">
        ${icon('alert-triangle', { size: 18 })}
        <div class="publish-banner__body">
          <strong>${job.blockedReason === 'conflict' ? 'Branch conflict — publishing stopped safely' : 'Publishing paused'}</strong>
          <p>${escapeHtml(job.error || 'Resume when you are ready. Nothing was force-pushed.')}</p>
          <p>${
            job.blockedReason === 'conflict'
              ? 'The branch head changed while publishing. Review the repository, then resume — CommitCraft verifies the latest state before writing.'
              : 'Resume re-checks the branch head before committing anything.'
          }</p>
        </div>
      </div>
    `;
    return;
  }
  if (job.status === 'partial') {
    alertEl.innerHTML = `
      <div class="publish-banner publish-banner--warning">
        ${icon('alert-circle', { size: 18 })}
        <div class="publish-banner__body">
          <strong>${job.stats.completed} of ${job.stats.total} files published</strong>
          <p>${job.stats.failed} ${job.stats.failed === 1 ? 'file needs' : 'files need'} a retry. Successful commits are kept.</p>
        </div>
      </div>
    `;
    return;
  }
  if (job.status === 'failed') {
    alertEl.innerHTML = `
      <div class="publish-banner publish-banner--error">
        ${icon('alert-circle', { size: 18 })}
        <div class="publish-banner__body">
          <strong>Publishing failed</strong>
          <p>${escapeHtml(job.error || 'No commits were created. Check the job details and retry.')}</p>
        </div>
      </div>
    `;
    return;
  }
  if (job.status === 'cancelled') {
    alertEl.innerHTML = `
      <div class="publish-banner">
        ${icon('info', { size: 18 })}
        <div class="publish-banner__body">
          <strong>Job cancelled</strong>
          <p>${job.stats.completed} commits were already created and remain on GitHub.</p>
        </div>
      </div>
    `;
    return;
  }
  alertEl.innerHTML = '';
}

function renderDone() {
  if (job.status !== 'completed') {
    donePanelEl.innerHTML = '';
    return;
  }
  donePanelEl.innerHTML = `
    <div class="card">
      <div class="done-panel">
        <span class="done-panel__icon">${icon('check-circle', { size: 26 })}</span>
        <h2 class="card__title" style="font-size:var(--text-xl)">All ${job.stats.total} commits published</h2>
        <p class="text-sm muted" style="max-width:52ch">
          ${escapeHtml(job.repoFullName)} · ${escapeHtml(job.branch)} now contains ${job.stats.completed} new
          commits, each with its own message, SHA and diff.
        </p>
        <div class="row" style="gap:var(--space-2);flex-wrap:wrap;justify-content:center">
          <a class="btn btn--primary" href="${escapeHtml(job.repoUrl)}" target="_blank" rel="noopener noreferrer">
            ${icon('github', { size: 15 })} Open repository
          </a>
          <a class="btn btn--secondary" href="history.html">View history</a>
          <a class="btn btn--ghost" href="upload.html">Publish another folder</a>
        </div>
      </div>
    </div>
  `;
}

window.addEventListener('beforeunload', () => {
  loopController?.abort();
  stopTicker();
});
