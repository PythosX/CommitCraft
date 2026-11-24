/** Folder upload, file explorer, smart ignore rules and preview. */

import { initShell } from '../components/app-shell.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { mountFileTree } from '../components/file-tree.js';
import { api } from '../core/api-client.js';
import { getSelectedRepository, store } from '../core/state-manager.js';
import { navigate } from '../core/router.js';
import {
  buildProject,
  clearProject,
  collectFromDataTransfer,
  collectFromFileList,
  saveProject,
} from '../services/upload-service.js';
import {
  applyIgnoreRules,
  isSelectable,
  restoreFile,
  searchFiles,
  selectionWithinLimits,
  sortFiles,
  summarize,
} from '../services/file-service.js';
import { seedMessages } from '../services/commit-service.js';
import { APP_CONFIG } from '../config/app-config.js';
import { base64ToText, fileKind, fileIconName, isTextFile } from '../utils/file-utils.js';
import { escapeHtml, formatBytes, pluralize } from '../utils/format-utils.js';
import { friendlyError } from '../utils/error-handler.js';
import { validateIgnorePattern } from '../utils/validation.js';

await initShell({ active: 'upload', title: 'New publish' });

const repo = getSelectedRepository();
let project = null;
let customPatterns = [];
let useDefaults = true;
let view = 'tree';
let query = '';
let sortMode = 'path';
let activeFilePath = null;
let settings = { defaultTemplate: store.get().template || 'add' };
let busy = false;

const dropzone = document.getElementById('dropzone');
const folderInput = document.getElementById('folderInput');
const fileInput = document.getElementById('fileInput');
const explorerCard = document.getElementById('explorerCard');
const statsBar = document.getElementById('statsBar');
const lowerGrid = document.getElementById('lowerGrid');
const fileExplorer = document.getElementById('fileExplorer');
const previewPane = document.getElementById('previewPane');
const previewBadge = document.getElementById('previewBadge');
const summaryBody = document.getElementById('summaryBody');
const continueButton = document.getElementById('continueButton');

/* ---------- Destination chip ---------- */

function renderRepoChip() {
  const container = document.getElementById('repoChip');
  if (!repo) {
    container.innerHTML = `<a class="btn btn--primary" href="repositories.html">Choose a repository ${icon('arrow-right', { size: 15 })}</a>`;
    document.getElementById('uploadAlert').innerHTML = `
      <div class="alert alert--warning">
        ${icon('alert-triangle', { size: 16 })}
        <div class="alert__body">
          <span class="alert__title">No destination selected yet</span>
          <span class="alert__text">You can upload and review files now, but publishing needs a repository and branch.</span>
        </div>
      </div>
    `;
    return;
  }
  container.innerHTML = `
    <span class="chip" title="Publishing target">
      ${icon('git-branch', { size: 13 })}
      ${escapeHtml(repo.fullName)}
      <span class="faint">·</span>
      ${escapeHtml(repo.branch || repo.defaultBranch || 'main')}
    </span>
    <a class="btn btn--ghost btn--sm" href="repositories.html">Change</a>
  `;
  document.getElementById('uploadAlert').innerHTML = '';
}

renderRepoChip();

/* ---------- Settings ---------- */

api
  .get('/api/settings')
  .then((result) => {
    settings = { ...settings, ...(result.settings || {}) };
  })
  .catch(() => {
    /* defaults are fine */
  });

/* ---------- Upload handling ---------- */

function setBusy(next, message) {
  busy = next;
  dropzone.setAttribute('aria-busy', String(next));
  document.getElementById('chooseFolder').disabled = next;
  document.getElementById('chooseFiles').disabled = next;
  const title = document.getElementById('dropTitle');
  if (next && message) title.textContent = message;
  else title.textContent = project ? 'Folder loaded — add more files if you like' : 'Drop your project folder here';
}

async function handleEntries(entries, source) {
  if (busy) return;
  if (!entries || entries.length === 0) {
    toast.info('Nothing to read', 'That selection did not contain any files.');
    return;
  }

  setBusy(true, 'Reading folder…');
  try {
    project = await buildProject(entries, { customPatterns });
    project.files.forEach((file) => {
      file.message = '';
    });
    activeFilePath = null;
    applyIgnoreRules(project.files, { customPatterns, useDefaults });
    renderAll();
    const stats = summarize(project.files);
    toast.success(
      'Folder analysed',
      `${pluralize(stats.totalFiles, 'file')} found, ${stats.selectedFiles} ready to publish.`
    );
    if (stats.excludedFiles > 0) {
      toast.info('Smart ignore applied', `${stats.excludedFiles} files were excluded automatically.`);
    }
    if (source === 'drop') explorerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
    toast.error('Could not read that folder', error.message || friendlyError(error));
  } finally {
    setBusy(false);
  }
}

