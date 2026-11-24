/** Dashboard: real statistics, recent jobs and repositories. */

import { initShell } from '../components/app-shell.js';
import { icon } from '../components/icons.js';
import { fetchHistory } from '../services/history-service.js';
import { listRepositories } from '../services/repository-service.js';
import { selectRepository } from '../core/state-manager.js';
import { escapeHtml, formatNumber, timeAgo, statusLabel, statusTone, formatBytes } from '../utils/format-utils.js';
import { friendlyError } from '../utils/error-handler.js';
import { toast } from '../components/toast.js';

const session = await initShell({ active: 'dashboard', title: 'Dashboard' });
renderWelcome(session);

function renderWelcome(session) {
  const container = document.getElementById('welcome');
  if (!container) return;
  const user = session.user || {};
  const initials = (user.name || user.login || '?')
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  container.innerHTML = `
    <div class="welcome__main">
      ${
        user.avatarUrl
          ? `<img class="avatar avatar--lg" src="${escapeHtml(user.avatarUrl)}" alt="" width="56" height="56" referrerpolicy="no-referrer" />`
          : `<span class="avatar avatar--lg" style="display:grid;place-items:center;font-size:18px;font-weight:600">${escapeHtml(initials)}</span>`
      }
      <div class="welcome__text">
        <h2>Welcome back, ${escapeHtml((user.name || user.login || 'there').split(' ')[0])}</h2>
        <p>Signed in as <span class="mono-xs">@${escapeHtml(user.login || 'unknown')}</span> · ready to craft commits.</p>
      </div>
    </div>
    <div class="welcome__actions">
      <a class="btn btn--secondary btn--sm" href="${escapeHtml(user.htmlUrl || 'https://github.com')}" target="_blank" rel="noopener noreferrer">
        ${icon('github', { size: 14 })} GitHub profile
      </a>
      <a class="btn btn--primary btn--sm" href="upload.html">
        ${icon('folder-up', { size: 14 })} New publish
      </a>
    </div>
  `;
}

async function loadDashboard() {
  const statsEl = document.getElementById('stats');
  let historyData = null;
  let repos = [];

  const [historyResult, repoResult] = await Promise.allSettled([
    fetchHistory(),
    listRepositories({ perPage: 30 }),
  ]);

  if (historyResult.status === 'fulfilled') historyData = historyResult.value;
  else toast.error('Could not load history', friendlyError(historyResult.reason), { duration: 6000 });

  if (repoResult.status === 'fulfilled') repos = repoResult.value.repositories || [];
  else toast.error('Could not load repositories', friendlyError(repoResult.reason), { duration: 6000 });

  const totals = historyData?.totals || { commits: 0, files: 0, jobs: 0 };
  const history = historyData?.history || [];
  const activeJobs = historyData?.recentJobs || [];

  statsEl.innerHTML = [
    {
      label: 'Commits created',
      value: totals.commits,
      icon: 'git-commit',
      meta: totals.commits === 0 ? 'No commits published yet' : 'Genuine Git commits',
      accent: true,
    },
    {
      label: 'Files published',
      value: totals.files,
      icon: 'file',
      meta: totals.files === 0 ? 'Nothing published yet' : 'Across all repositories',
    },
    {
      label: 'Publishing jobs',
      value: totals.jobs,
      icon: 'history',
      meta: totals.jobs === 0 ? 'Your first job starts here' : 'Recorded in history',
    },
    {
      label: 'Repositories',
      value: repos.length,
      icon: 'github',
      meta: repos.length === 0 ? 'No repositories found' : 'With push access',
    },
  ]
    .map(
      (stat) => `
      <article class="stat">
        <div class="stat__top">
          <span class="stat__label">${escapeHtml(stat.label)}</span>
          <span class="stat__icon ${stat.accent ? 'stat__icon--accent' : ''}">${icon(stat.icon, { size: 16 })}</span>
        </div>
        <div class="stat__value">${formatNumber(stat.value)}</div>
        <div class="stat__meta">${escapeHtml(stat.meta)}</div>
      </article>
    `
    )
    .join('');

  renderJobs(activeJobs, history);
  renderRepositories(repos);
}

