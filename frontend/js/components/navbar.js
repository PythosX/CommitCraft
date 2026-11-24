/** Topbar: page title, GitHub connection status, theme toggle, account menu. */

import { APP_CONFIG } from '../config/app-config.js';
import { escapeHtml } from '../utils/format-utils.js';
import { icon } from './icons.js';

export function renderTopbar({ title, session, themePreference = 'system' }) {
  const user = session?.user;
  const initials = (user?.name || user?.login || '?')
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return `
    <button class="icon-btn topbar__menu" id="navToggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">
      ${icon('menu', { size: 18 })}
    </button>

    <div class="topbar__title">
      ${escapeHtml(title)}
      <span aria-hidden="true">/</span>
      <span class="mono-xs">${escapeHtml(APP_CONFIG.name.toLowerCase())}</span>
    </div>

    <div class="topbar__actions">
      <span class="connection" title="GitHub account connected through a secure server-side session">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="nowrap">GitHub connected</span>
      </span>

      <button class="icon-btn" id="themeToggle" type="button" aria-label="Change theme" title="Theme: ${escapeHtml(themePreference)}">
        ${icon(themePreference === 'light' ? 'sun' : themePreference === 'dark' ? 'moon' : 'monitor', { size: 17 })}
      </button>

      <div class="dropdown" data-dropdown>
        <button class="user-chip" type="button" data-dropdown-trigger aria-expanded="false" aria-haspopup="menu" aria-label="Account menu">
          ${
            user?.avatarUrl
              ? `<img class="avatar" src="${escapeHtml(user.avatarUrl)}" alt="" width="30" height="30" loading="lazy" referrerpolicy="no-referrer" />`
              : `<span class="avatar" style="display:grid;place-items:center;font-size:11px;font-weight:600">${escapeHtml(initials)}</span>`
          }
          <span class="user-chip__name">${escapeHtml(user?.login || 'Account')}</span>
          ${icon('chevron-down', { size: 14 })}
        </button>
        <div class="dropdown__menu" data-dropdown-menu role="menu">
          <div class="dropdown__header">
            <div>
              <strong>${escapeHtml(user?.name || user?.login || 'Account')}</strong>
              <span>@${escapeHtml(user?.login || 'unknown')}</span>
            </div>
          </div>
          <a class="dropdown__item" role="menuitem" href="${escapeHtml(user?.htmlUrl || 'https://github.com')}" target="_blank" rel="noopener noreferrer">
            ${icon('github', { size: 15 })} GitHub profile ${icon('external-link', { size: 12 })}
          </a>
          <a class="dropdown__item" role="menuitem" href="${APP_CONFIG.pages.repositories}">
            ${icon('folder-open', { size: 15 })} Choose repository
          </a>
          <a class="dropdown__item" role="menuitem" href="${APP_CONFIG.pages.settings}">
            ${icon('settings', { size: 15 })} Settings
          </a>
          <div class="dropdown__divider"></div>
          <button class="dropdown__item dropdown__item--danger" role="menuitem" id="logoutButton" type="button">
            ${icon('log-out', { size: 15 })} Sign out
          </button>
        </div>
      </div>
    </div>
  `;
}