document.getElementById('chooseFolder').addEventListener('click', () => folderInput.click());
document.getElementById('chooseFiles').addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', (event) => {
  if (event.target.closest('button') || event.target.closest('input')) return;
  folderInput.click();
});
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    folderInput.click();
  }
});

folderInput.addEventListener('change', () => {
  handleEntries(collectFromFileList(folderInput.files), 'picker');
  folderInput.value = '';
});
fileInput.addEventListener('change', () => {
  handleEntries(collectFromFileList(fileInput.files), 'picker');
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((type) =>
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  })
);
['dragleave', 'dragend'].forEach((type) =>
  dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragover'))
);
dropzone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  try {
    const entries = await collectFromDataTransfer(event.dataTransfer);
    await handleEntries(entries, 'drop');
  } catch (error) {
    toast.error('Could not read the dropped folder', friendlyError(error));
  }
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

/* ---------- Rendering ---------- */

function renderAll() {
  if (!project) return;
  const stats = summarize(project.files);
  statsBar.hidden = false;
  statsBar.innerHTML = [
    { label: 'Files', value: String(stats.totalFiles) },
    { label: 'Folders', value: String(stats.folders) },
    { label: 'Total size', value: formatBytes(stats.totalBytes) },
    { label: 'Excluded', value: String(stats.excludedFiles) },
  ]
    .map(
      (item) => `
      <div class="upload-stat">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </div>
    `
    )
    .join('');

  explorerCard.hidden = false;
  lowerGrid.hidden = false;
  renderExplorer();
  renderIgnored();
  renderSummary();
  if (activeFilePath) previewFile(project.files.find((file) => file.path === activeFilePath));
}

function applyFilters(files) {
  let result = searchFiles(files, query);
  if (view === 'list') result = sortFiles(result, sortMode);
  return result;
}

function renderExplorer() {
  const files = applyFilters(project.files);
  const selectedCount = project.files.filter((file) => file.selected && !file.excluded).length;
  document.getElementById('selectionSummary').textContent = `${selectedCount} selected of ${project.files.length} files`;

  if (files.length === 0) {
    fileExplorer.innerHTML = `<div class="preview__placeholder"><p class="text-sm">No files match "${escapeHtml(query)}".</p></div>`;
    return;
  }

  if (view === 'tree') {
    mountFileTree(fileExplorer, {
      files,
      onFocus: (file) => previewFile(project.files.find((item) => item.path === file.path) || file),
      onChange: () => {
        renderSummary();
        renderIgnored();
      },
      isSelectable,
    });
  } else {
    fileExplorer.innerHTML = '';
    fileExplorer.classList.remove('filetree');
    fileExplorer.style.padding = 'var(--space-2)';
    for (const file of files) {
      const row = document.createElement('div');
      row.className = `tree-row${file.excluded ? ' is-excluded' : ''}${file.path === activeFilePath ? ' is-focused' : ''}`;
      row.innerHTML = `
        <label class="checkbox" title="Select ${escapeHtml(file.path)}">
          <input type="checkbox" ${file.selected && !file.excluded ? 'checked' : ''} ${isSelectable(file) ? '' : 'disabled'} aria-label="Select ${escapeHtml(file.path)}" />
        </label>
        <span class="tree-icon ${fileKind(file.path) === 'image' ? 'tree-icon--image' : ''}">${icon(fileIconName(file.path), { size: 16 })}</span>
        <button class="tree-name" type="button" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</button>
        <span class="tree-size">${file.excluded ? escapeHtml(file.excludeReason || 'Excluded') : formatBytes(file.size)}</span>
      `;
      row.querySelector('input').addEventListener('change', (event) => {
        file.selected = event.target.checked;
        renderSummary();
        renderIgnored();
      });
      row.querySelector('.tree-name').addEventListener('click', () => previewFile(file));
      fileExplorer.appendChild(row);
    }
  }

  if (activeFilePath) {
    // keep the focused row highlighted after a remount
    fileExplorer.querySelectorAll('.tree-row').forEach((row) => {
      row.classList.toggle('is-focused', row.dataset.path === activeFilePath);
    });
  }
}

