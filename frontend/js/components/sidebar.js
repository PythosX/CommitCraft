/** Sidebar markup. Kept as a pure renderer so pages stay declarative. */

import { APP_CONFIG } from '../config/app-config.js';
import { escapeHtml } from '../utils/format-utils.js';
import { icon, logoMark } from './icons.js';

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: 'dashboard' },
      { id: 'upload', label: 'New publish', icon: 'folder-up', href: 'upload' },
      { id: 'repositories', label: 'Repositories', icon: 'github', href: 'repositories' },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'history', label: 'Publishing history', icon: 'history', href: 'history' },
      { id: 'settings', label: 'Settings', icon: 'settings', href: 'settings' },
    ],
  },
];

export function renderSidebar({ active, session }) {
  const groups = NAV_GROUPS.map((group) => {
    const links = group.items
      .map((item) => {
        const isActive = item.id === active;
        return `<a class="nav__link" href="${APP_CONFIG.pages[item.href]}"${
          isActive ? ' aria-current="page"' : ''
        }>
          ${icon(item.icon, { size: 17 })}
          <span>${escapeHtml(item.label)}</span>
        </a>`;
      })
      .join('');
    return `<div class="nav" role="list">
      <div class="nav__label">${escapeHtml(group.label)}</div>
      ${links}
    </div>`;
  }).join('');

  return `
    <div class="sidebar__brand">
      <a class="logo" href="${APP_CONFIG.pages.dashboard}" aria-label="CommitCraft dashboard">
        ${logoMark(30)}
        <span>CommitCraft</span>
      </a>
      <button class="icon-btn sidebar__close" id="navClose" type="button" aria-label="Close navigation">
        ${icon('x', { size: 17 })}
      </button>
    </div>

    <nav aria-label="Main navigation" style="display:flex;flex-direction:column;gap:var(--space-3)">
      ${groups}
    </nav>

    <div class="sidebar__spacer"></div>

    <div class="sidebar__card">
      <strong>Every file. A meaningful commit.</strong>
      <span>${session?.user?.login ? `Publishing as @${escapeHtml(session.user.login)}` : 'Connect GitHub to publish'} — one real commit per file.</span>
    </div>

    <div class="sidebar__footer">
      <span>CommitCraft v1.0</span>
      <span>Developed by ${escapeHtml(APP_CONFIG.developer)}</span>
    </div>
  `;
}
