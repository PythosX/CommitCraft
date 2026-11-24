/**
 * Navigation helpers.
 *
 * CommitCraft is a multi-page application: every route is a real HTML document.
 * This module keeps URLs, page transitions and query parameters consistent
 * without pretending to be a client-side router.
 */

import { APP_CONFIG } from '../config/app-config.js';

export function currentPage() {
  return window.location.pathname.split('/').pop() || APP_CONFIG.pages.landing;
}

export function isPage(page) {
  return currentPage() === (APP_CONFIG.pages[page] || page);
}

export function param(name, fallback = null) {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export function buildUrl(page, params = {}) {
  const path = APP_CONFIG.pages[page] || page;
  const url = new URL(path, window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

/** Navigates with a short exit transition that respects reduced motion. */
export function navigate(page, params = {}) {
  const target = buildUrl(page, params);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    window.location.href = target;
    return;
  }
  document.documentElement.classList.add('is-leaving');
  window.setTimeout(() => {
    window.location.href = target;
  }, 120);
}

export function replaceParams(params = {}) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  window.history.replaceState({}, '', url);
}

export function goBack(fallbackPage = 'dashboard') {
  if (window.history.length > 1 && document.referrer) window.history.back();
  else navigate(fallbackPage);
}

export function setPageTitle(title) {
  const suffix = APP_CONFIG.name;
  document.title = title ? `${title} — ${suffix}` : `${suffix} — ${APP_CONFIG.tagline}`;
}
