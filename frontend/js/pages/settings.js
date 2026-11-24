/** Settings: account, publishing defaults, appearance, security. */

import { initShell } from '../components/app-shell.js';
import { icon } from '../components/icons.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { api } from '../core/api-client.js';
import { getSession, logout } from '../core/auth-manager.js';
import { setTemplatePreference, store } from '../core/state-manager.js';
import { clearHistory } from '../services/history-service.js';
import { checkApiHealth } from '../services/github-service.js';
import { APP_CONFIG } from '../config/app-config.js';
import { getThemePreference, setThemePreference, themeLabel, applyTheme } from '../utils/theme.js';
import { escapeHtml, formatDateTime } from '../utils/format-utils.js';
import { friendlyError } from '../utils/error-handler.js';
import { validateIgnorePattern } from '../utils/validation.js';

const session = await initShell({ active: 'settings', title: 'Settings' });

let settings = {
  theme: getThemePreference(),
  defaultTemplate: 'add',
  publishMode: 'standard',
  ignorePatterns: [],
  defaultFileFilters: ['node_modules', '.git', 'dist', 'build', '.env'],
};
let account = null;
let sessionInfo = null;
let saving = false;

themesMarkup();
loadSettings();

function themesMarkup() {
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === getThemePreference()));
    button.addEventListener('click', () => {
      setThemePreference(button.dataset.themeChoice);
      applyTheme();
      document.querySelectorAll('[data-theme-choice]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      saveSettings({ theme: button.dataset.themeChoice }, { silent: true });
      toast.success('Theme updated', themeLabel(button.dataset.themeChoice));
    });
  });

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const badge = document.getElementById('motionBadge');
  const update = () => {
    badge.textContent = motionQuery.matches ? 'Reduced' : 'Full';
    badge.className = `badge ${motionQuery.matches ? 'badge--accent' : ''}`;
  };
  update();
  motionQuery.addEventListener?.('change', update);
}

async function loadSettings() {
  try {
    const result = await api.get('/api/settings');
    settings = { ...settings, ...(result.settings || {}) };
    account = result.account || session.user;
    sessionInfo = result.session || null;
    renderAccount();
    renderPublishing();
    renderSecurity();
    renderConnection();
    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (settings.theme || 'system')));
    });
  } catch (error) {
    toast.error('Could not load settings', friendlyError(error));
    renderAccount();
    renderPublishing();
    renderSecurity();
    renderConnection();
  }
}

async function saveSettings(patch, { silent = false } = {}) {
  const previous = { ...settings };
  settings = { ...settings, ...patch };
  if (patch.defaultTemplate) setTemplatePreference(patch.defaultTemplate);
  try {
    saving = true;
    const result = await api.put('/api/settings', settings);
    settings = { ...settings, ...(result.settings || {}) };
    if (!silent) toast.success('Settings saved', 'Your defaults were updated.');
  } catch (error) {
    settings = previous;
    toast.error('Could not save settings', friendlyError(error));
  } finally {
    saving = false;
  }
}

