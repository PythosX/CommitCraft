/** Repository selection, creation and target branch choice. */

import { initShell } from '../components/app-shell.js';
import { icon } from '../components/icons.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { createRepository, fetchRepository, filterRepositories, listRepositories, sortRepositories } from '../services/repository-service.js';
import { getSelectedRepository, selectRepository } from '../core/state-manager.js';
import { navigate } from '../core/router.js';
import { validateBranchName, validateRepoName } from '../utils/validation.js';
import { escapeHtml, timeAgo } from '../utils/format-utils.js';
import { friendlyError } from '../utils/error-handler.js';

await initShell({ active: 'repositories', title: 'Repositories' });

let repositories = [];
let visibility = 'all';
let query = '';
let sortMode = 'updated';
let draft = null;
let detail = null;
let branches = [];
let selectedBranch = '';

const listEl = document.getElementById('repoList');
const countEl = document.getElementById('repoCount');
const panelEl = document.getElementById('selectionPanel');
const alertEl = document.getElementById('repoAlert');

async function loadRepositories({ quiet = false } = {}) {
  if (!quiet) {
    listEl.innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton skeleton--card"></div>').join('');
  }
  try {
    const result = await listRepositories({ perPage: 100 });
    repositories = result.repositories || [];
    renderList();
    renderAlert();
  } catch (error) {
    listEl.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <span class="empty__icon">${icon('alert-circle', { size: 18 })}</span>
        <h3 class="empty__title">Could not load repositories</h3>
        <p class="empty__text">${escapeHtml(friendlyError(error))}</p>
        <button class="btn btn--secondary btn--sm" type="button" id="retryRepos">Try again</button>
      </div>
    `;
    document.getElementById('retryRepos')?.addEventListener('click', () => loadRepositories());
    toast.error('Could not load repositories', friendlyError(error));
  }
}

function renderAlert() {
  const selected = getSelectedRepository();
  if (!selected) {
    alertEl.innerHTML = '';
    return;
  }
  alertEl.innerHTML = `
    <div class="alert alert--info">
      ${icon('check-circle', { size: 16 })}
      <div class="alert__body">
        <span class="alert__title">Destination saved: ${escapeHtml(selected.fullName)} · ${escapeHtml(selected.branch || selected.defaultBranch)}</span>
        <span class="alert__text">Change it below, then continue to upload your folder.</span>
      </div>
      <a class="btn btn--secondary btn--sm" href="upload.html">Continue to upload</a>
    </div>
  `;
}

function renderList() {
  const filtered = sortRepositories(filterRepositories(repositories, { query, visibility }), sortMode);
  countEl.textContent = `${filtered.length} of ${repositories.length} repositories with push access`;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <span class="empty__icon">${icon('folder-open', { size: 18 })}</span>
        <h3 class="empty__title">${repositories.length === 0 ? 'No repositories yet' : 'Nothing matches that filter'}</h3>
        <p class="empty__text">
          ${
            repositories.length === 0
              ? 'Create your first repository and CommitCraft will bootstrap the initial commit for you.'
              : 'Try a different search term or visibility filter.'
          }
        </p>
        ${
          repositories.length === 0
            ? '<button class="btn btn--primary btn--sm" type="button" id="emptyCreate">Create repository</button>'
            : ''
        }
      </div>
    `;
    document.getElementById('emptyCreate')?.addEventListener('click', openCreateRepository);
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (repo) => `
      <button class="repo-card" type="button" data-repo="${escapeHtml(repo.fullName)}"
        aria-pressed="${draft?.fullName === repo.fullName ? 'true' : 'false'}">
        <div class="repo-card__top">
          <span style="color:var(--text-muted)">${icon(repo.private ? 'lock' : 'github', { size: 14 })}</span>
          <span class="repo-card__name" title="${escapeHtml(repo.fullName)}">${escapeHtml(repo.fullName)}</span>
          <span class="badge badge--muted" style="margin-left:auto">${escapeHtml(repo.defaultBranch || 'main')}</span>
        </div>
        <div class="repo-card__desc">${escapeHtml(repo.description || 'No description')}</div>
        <div class="repo-card__meta">
          <span>${repo.private ? 'Private' : 'Public'}</span>
          <span>·</span>
          <span>Updated ${escapeHtml(timeAgo(repo.updatedAt))}</span>
        </div>
      </button>
    `
    )
    .join('');

  listEl.querySelectorAll('[data-repo]').forEach((button) => {
    button.addEventListener('click', () => selectRepo(button.dataset.repo));
  });
}