function renderJobs(activeJobs, history) {
  const container = document.getElementById('recentJobs');
  if (!container) return;

  const rows = [
    ...activeJobs.map((job) => ({
      id: job.id,
      repo: job.repoFullName || `${job.owner}/${job.repo}`,
      branch: job.branch,
      status: job.status,
      when: job.updatedAt || job.createdAt,
      detail: `${job.stats?.completed || 0}/${job.stats?.total || 0} commits`,
      href: `publishing.html?job=${encodeURIComponent(job.id)}`,
      live: ['queued', 'running', 'paused'].includes(job.status),
    })),
    ...history
      .filter((record) => !activeJobs.some((job) => job.id === record.id))
      .map((record) => ({
        id: record.id,
        repo: record.repoFullName || `${record.owner}/${record.repo}`,
        branch: record.branch,
        status: record.status,
        when: record.finishedAt,
        detail: `${record.commitsCreated || 0} commits · ${record.filesTotal || 0} files`,
        href: 'history.html',
        live: false,
      })),
  ].slice(0, 6);

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="empty" style="border:0;background:none">
        <span class="empty__icon">${icon('git-commit', { size: 20 })}</span>
        <h3 class="empty__title">No publishing jobs yet</h3>
        <p class="empty__text">Upload a folder and CommitCraft will turn each selected file into its own commit.</p>
        <a class="btn btn--primary btn--sm" href="upload.html">Start your first publish</a>
      </div>
    `;
    return;
  }

  container.innerHTML = rows
    .map(
      (row) => `
      <a class="list-row" href="${row.href}">
        <span class="list-row__icon">${icon(row.live ? 'refresh' : 'git-commit', { size: 15, className: row.live ? 'spin' : '' })}</span>
        <div class="list-row__main">
          <div class="list-row__title">
            <span class="truncate">${escapeHtml(row.repo)}</span>
            <span class="badge">${escapeHtml(row.branch)}</span>
          </div>
          <div class="list-row__meta">
            <span>${escapeHtml(row.detail)}</span>
            <span>·</span>
            <span>${escapeHtml(timeAgo(row.when))}</span>
          </div>
        </div>
        <div class="list-row__side">
          <span class="badge badge--${statusTone(row.status)}">${escapeHtml(statusLabel(row.status))}</span>
        </div>
      </a>
    `
    )
    .join('');
}

function renderRepositories(repos) {
  const container = document.getElementById('recentRepos');
  if (!container) return;

  if (repos.length === 0) {
    container.innerHTML = `
      <div class="empty" style="border:0;background:none;padding:var(--space-5)">
        <span class="empty__icon">${icon('github', { size: 18 })}</span>
        <h3 class="empty__title">No repositories found</h3>
        <p class="empty__text">Create one in the repository screen, or check that your GitHub account has repository access.</p>
        <a class="btn btn--secondary btn--sm" href="repositories.html">Open repositories</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="repo-grid" style="grid-template-columns:minmax(0,1fr)">
      ${repos
        .slice(0, 5)
        .map(
          (repo) => `
        <button class="repo-card" type="button" data-repo="${escapeHtml(repo.fullName)}">
          <div class="repo-card__top">
            <span style="color:var(--text-muted)">${icon(repo.private ? 'lock' : 'github', { size: 14 })}</span>
            <span class="repo-card__name">${escapeHtml(repo.fullName)}</span>
          </div>
          <div class="repo-card__meta">
            <span>${escapeHtml(repo.defaultBranch || 'main')}</span>
            <span>·</span>
            <span>${escapeHtml(timeAgo(repo.updatedAt))}</span>
          </div>
        </button>
      `
        )
        .join('')}
    </div>
  `;

  container.querySelectorAll('[data-repo]').forEach((button) => {
    button.addEventListener('click', () => {
      const repo = repos.find((item) => item.fullName === button.dataset.repo);
      if (!repo) return;
      selectRepository({
        owner: repo.owner,
        repo: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        branch: repo.defaultBranch,
        private: repo.private,
      });
      window.location.href = 'repositories.html';
    });
  });
}

loadDashboard();
