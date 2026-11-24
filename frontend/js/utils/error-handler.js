/** Turns API and runtime errors into calm, actionable messages. */

import { toast } from '../components/toast.js';

export function friendlyError(error) {
  if (!error) return 'Something went wrong.';
  if (error.code === 'NETWORK_ERROR') {
    return 'Cannot reach the CommitCraft API. Check your connection or the API URL in settings.';
  }
  if (error.code === 'RATE_LIMITED') {
    return 'GitHub rate limit reached. Wait a moment, then retry.';
  }
  if (error.code === 'SESSION_EXPIRED' || error.status === 401) {
    return 'Your GitHub session expired. Sign in again.';
  }
  if (error.code === 'CSRF_MISMATCH') {
    return 'Your session token expired. Refresh the page and try again.';
  }
  if (error.code === 'SENSITIVE_FILE') {
    return 'A selected file looks like a secret. Remove it from the plan before publishing.';
  }
  if (error.code === 'JOB_TOO_LARGE' || error.status === 413) {
    return 'This folder is larger than the publishing limit. Select fewer files.';
  }
  if (error.status === 403) {
    return error.message || 'GitHub denied this action. Check that you have write access.';
  }
  return error.message || 'Something went wrong.';
}

export function reportError(error, { title = 'Something went wrong' } = {}) {
  console.error(error);
  toast.error(title, friendlyError(error), { duration: 7000 });
}

/** Wraps an async button action with a loading state and error handling. */
export async function withButtonState(button, action, { loadingLabel } = {}) {
  if (!button) return action();
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (loadingLabel) button.textContent = loadingLabel;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (loadingLabel) button.innerHTML = original;
  }
}
