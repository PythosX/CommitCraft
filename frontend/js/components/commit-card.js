/** Commit rows used by the publishing progress list and history details. */

import { formatBytes, escapeHtml, shortSha, statusLabel, statusTone } from '../utils/format-utils.js';
import { icon } from './icons.js';

const STATE_ICON = {
  waiting: 'clock',
  processing: 'loader',
  committing: 'git-commit',
  completed: 'check',
  failed: 'x',
  skipped: 'pause',
};

export function commitRowHtml(file) {
  const state = file.status || 'waiting';
  const iconName = STATE_ICON[state] || 'clock';
  const spinning = state === 'processing' || state === 'committing';

  const commitLink = file.commitSha
    ? `<a class="commit-link" href="${escapeHtml(file.commitUrl || '#')}" target="_blank" rel="noopener noreferrer" title="Open commit on GitHub">
        ${escapeHtml(shortSha(file.commitSha))} ${icon('external-link', { size: 10 })}
      </a>`
    : statusLabel(state);

  return `
    <div class="commit-row commit-row--${escapeHtml(state)}">
      <span class="commit-row__state">${icon(iconName, { size: 13, className: spinning ? 'spin' : '' })}</span>
      <div style="min-width:0">
        <div class="commit-row__path" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</div>
        <div class="commit-row__message" title="${escapeHtml(file.message)}">${escapeHtml(file.message)}</div>
        ${file.error ? `<div class="commit-row__error">${escapeHtml(file.error)}</div>` : ''}
      </div>
      <div class="commit-row__meta">
        <span class="badge badge--${statusTone(state)}">${escapeHtml(statusLabel(state))}</span>
        <span>${commitLink}</span>
        <span>${formatBytes(file.size)}${file.existed ? ' · update' : ' · new'}</span>
      </div>
    </div>
  `;
}

export function commitCard(file) {
  return commitRowHtml(file);
}
