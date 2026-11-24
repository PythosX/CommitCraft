/** Commit message templates, validation and plan construction. */

import { APP_CONFIG } from '../config/app-config.js';
import { basename, folderOf } from '../utils/path-utils.js';
import { validateCommitMessage } from '../utils/validation.js';

export function generateMessage(filePath, templateId = 'add') {
  const template = APP_CONFIG.templates.find((item) => item.id === templateId) || APP_CONFIG.templates[0];
  return template.pattern
    .replace('{filename}', basename(filePath))
    .replace('{folder}', folderOf(filePath));
}

export function defaultMessage(file) {
  // An existing file reads more naturally as an update.
  return generateMessage(file.path, file.existed ? 'update' : 'add');
}

export function seedMessages(files, templateId = 'add') {
  for (const file of files) {
    if (!file.message) file.message = generateMessage(file.path, templateId);
  }
  return files;
}

export function applyTemplateToAll(files, templateId) {
  for (const file of files) file.message = generateMessage(file.path, templateId);
  return files;
}

export function resetMessage(file, templateId = 'add') {
  file.message = generateMessage(file.path, templateId);
  return file;
}

export function validateMessages(files) {
  const errors = new Map();
  for (const file of files) {
    const error = validateCommitMessage(file.message);
    if (error) errors.set(file.path, error);
  }
  return { valid: errors.size === 0, errors };
}

export function moveFile(files, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= files.length) return files;
  const next = [...files];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function buildPlan(files) {
  return files.map((file, index) => ({
    order: index + 1,
    path: file.path,
    size: file.size,
    message: file.message,
    existed: Boolean(file.existed),
  }));
}

export function planPreviewText(plan, { owner, repo, branch }) {
  const header = `Repository: ${owner}/${repo}\nBranch: ${branch}\nCommits: ${plan.length}\n`;
  const rows = plan.map((item) => `${item.order}. ${item.message}`).join('\n');
  return `${header}\n${rows}`;
}