async function selectRepo(fullName) {
  const repo = repositories.find((item) => item.fullName === fullName);
  if (!repo) return;
  draft = repo;
  renderList();
  panelEl.innerHTML = `
    <div class="stack">
      <div class="skeleton skeleton--line" style="width:60%"></div>
      <div class="skeleton skeleton--card"></div>
    </div>
  `;

  try {
    detail = await fetchRepository(repo.owner, repo.name);
    branches = detail.branches || [];
    selectedBranch = branches.some((branch) => branch.name === detail.defaultBranch)
      ? detail.defaultBranch
      : branches[0]?.name || detail.defaultBranch;
    renderPanel();
  } catch (error) {
    panelEl.innerHTML = `
      <div class="alert alert--error">${icon('alert-circle', { size: 16 })}
        <div class="alert__body">
          <span class="alert__title">Could not read that repository</span>
          <span class="alert__text">${escapeHtml(friendlyError(error))}</span>
        </div>
      </div>
    `;
  }
}

function renderPanel() {
  if (!draft) return;
  const isEmpty = branches.length === 0;
  const hasExistingFiles = !isEmpty;

  panelEl.innerHTML = `
    <div class="stack">
      <div>
        <div class="repo-card__name" style="font-size:var(--text-sm)">${escapeHtml(draft.fullName)}</div>
        <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
          <span class="badge ${draft.private ? 'badge--warning' : 'badge--muted'}">${draft.private ? 'Private' : 'Public'}</span>
          <span class="badge">default · ${escapeHtml(detail?.defaultBranch || draft.defaultBranch)}</span>
          ${isEmpty ? '<span class="badge badge--accent">empty repository</span>' : ''}
        </div>
        <p class="card__desc" style="margin-top:8px">${escapeHtml(draft.description || 'No description')}</p>
      </div>

      <div class="divider"></div>

      ${
        isEmpty
          ? `<div class="field">
              <label class="field__label" for="newBranchName">New branch name</label>
              <input class="input mono-xs" id="newBranchName" value="${escapeHtml(detail?.defaultBranch || draft.defaultBranch || 'main')}" autocomplete="off" spellcheck="false" />
              <span class="field__hint">This repository has no commits yet. The first file creates the initial commit and branch.</span>
              <span class="field__error" id="branchError" hidden></span>
            </div>`
          : `<div class="field">
              <label class="field__label" for="branchSelect">Target branch</label>
              <select class="select mono-xs" id="branchSelect">
                ${branches
                  .map(
                    (branch) =>
                      `<option value="${escapeHtml(branch.name)}"${
                        branch.name === selectedBranch ? ' selected' : ''
                      }>${escapeHtml(branch.name)}${branch.protected ? ' (protected)' : ''}</option>`
                  )
                  .join('')}
              </select>
              <span class="field__hint">Commits are appended on top of this branch.</span>
            </div>`
      }

      ${
        hasExistingFiles
          ? `<div class="warning-box">
              ${icon('alert-triangle', { size: 15 })}
              <div>
                <strong>Publishing to an existing branch.</strong>
                Existing files are preserved and every new commit is a fast-forward. Nothing is force-pushed, but
                the branch history will gain commits.
              </div>
            </div>`
          : `<div class="alert alert--info">
              ${icon('info', { size: 15 })}
              <div class="alert__body">
                <span class="alert__text">The first commit will be a root commit. Subsequent files chain onto it.</span>
              </div>
            </div>`
      }

      <div class="kv" style="font-size:var(--text-xs)">
        <dt>Repository</dt><dd>${escapeHtml(draft.fullName)}</dd>
        <dt>Access</dt><dd>${draft.permissions?.push === false ? 'Read only' : 'Push access'}</dd>
        <dt>Updated</dt><dd>${escapeHtml(timeAgo(draft.updatedAt))}</dd>
      </div>

      <div class="row" style="gap:var(--space-2)">
        <a class="btn btn--ghost btn--sm" href="${escapeHtml(draft.htmlUrl)}" target="_blank" rel="noopener noreferrer">
          ${icon('external-link', { size: 13 })} Open on GitHub
        </a>
      </div>

      <button class="btn btn--primary btn--block" id="continueButton" type="button"${
        draft.permissions?.push === false ? ' disabled' : ''
      }>
        Continue to upload
        ${icon('arrow-right', { size: 15 })}
      </button>
    </div>
  `;

  const branchSelect = document.getElementById('branchSelect');
  branchSelect?.addEventListener('change', () => {
    selectedBranch = branchSelect.value;
  });

  const newBranchInput = document.getElementById('newBranchName');
  newBranchInput?.addEventListener('input', () => {
    selectedBranch = newBranchInput.value.trim();
    const errorEl = document.getElementById('branchError');
    const error = validateBranchName(selectedBranch);
    errorEl.hidden = !error;
    errorEl.textContent = error;
    newBranchInput.setAttribute('aria-invalid', String(Boolean(error)));
  });
  if (newBranchInput) selectedBranch = newBranchInput.value.trim();

  document.getElementById('continueButton')?.addEventListener('click', () => {
    const error = validateBranchName(selectedBranch);
    if (error) {
      const errorEl = document.getElementById('branchError');
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = error;
      }
      toast.error('Check the branch name', error);
      return;
    }
    selectRepository({
      owner: draft.owner,
      repo: draft.name,
      fullName: draft.fullName,
      defaultBranch: detail?.defaultBranch || draft.defaultBranch,
      branch: selectedBranch,
      private: draft.private,
    });
    toast.success('Destination saved', `${draft.fullName} · ${selectedBranch}`);
    navigate('upload');
  });
}