function previewFile(file) {
  if (!file) {
    previewPane.innerHTML = `
      <div class="preview__placeholder">
        <p class="text-sm">Select a file to preview its text.</p>
      </div>
    `;
    previewBadge.hidden = true;
    return;
  }

  activeFilePath = file.path;
  fileExplorer.querySelectorAll('.tree-row').forEach((row) => {
    row.classList.toggle('is-focused', row.dataset.path === file.path);
  });

  previewBadge.hidden = false;
  previewBadge.textContent = fileKind(file.path).toUpperCase();

  const meta = `
    <div class="preview__meta">
      <span class="preview__path">${escapeHtml(file.path)}</span>
      <div class="preview__badges">
        <span class="badge">${formatBytes(file.size)}</span>
        <span class="badge">${escapeHtml(fileKind(file.path))}</span>
        ${file.excluded ? '<span class="badge badge--warning">excluded</span>' : ''}
      </div>
    </div>
  `;

  if (!file.content) {
    previewPane.innerHTML = `
      ${meta}
      <div class="preview__binary">
        ${icon('file', { size: 28 })}
        <strong class="text-sm">Preview unavailable</strong>
        <span class="text-xs">${escapeHtml(file.skipReason || 'This file was not loaded (size or count limit).')}</span>
      </div>
    `;
    return;
  }

  if (!isTextFile(file.path)) {
    previewPane.innerHTML = `
      ${meta}
      <div class="preview__binary">
        ${icon(fileIconName(file.path), { size: 30 })}
        <strong class="text-sm">Binary file</strong>
        <span class="text-xs">${escapeHtml(file.type || 'Unknown MIME type')} · ${formatBytes(file.size)}</span>
        <span class="text-xs faint">Binary files are published byte-for-byte. No preview is generated.</span>
      </div>
    `;
    return;
  }

  const text = base64ToText(file.content);
  const limit = 40_000;
  const clipped = text.length > limit ? `${text.slice(0, limit)}\n\n… preview truncated (${text.length.toLocaleString()} characters total)` : text;
  previewPane.innerHTML = `
    ${meta}
    <pre class="code-preview" tabindex="0">${escapeHtml(clipped)}</pre>
  `;
}

function renderIgnored() {
  const excluded = project.files.filter((file) => file.excluded);
  document.getElementById('ignoredSummary').textContent =
    excluded.length === 0 ? 'Nothing excluded — every file is in the plan.' : `${pluralize(excluded.length, 'file')} excluded`;

  const chips = document.getElementById('patternChips');
  const patterns = [...(useDefaults ? APP_CONFIG.defaultIgnore : []), ...customPatterns];
  chips.innerHTML = patterns
    .slice(0, 14)
    .map(
      (pattern) =>
        `<span class="chip">${escapeHtml(pattern)}${
          customPatterns.includes(pattern)
            ? `<button type="button" data-remove-pattern="${escapeHtml(pattern)}" aria-label="Remove ${escapeHtml(pattern)}">${icon('x', { size: 11 })}</button>`
            : ''
        }</span>`
    )
    .join('');

  chips.querySelectorAll('[data-remove-pattern]').forEach((button) => {
    button.addEventListener('click', () => {
      customPatterns = customPatterns.filter((item) => item !== button.dataset.removePattern);
      applyIgnoreRules(project.files, { customPatterns, useDefaults });
      renderAll();
    });
  });

  const list = document.getElementById('ignoredList');
  if (excluded.length === 0) {
    list.innerHTML = `<div class="text-xs muted" style="padding:var(--space-2)">No files are excluded by the current rules.</div>`;
    return;
  }

  list.innerHTML = excluded
    .map(
      (file) => `
      <div class="ignore-row" title="${escapeHtml(file.path)}">
        <span style="color:var(--text-faint);flex:none">${icon(file.locked ? 'lock' : 'eye-off', { size: 13 })}</span>
        <span class="ignore-row__path">${escapeHtml(file.path)}</span>
        <span class="ignore-row__reason">${escapeHtml(file.excludeReason || 'Excluded')}</span>
        ${
          file.locked || !file.content
            ? ''
            : `<button class="btn btn--ghost btn--sm" type="button" data-restore="${escapeHtml(file.path)}">Restore</button>`
        }
      </div>
    `
    )
    .join('');

  list.querySelectorAll('[data-restore]').forEach((button) => {
    button.addEventListener('click', () => {
      const file = project.files.find((item) => item.path === button.dataset.restore);
      if (!file) return;
      if (!restoreFile(file)) {
        toast.error('Cannot restore this file', file.excludeReason || 'The file is unavailable.');
        return;
      }
      toast.success('File restored', `${file.path} is back in the publishing plan.`);
      renderAll();
    });
  });
}

