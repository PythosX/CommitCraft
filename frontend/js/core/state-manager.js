/**
 * Small observable store.
 * Only non-sensitive preferences live in localStorage (never tokens).
 */

import { APP_CONFIG } from '../config/app-config.js';

const defaults = {
  selectedRepo: null,
  theme: 'system',
  template: 'add',
  publishMode: 'standard',
  ignorePatterns: [],
};

function readPersisted() {
  const state = {};
  try {
    const repo = localStorage.getItem(APP_CONFIG.storageKeys.repo);
    if (repo) state.selectedRepo = JSON.parse(repo);
    const theme = localStorage.getItem(APP_CONFIG.storageKeys.theme);
    if (theme) state.theme = theme;
    const template = localStorage.getItem(APP_CONFIG.storageKeys.template);
    if (template) state.template = template;
  } catch {
    /* corrupted storage is not fatal */
  }
  return state;
}

export function createStore(initial) {
  let state = { ...initial };
  const subscribers = new Set();

  return {
    get() {
      return state;
    },
    set(patch) {
      state = { ...state, ...patch };
      for (const subscriber of subscribers) subscriber(state);
      return state;
    },
    update(key, value) {
      return this.set({ [key]: value });
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

export const store = createStore({ ...defaults, ...readPersisted() });

export function selectRepository(repo) {
  store.set({ selectedRepo: repo });
  if (repo) localStorage.setItem(APP_CONFIG.storageKeys.repo, JSON.stringify(repo));
  else localStorage.removeItem(APP_CONFIG.storageKeys.repo);
}

export function getSelectedRepository() {
  return store.get().selectedRepo;
}

export function setTemplatePreference(template) {
  store.set({ template });
  localStorage.setItem(APP_CONFIG.storageKeys.template, template);
}

export function setIgnorePatterns(patterns) {
  store.set({ ignorePatterns: patterns });
}
