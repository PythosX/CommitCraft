/**
 * CommitCraft frontend configuration.
 *
 * API base resolution order:
 *   1. ?api=... query override (useful for staging tests)
 *   2. localStorage "cc.apiBase" (developer override)
 *   3. <meta name="commitcraft-api" content="...">
 *   4. same origin (empty string)
 */

function readApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('api');
  if (fromQuery) {
    localStorage.setItem('cc.apiBase', fromQuery);
    return fromQuery;
  }
  const stored = localStorage.getItem('cc.apiBase');
  if (stored) return stored;
  const meta = document.querySelector('meta[name="commitcraft-api"]');
  return meta?.getAttribute('content') || '';
}

const apiBase = readApiBase().replace(/\/+$/, '');

export const APP_CONFIG = {
  name: 'CommitCraft',
  tagline: 'Every file. A meaningful commit.',
  developer: 'PythosX',
  apiBase,
  githubRepoUrl: 'https://github.com/PythosX/commitcraft',
  privacyUrl: 'privacy.html',
  termsUrl: 'terms.html',
  supportUrl: 'https://github.com/PythosX/commitcraft/issues',
  sessionPollMs: 30_000,
  pages: {
    landing: 'index.html',
    dashboard: 'dashboard.html',
    repositories: 'repositories.html',
    upload: 'upload.html',
    plan: 'commit-plan.html',
    publishing: 'publishing.html',
    history: 'history.html',
    settings: 'settings.html',
  },
  storageKeys: {
    theme: 'cc.theme',
    repo: 'cc.repo',
    template: 'cc.template',
    apiBase: 'cc.apiBase',
  },
  templates: [
    { id: 'add', label: 'Add', pattern: 'Add {filename}' },
    { id: 'create', label: 'Create', pattern: 'Create {filename}' },
    { id: 'update', label: 'Update', pattern: 'Update {filename}' },
    { id: 'folder', label: 'Folder', pattern: 'Add {folder} file: {filename}' },
  ],
  defaultIgnore: [
    '.git',
    'node_modules',
    'dist',
    'build',
    '.next',
    '.vercel',
    '__pycache__',
    '.DS_Store',
    'Thumbs.db',
    '.env',
    '.env.local',
    '.env.production',
  ],
  maxFileBytes: 5 * 1024 * 1024,
  maxJobBytes: 25 * 1024 * 1024,
  maxFiles: 200,
  textExtensions: [
    'html',
    'htm',
    'css',
    'scss',
    'js',
    'mjs',
    'cjs',
    'jsx',
    'ts',
    'tsx',
    'json',
    'md',
    'markdown',
    'txt',
    'yml',
    'yaml',
    'toml',
    'xml',
    'svg',
    'gitignore',
    'env',
    'example',
    'sh',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'c',
    'h',
    'cpp',
    'sql',
  ],
  imageExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp'],
  archiveExtensions: ['zip', 'tar', 'gz', 'rar', '7z'],
};

export function pageUrl(page, params = {}) {
  const path = APP_CONFIG.pages[page] || page;
  const url = new URL(path, window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.pathname.split('/').pop() + url.search;
}