function renderAccount() {
  const container = document.getElementById('accountCard');
  const user = account || session.user || {};
  const initials = (user.name || user.login || '?')
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  container.innerHTML = `
    <div class="account-card">
      ${
        user.avatarUrl
          ? `<img class="avatar avatar--lg" src="${escapeHtml(user.avatarUrl)}" alt="" width="56" height="56" referrerpolicy="no-referrer" />`
          : `<span class="avatar avatar--lg" style="display:grid;place-items:center;font-size:18px;font-weight:600">${escapeHtml(initials)}</span>`
      }
      <div class="account-card__meta">
        <strong>${escapeHtml(user.name || user.login || 'GitHub account')}</strong>
        <a href="${escapeHtml(user.htmlUrl || 'https://github.com')}" target="_blank" rel="noopener noreferrer">@${escapeHtml(user.login || 'unknown')}</a>
        <div class="row" style="gap:6px;margin-top:8px">
          <span class="connection"><span class="status-dot"></span> Connected</span>
          ${sessionInfo?.scopes ? `<span class="badge">${escapeHtml(sessionInfo.scopes)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="divider" style="margin:var(--space-4) 0"></div>
    <button class="btn btn--danger btn--sm" type="button" id="disconnectButton">
      ${icon('log-out', { size: 14 })} Disconnect GitHub
    </button>
  `;

  document.getElementById('disconnectButton')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Disconnect GitHub?',
      message:
        'Your CommitCraft session ends and the encrypted token is removed from the server. Publishing jobs already recorded stay in history.',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Stay connected',
      danger: true,
    });
    if (confirmed) await logout();
  });
}

function renderPublishing() {
  const container = document.getElementById('publishingCard');
  container.innerHTML = `
    <div class="field" style="margin-bottom:var(--space-4)">
      <label class="field__label" for="templateSelect">Default commit message template</label>
      <select class="select" id="templateSelect">
        ${APP_CONFIG.templates
          .map(
            (template) =>
              `<option value="${template.id}"${template.id === settings.defaultTemplate ? ' selected' : ''}>${escapeHtml(
                template.pattern
              )}</option>`
          )
          .join('')}
      </select>
      <span class="field__hint">Used to pre-fill messages; each one stays editable.</span>
    </div>

    <div class="field" style="margin-bottom:var(--space-4)">
      <label class="field__label" for="modeSelect">Default publishing mode</label>
      <select class="select" id="modeSelect">
        <option value="standard"${settings.publishMode === 'standard' ? ' selected' : ''}>Standard — confirm with one click</option>
        <option value="careful"${settings.publishMode === 'careful' ? ' selected' : ''}>Careful — type PUBLISH to confirm</option>
      </select>
      <span class="field__hint">Careful mode adds a typed confirmation before any commit is created.</span>
    </div>

    <div class="field" style="margin-bottom:var(--space-3)">
      <span class="field__label">Custom ignore patterns</span>
      <div class="pattern-input">
        <input class="input" id="patternInput" placeholder="e.g. *.log" aria-label="New ignore pattern" autocomplete="off" />
        <button class="btn btn--secondary" type="button" id="addPattern">Add</button>
      </div>
      <span class="field__hint">Applied on top of the default exclusions (.git, node_modules, dist, .env…).</span>
      <div class="filter-pills" id="patternList" style="margin-top:var(--space-2)"></div>
    </div>

    <div class="field">
      <span class="field__label">Default file filters</span>
      <div class="filter-pills" id="filterList"></div>
      <span class="field__hint">Shown as quick exclusions in the upload screen.</span>
    </div>
  `;

  document.getElementById('templateSelect').addEventListener('change', (event) => {
    saveSettings({ defaultTemplate: event.target.value });
  });
  document.getElementById('modeSelect').addEventListener('change', (event) => {
    saveSettings({ publishMode: event.target.value });
  });

  const patternList = document.getElementById('patternList');
  const renderPatterns = () => {
    if (settings.ignorePatterns.length === 0) {
      patternList.innerHTML = '<span class="text-xs faint">No custom patterns yet.</span>';
      return;
    }
    patternList.innerHTML = settings.ignorePatterns
      .map(
        (pattern) =>
          `<span class="chip">${escapeHtml(pattern)}<button type="button" data-remove="${escapeHtml(
            pattern
          )}" aria-label="Remove ${escapeHtml(pattern)}">${icon('x', { size: 11 })}</button></span>`
      )
      .join('');
    patternList.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        settings.ignorePatterns = settings.ignorePatterns.filter((item) => item !== button.dataset.remove);
        saveSettings({ ignorePatterns: settings.ignorePatterns });
        renderPatterns();
      });
    });
  };

  document.getElementById('addPattern').addEventListener('click', () => {
    const input = document.getElementById('patternInput');
    const value = input.value.trim();
    const error = validateIgnorePattern(value);
    if (error) {
      toast.error('Pattern not valid', error);
      return;
    }
    if (settings.ignorePatterns.includes(value)) {
      toast.info('Already added', value);
      return;
    }
    settings.ignorePatterns = [...settings.ignorePatterns, value];
    input.value = '';
    saveSettings({ ignorePatterns: settings.ignorePatterns });
    renderPatterns();
  });
  document.getElementById('patternInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('addPattern').click();
    }
  });

  document.getElementById('filterList').innerHTML = settings.defaultFileFilters
    .map((filter) => `<span class="chip">${escapeHtml(filter)}</span>`)
    .join('');

  renderPatterns();
}

