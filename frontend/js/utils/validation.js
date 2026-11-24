/** Client-side validation mirroring the server rules (server still enforces). */

export function validateRepoName(value) {
  const name = String(value || '').trim();
  if (!name) return 'Repository name is required.';
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    return 'Use letters, numbers, dots, hyphens or underscores.';
  }
  if (name === '.' || name === '..' || name.endsWith('.git')) return 'That name is not allowed.';
  return '';
}

export function validateCommitMessage(value) {
  const message = String(value || '').trim();
  if (!message) return 'Commit messages cannot be empty.';
  if (message.length > 500) return 'Keep messages under 500 characters.';
  return '';
}

export function validateBranchName(value) {
  const branch = String(value || '').trim();
  if (!branch) return 'Branch name is required.';
  if (
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock') ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    /[\s~^:?*[\]\\]/.test(branch)
  ) {
    return 'That is not a valid Git branch name.';
  }
  return '';
}

export function validateIgnorePattern(value) {
  const pattern = String(value || '').trim();
  if (!pattern) return 'Enter a pattern, for example node_modules.';
  if (pattern.length > 120) return 'Keep patterns under 120 characters.';
  if (pattern.includes('..')) return 'Patterns cannot contain "..".';
  return '';
}

export function validateFilePath(value) {
  const path = String(value || '');
  if (!path) return 'Path is required.';
  if (path.startsWith('/') || path.includes('\\')) return 'Use relative paths with forward slashes.';
  if (path.split('/').some((segment) => segment === '..')) return 'Path traversal is not allowed.';
  return '';
}
