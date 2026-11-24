/**
 * Bootstraps the authenticated application shell:
 * session check, sidebar, topbar, theme, mobile drawer, logout.
 */

import { logout, requireAuth } from '../core/auth-manager.js';
import { getThemePreference, cycleTheme, initTheme, themeLabel } from '../utils/theme.js';
import { initDropdowns } from './dropdown.js';
import { renderSidebar } from './sidebar.js';
import { renderTopbar } from './navbar.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

export async function initShell({ active, title }) {
  initTheme();
  if (!document.querySelector('meta[name="viewport"]')) {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    document.head.appendChild(meta);
  }

  const session = await requireAuth();

  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');
  if (sidebar) sidebar.innerHTML = renderSidebar({ active, session });
  if (topbar) topbar.innerHTML = renderTopbar({ title, session, themePreference: getThemePreference() });

  const shell = document.querySelector('.app-shell');
  if (shell && !document.querySelector('.sidebar-backdrop')) {
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.addEventListener('click', closeDrawer);
    shell.appendChild(backdrop);
  }

  function openDrawer() {
    sidebar?.classList.add('is-open');
    document.querySelector('.sidebar-backdrop')?.classList.add('is-visible');
    document.getElementById('navToggle')?.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    sidebar?.classList.remove('is-open');
    document.querySelector('.sidebar-backdrop')?.classList.remove('is-visible');
    document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
  }

  document.getElementById('navToggle')?.addEventListener('click', () => {
    if (sidebar?.classList.contains('is-open')) closeDrawer();
    else openDrawer();
  });
  document.getElementById('navClose')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });

  const themeButton = document.getElementById('themeToggle');
  themeButton?.addEventListener('click', () => {
    const next = cycleTheme();
    themeButton.innerHTML = icon(next === 'light' ? 'sun' : next === 'dark' ? 'moon' : 'monitor', {
      size: 17,
    });
    themeButton.title = themeLabel(next);
    themeButton.setAttribute('aria-label', `Theme: ${themeLabel(next)}. Click to change.`);
  });

  document.getElementById('logoutButton')?.addEventListener('click', async () => {
    toast.info('Signing out', 'Closing your CommitCraft session.');
    await logout();
  });

  const user = session.user || {};
  window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible' && !session.authenticated) {
      window.location.replace('index.html?auth=expired');
    }
  });

  document.documentElement.dataset.user = user.login || '';
  initDropdowns();
  return session;
}

/** Small helper so pages can show a skeleton while their data loads. */
export function skeletonCards(count = 3) {
  return Array.from({ length: count }, () => '<div class="skeleton skeleton--card"></div>').join('');
}