function renderSecurity() {
  const container = document.getElementById('securityCard');
  container.innerHTML = `
    <div class="kv" style="margin-bottom:var(--space-4)">
      <dt>Session started</dt><dd>${escapeHtml(
        sessionInfo?.createdAt ? formatDateTime(sessionInfo.createdAt) : formatDateTime(new Date().toISOString())
      )}</dd>
      <dt>Expires</dt><dd>${escapeHtml(sessionInfo?.expiresAt ? formatDateTime(sessionInfo.expiresAt) : '—')}</dd>
      <dt>Token storage</dt><dd>Encrypted in server KV · HttpOnly session cookie</dd>
      <dt>Browser storage</dt><dd>No GitHub tokens. Only theme and destination preferences.</dd>
    </div>

    <div class="setting-row">
      <div class="setting-row__text">
        <strong>Clear publishing history</strong>
        <span>Removes recorded jobs. Commits on GitHub are untouched.</span>
      </div>
      <button class="btn btn--danger btn--sm" type="button" id="clearHistoryButton">Clear history</button>
    </div>

    <div class="setting-row">
      <div class="setting-row__text">
        <strong>Sign out</strong>
        <span>Ends this session on the server</span>
      </div>
      <button class="btn btn--secondary btn--sm" type="button" id="signOutButton">Sign out</button>
    </div>
  `;

  document.getElementById('clearHistoryButton').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Clear publishing history?',
      message:
        'This removes every recorded job and its commit list from CommitCraft. Commits already pushed to GitHub are not affected.',
      confirmLabel: 'Clear history',
      cancelLabel: 'Keep history',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await clearHistory();
      toast.success('History cleared', 'Recorded jobs were removed.');
    } catch (error) {
      toast.error('Could not clear history', friendlyError(error));
    }
  });

  document.getElementById('signOutButton').addEventListener('click', () => logout());
}

async function renderConnection() {
  const container = document.getElementById('connectionCard');
  const health = await checkApiHealth();
  container.innerHTML = `
    <div class="kv">
      <dt>API base</dt><dd class="mono-xs">${escapeHtml(APP_CONFIG.apiBase || window.location.origin)}</dd>
      <dt>Status</dt><dd>
        <span class="badge ${health.reachable ? 'badge--success' : 'badge--error'}">
          ${health.reachable ? 'reachable' : 'unreachable'}
        </span>
      </dd>
      <dt>Service</dt><dd class="mono-xs">${escapeHtml(health.service || '—')}</dd>
      <dt>Frontend</dt><dd class="mono-xs">${escapeHtml(window.location.origin)}</dd>
    </div>
    ${
      health.reachable
        ? ''
        : `<div class="alert alert--warning" style="margin-top:var(--space-3)">
            ${icon('alert-triangle', { size: 15 })}
            <div class="alert__body"><span class="alert__text">The frontend cannot reach the API. Check the deployed Worker URL and the <code>FRONTEND_URL</code> CORS setting.</span></div>
          </div>`
    }
  `;
}

document.getElementById('checkApi').addEventListener('click', async () => {
  toast.info('Checking API', 'Contacting the CommitCraft Worker.');
  await renderConnection();
});