function openCreateRepository() {
  const form = document.createElement('form');
  form.className = 'stack';
  form.innerHTML = `
    <div class="field">
      <label class="field__label" for="repoName">Repository name</label>
      <input class="input mono-xs" id="repoName" name="name" placeholder="my-portfolio" autocomplete="off" spellcheck="false" required />
      <span class="field__hint">Letters, numbers, dots, hyphens and underscores.</span>
      <span class="field__error" id="repoNameError" hidden></span>
    </div>
    <div class="field">
      <label class="field__label" for="repoDescription">Description <span class="field__optional">optional</span></label>
      <input class="input" id="repoDescription" name="description" placeholder="A short description" autocomplete="off" maxlength="350" />
    </div>
    <div class="field">
      <label class="checkbox">
        <input type="checkbox" id="repoPrivate" name="private" />
        <span>Private repository</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" id="repoAutoInit" name="autoInit" checked />
        <span>Initialize with a README (recommended — gives the branch an initial commit)</span>
      </label>
    </div>
  `;

  openModal({
    title: 'Create a GitHub repository',
    body: form,
    confirmLabel: 'Create repository',
    cancelLabel: 'Cancel',
  }).then(async (result) => {
    if (result !== 'confirm') return;
    const name = form.querySelector('#repoName').value.trim();
    const error = validateRepoName(name);
    if (error) {
      const errorEl = form.querySelector('#repoNameError');
      errorEl.hidden = false;
      errorEl.textContent = error;
      toast.error('Check the repository name', error);
      return;
    }
    try {
      const repo = await createRepository({
        name,
        description: form.querySelector('#repoDescription').value.trim(),
        isPrivate: form.querySelector('#repoPrivate').checked,
        autoInit: form.querySelector('#repoAutoInit').checked,
      });
      toast.success('Repository created', `${repo.fullName} is ready to publish to.`);
      repositories = [repo, ...repositories.filter((item) => item.fullName !== repo.fullName)];
      renderList();
      selectRepo(repo.fullName);
    } catch (error) {
      toast.error('Could not create repository', friendlyError(error), { duration: 7000 });
    }
  });
}

/* Wiring */
document.getElementById('repoSearch')?.addEventListener('input', (event) => {
  query = event.target.value;
  renderList();
});

document.getElementById('repoSort')?.addEventListener('change', (event) => {
  sortMode = event.target.value;
  renderList();
});

document.querySelectorAll('[data-visibility]').forEach((button) => {
  button.addEventListener('click', () => {
    visibility = button.dataset.visibility;
    document.querySelectorAll('[data-visibility]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderList();
  });
});

document.getElementById('refreshRepos')?.addEventListener('click', () => {
  loadRepositories();
  toast.info('Refreshing repositories', 'Fetching the latest list from GitHub.');
});

document.getElementById('newRepoButton')?.addEventListener('click', openCreateRepository);

const saved = getSelectedRepository();
if (saved) {
  draft = { ...saved, permissions: { push: true } };
}

loadRepositories().then(() => {
  if (saved) {
    const match = repositories.find((repo) => repo.fullName === saved.fullName);
    selectRepo(match ? match.fullName : saved.fullName);
  }
});
