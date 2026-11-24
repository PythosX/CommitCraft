/** Commit message studio + final plan review. */

import { initShell } from '../components/app-shell.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { loadProject, clearProject } from '../services/upload-service.js';
import { api } from '../core/api-client.js';
import { getSelectedRepository, setTemplatePreference, store } from '../core/state-manager.js';
import {
  applyTemplateToAll,
  generateMessage,
  moveFile,
  planPreviewText,
  validateMessages,
} from '../services/commit-service.js';
import { createJob } from '../services/publishing-service.js';
import { APP_CONFIG } from '../config/app-config.js';
import { basename, folderOf } from '../utils/path-utils.js';
import { escapeHtml, formatBytes, pluralize } from '../utils/format-utils.js';
import { friendlyError } from '../utils/error-handler.js';
import { validateCommitMessage } from '../utils/validation.js';

await initShell({ active: 'upload', title: 'Commit plan' });

const project = await loadProject();
const emptyEl = document.getElementById('planEmpty');
const layoutEl = document.getElementById('planLayout');
const alertEl = document.getElementById('planAlert');

if (!project || !project.files?.length) {
  emptyEl.hidden = false;
  layoutEl.hidden = true;
  throw new Error('NO_PROJECT');
}

let plan = project.files.filter((file) => file.selected && !file.excluded && file.content);
if (plan.length === 0) {
  emptyEl.hidden = false;
  layoutEl.hidden = true;
  emptyEl.querySelector('.empty__text').textContent =
    'Every file in the last upload was excluded or deselected. Upload the folder again and select at least one file.';
  throw new Error('NO_FILES');
}

layoutEl.hidden = false;

const destination = project.destination || getSelectedRepository();
let template = store.get().template || 'add';
let settings = { publishMode: 'standard', defaultTemplate: template };
let publishing = false;

/* Seed any missing messages. */
for (const file of plan) {
  if (!file.message) file.message = generateMessage(file.path, file.existed ? 'update' : template);
}

/* Destination warning */
if (destination) {
  alertEl.innerHTML = `
    <div class="alert alert--info">
      ${icon('git-branch', { size: 16 })}
      <div class="alert__body">
        <span class="alert__title">Publishing to ${escapeHtml(destination.fullName)} · ${escapeHtml(destination.branch || destination.defaultBranch)}</span>
        <span class="alert__text">${pluralize(plan.length, 'file')} will be committed individually. Existing files in the repository stay untouched.</span>
      </div>
      <a class="btn btn--ghost btn--sm" href="repositories.html">Change</a>
    </div>
  `;
} else {
  alertEl.innerHTML = `
    <div class="alert alert--warning">
      ${icon('alert-triangle', { size: 16 })}
      <div class="alert__body">
        <span class="alert__title">No repository selected</span>
        <span class="alert__text">Choose a destination before publishing. Your messages are kept.</span>
      </div>
      <a class="btn btn--secondary btn--sm" href="repositories.html">Choose repository</a>
    </div>
  `;
}

api
  .get('/api/settings')
  .then((result) => {
    settings = { ...settings, ...(result.settings || {}) };
    applyPublishMode();
  })
  .catch(() => applyPublishMode());

document.querySelectorAll('[data-template]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.template === template));
  button.addEventListener('click', () => {
    template = button.dataset.template;
    setTemplatePreference(template);
    document.querySelectorAll('[data-template]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    applyTemplateToAll(plan, template);
    renderEditor();
    renderSummary();
    toast.success('Template applied', `Messages now follow “${APP_CONFIG.templates.find((item) => item.id === template).pattern}”.`);
  });
});

document.getElementById('resetAll').addEventListener('click', () => {
  applyTemplateToAll(plan, template);
  renderEditor();
  renderSummary();
  toast.info('Messages reset', 'Every message was regenerated from the current template.');
});

function renderEditor() {
  const list = document.getElementById('editorList');
  document.getElementById('editorSummary').textContent = `${pluralize(plan.length, 'file')} selected · ${formatBytes(
    plan.reduce((total, file) => total + file.size, 0)
  )}`;

  list.innerHTML = plan
    .map(
      (file, index) => `
      <div class="editor-row" data-path="${escapeHtml(file.path)}">
        <span class="editor-row__index">${String(index + 1).padStart(2, '0')}</span>
        <div class="editor-row__body">
          <div class="editor-row__path">
            <span>${escapeHtml(basename(file.path))}</span>
            ${folderOf(file.path) !== 'root' ? `<span class="badge badge--muted">${escapeHtml(folderOf(file.path))}/</span>` : ''}
            ${file.existed ? '<span class="badge badge--warning">update</span>' : '<span class="badge badge--muted">new</span>'}
            <span class="tree-size">${formatBytes(file.size)}</span>
          </div>
          <input class="input editor-row__input" type="text" maxlength="500"
            aria-label="Commit message for ${escapeHtml(file.path)}"
            value="${escapeHtml(file.message)}" data-message-index="${index}" />
          <span class="editor-row__error" data-error-index="${index}" hidden></span>
        </div>
        <div class="editor-row__controls">
          <button class="icon-btn" type="button" data-reset-index="${index}" title="Reset message" aria-label="Reset message for ${escapeHtml(file.path)}">
            ${icon('refresh', { size: 14 })}
          </button>
          <button class="icon-btn" type="button" data-up-index="${index}" title="Move up" aria-label="Move ${escapeHtml(file.path)} up" ${index === 0 ? 'disabled' : ''}>
            ${icon('arrow-up', { size: 14 })}
          </button>
          <button class="icon-btn" type="button" data-down-index="${index}" title="Move down" aria-label="Move ${escapeHtml(file.path)} down" ${index === plan.length - 1 ? 'disabled' : ''}>
            ${icon('arrow-down', { size: 14 })}
          </button>
        </div>
      </div>
    `
    )
    .join('');

  list.querySelectorAll('[data-message-index]').forEach((input) => {
    input.addEventListener('input', () => {
      const index = Number(input.dataset.messageIndex);
      plan[index].message = input.value;
      updateRowError(index);
      renderSummary();
    });
  });

  list.querySelectorAll('[data-reset-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.resetIndex);
      plan[index].message = generateMessage(plan[index].path, plan[index].existed ? 'update' : template);
      renderEditor();
      renderSummary();
    });
  });

  list.querySelectorAll('[data-up-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.upIndex);
      plan = moveFile(plan, index, -1);
      renderEditor();
      renderSummary();
      list.querySelector(`[data-message-index="${Math.max(0, index - 1)}"]`)?.focus();
    });
  });

  list.querySelectorAll('[data-down-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.downIndex);
      plan = moveFile(plan, index, 1);
      renderEditor();
      renderSummary();
      list.querySelector(`[data-message-index="${Math.min(plan.length - 1, index + 1)}"]`)?.focus();
    });
  });
}

