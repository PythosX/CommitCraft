/** Theme controller: dark → light → system, persisted locally. */

import { APP_CONFIG } from '../config/app-config.js';

const MEDIA = window.matchMedia('(prefers-color-scheme: light)');

export function getThemePreference() {
  const stored = localStorage.getItem(APP_CONFIG.storageKeys.theme);
  return ['dark', 'light', 'system'].includes(stored) ? stored : 'system';
}

export function resolveTheme(preference) {
  if (preference === 'system') return MEDIA.matches ? 'light' : 'dark';
  return preference;
}

export function applyTheme(preference = getThemePreference()) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function setThemePreference(preference) {
  localStorage.setItem(APP_CONFIG.storageKeys.theme, preference);
  applyTheme(preference);
  window.dispatchEvent(new CustomEvent('theme:changed', { detail: { preference } }));
}

export function cycleTheme() {
  const order = ['dark', 'light', 'system'];
  const current = getThemePreference();
  const next = order[(order.indexOf(current) + 1) % order.length];
  setThemePreference(next);
  return next;
}

export function themeLabel(preference = getThemePreference()) {
  return preference === 'system' ? 'System theme' : `${preference[0].toUpperCase()}${preference.slice(1)} theme`;
}

export function initTheme() {
  applyTheme();
  const onChange = () => {
    if (getThemePreference() === 'system') applyTheme('system');
  };
  if (MEDIA.addEventListener) MEDIA.addEventListener('change', onChange);
  else MEDIA.addListener(onChange);
}