function renderSummary() {
  const stats = summarize(project.files);
  const limits = selectionWithinLimits(project.files);
  const selected = project.files.filter((file) => file.selected && !file.excluded);
  const missingContent = selected.every((file) => !file.content);

  summaryBody.innerHTML = `
    <div class="kv" style="margin-bottom:var(--space-4)">
      <dt>Selected files</dt><dd>${stats.selectedFiles} of ${stats.totalFiles}</dd>
      <dt>Selected size</dt><dd>${formatBytes(stats.selectedBytes)}</dd>
      <dt>Excluded files</dt><dd>${stats.excludedFiles}</dd>
      <dt>Folders</dt><dd>${stats.folders}</dd>
      <dt>Destination</dt><dd>${repo ? `${escapeHtml(repo.fullName)} · ${escapeHtml(repo.branch || repo.defaultBranch || 'main')}` : 'Not selected'}</dd>
    </div>
    ${
      limits.ok
        ? `<div class="alert alert--success">${icon('check-circle', { size: 15 })}
            <div class="alert__body"><span class="alert__text">${stats.selectedFiles} ${stats.selectedFiles === 1 ? 'commit' : 'commits'} will be created in this order.</span></div>
          </div>`
        : `<div class="alert alert--warning">${icon('alert-triangle', { size: 15 })}
            <div class="alert__body"><span class="alert__text">${escapeHtml(limits.message)}</span></div>
          </div>`
    }
    ${
      missingContent
        ? `<div class="alert alert--error" style="margin-top:var(--space-3)">${icon('alert-circle', { size: 15 })}
            <div class="alert__body"><span class="alert__text">The selected files have no loaded content. Re-upload the folder.</span></div>
          </div>`
        : ''
    }
    <p class="text-xs faint" style="margin-top:var(--space-3)">
      Limits: ${APP_CONFIG.maxFiles} files · ${formatBytes(APP_CONFIG.maxJobBytes)} per job · ${formatBytes(APP_CONFIG.maxFileBytes)} per file.
    </p>
  `;

  continueButton.disabled = !limits.ok || missingContent;
}

/* ---------- Controls ---------- */

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    document.querySelectorAll('[data-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    document.getElementById('sortMode').hidden = view !== 'list';
    renderExplorer();
  });
});

document.getElementById('sortMode').addEventListener('change', (event) => {
  sortMode = event.target.value;
  renderExplorer();
});

document.getElementById('fileSearch').addEventListener('input', (event) => {
  query = event.target.value;
  renderExplorer();
});

document.getElementById('selectAll').addEventListener('click', () => {
  for (const file of applyFilters(project.files)) if (isSelectable(file)) file.selected = true;
  renderExplorer();
  renderSummary();
});

document.getElementById('selectNone').addEventListener('click', () => {
  for (const file of applyFilters(project.files)) file.selected = false;
  renderExplorer();
  renderSummary();
});

document.getElementById('addPattern').addEventListener('click', addPattern);
document.getElementById('patternInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addPattern();
  }
});

function addPattern() {
  const input = document.getElementById('patternInput');
  const value = input.value.trim();
  const error = validateIgnorePattern(value);
  if (error) {
    toast.error('Pattern not valid', error);
    return;
  }
  if (customPatterns.includes(value)) {
    toast.info('Pattern already added', value);
    return;
  }
  customPatterns.push(value);
  input.value = '';
  applyIgnoreRules(project.files, { customPatterns, useDefaults });
  renderAll();
  toast.success('Pattern added', `Files matching "${value}" are now excluded.`);
}

document.getElementById('useDefaults').addEventListener('change', (event) => {
  useDefaults = event.target.checked;
  applyIgnoreRules(project.files, { customPatterns, useDefaults });
  renderAll();
});

document.getElementById('clearFolder').addEventListener('click', async () => {
  project = null;
  activeFilePath = null;
  await clearProject();
  statsBar.hidden = true;
  explorerCard.hidden = true;
  lowerGrid.hidden = true;
  folderInput.value = '';
  fileInput.value = '';
  query = '';
  document.getElementById('fileSearch').value = '';
  setBusy(false);
  toast.info('Folder cleared', 'Your files were removed from this browser.');
});

continueButton.addEventListener('click', async () => {
  if (!project) return;
  const limits = selectionWithinLimits(project.files);
  if (!limits.ok) {
    toast.error('Check your selection', limits.message);
    return;
  }
  if (!repo) {
    toast.error('Choose a repository first', 'Publishing needs a destination repository and branch.');
    return;
  }
  const selected = project.files.filter((file) => file.selected && !file.excluded);
  seedMessages(selected, settings.defaultTemplate || 'add');
  project.customPatterns = customPatterns;
  project.useDefaults = useDefaults;
  project.destination = repo;
  await saveProject(project);
  navigate('plan');
});

/* Restore a folder the user already analysed (e.g. came back from the plan). */
loadProject()
  .then((stored) => {
    if (!stored || !stored.files?.length) return;
    project = stored;
    customPatterns = stored.customPatterns || [];
    useDefaults = stored.useDefaults !== false;
    document.getElementById('useDefaults').checked = useDefaults;
    applyIgnoreRules(project.files, { customPatterns, useDefaults });
    setBusy(false);
    renderAll();
    toast.info('Folder restored', `${project.files.length} files from your last upload are still here.`);
  })
  .catch(() => {});