function updateRowError(index) {
  const errorEl = document.querySelector(`[data-error-index="${index}"]`);
  const input = document.querySelector(`[data-message-index="${index}"]`);
  if (!errorEl || !input) return;
  const error = validateCommitMessage(plan[index].message);
  errorEl.hidden = !error;
  errorEl.textContent = error;
  input.setAttribute('aria-invalid', String(Boolean(error)));
}

function renderSummary() {
  const validation = validateMessages(plan);
  const totalBytes = plan.reduce((total, file) => total + file.size, 0);

  document.getElementById('planCount').textContent = String(plan.length);
  document.getElementById('planCountLabel').textContent =
    plan.length === 1 ? 'commit will be created' : 'commits will be created';
  document.getElementById('planRepo').textContent = destination?.fullName || 'Not selected';
  document.getElementById('planBranch').textContent = destination?.branch || destination?.defaultBranch || '—';
  document.getElementById('planOrder').textContent = 'As listed below';
  document.getElementById('planSize').textContent = formatBytes(totalBytes);
  document.getElementById('planPathCount').textContent = pluralize(plan.length, 'file');

  document.getElementById('planList').innerHTML = plan
    .map(
      (file, index) => `
      <li>
        <span class="plan-list__num">${index + 1}.</span>
        <span class="plan-list__text"><b>${escapeHtml(file.message || 'Missing message')}</b></span>
      </li>
    `
    )
    .join('');

  const publishButton = document.getElementById('publishButton');
  publishButton.disabled = !validation.valid || !destination || publishing;
  publishButton.innerHTML = publishing
    ? `${icon('loader', { size: 15, className: 'spin' })} Creating job…`
    : `Publish ${pluralize(plan.length, 'file')} as ${pluralize(plan.length, 'commit')} ${icon('arrow-right', { size: 15 })}`;

  document.getElementById('confirmTitle').textContent = validation.valid ? 'Ready to publish' : 'Fix message errors';
  document.getElementById('confirmText').textContent = !destination
    ? 'Choose a repository to continue.'
    : validation.valid
      ? `${pluralize(plan.length, 'commit')} on ${destination.fullName} · ${destination.branch}. Existing files are preserved.`
      : `${validation.errors.size} ${validation.errors.size === 1 ? 'message needs' : 'messages need'} attention.`;

  applyPublishMode();
}

function applyPublishMode() {
  const careful = settings.publishMode === 'careful';
  const container = document.getElementById('carefulConfirm');
  const input = document.getElementById('carefulInput');
  container.hidden = !careful;

  const syncButton = () => {
    const confirmed = !careful || input.value.trim().toUpperCase() === 'PUBLISH';
    document.getElementById('publishButton').disabled =
      publishing || !confirmed || !validateMessages(plan).valid || !destination;
  };

  input.oninput = syncButton;
  syncButton();
}

document.getElementById('publishButton').addEventListener('click', async () => {
  const validation = validateMessages(plan);
  if (!validation.valid) {
    toast.error('Check your commit messages', 'Every message needs 1–500 characters.');
    return;
  }
  if (!destination) {
    toast.error('No destination selected', 'Choose a repository and branch first.');
    return;
  }
  if (settings.publishMode === 'careful') {
    const confirmation = document.getElementById('carefulInput').value.trim().toUpperCase();
    if (confirmation !== 'PUBLISH') {
      toast.error('Confirmation required', 'Type PUBLISH to confirm this plan.');
      return;
    }
  }

  publishing = true;
  renderSummary();

  try {
    const payload = plan.map((file) => ({
      path: file.path,
      message: file.message.trim(),
      content: file.content,
    }));

    const result = await createJob({
      owner: destination.owner,
      repo: destination.repo,
      branch: destination.branch || destination.defaultBranch,
      files: payload,
    });

    await clearProject();
    toast.success('Commit plan created', `${pluralize(payload.length, 'commit')} queued. Starting publishing…`);
    window.location.href = `publishing.html?job=${encodeURIComponent(result.job.id)}`;
  } catch (error) {
    publishing = false;
    renderSummary();
    toast.error('Could not create the publishing job', friendlyError(error), { duration: 8000 });
    console.error(planPreviewText(plan, {
      owner: destination.owner,
      repo: destination.repo,
      branch: destination.branch,
    }));
  }
});

renderEditor();
renderSummary();
