/** GitHub account helpers. All GitHub calls go through the Worker proxy. */

import { api } from '../core/api-client.js';
import { loadSession } from '../core/auth-manager.js';
import { APP_CONFIG } from '../config/app-config.js';

export async function getAccount() {
  const session = await loadSession();
  return session?.authenticated ? session.user : null;
}

export async function getConnectionStatus() {
  const session = await loadSession();
  return {
    connected: Boolean(session?.authenticated),
    user: session?.user || null,
    scopes: session?.scopes || '',
    expiresAt: session?.expiresAt || null,
  };
}

export async function checkApiHealth() {
  try {
    const health = await api.get('/api/health');
    return { reachable: true, service: health?.service || 'commitcraft-api' };
  } catch {
    return { reachable: false, service: null };
  }
}

export function repoUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}`;
}

export function commitUrl(owner, repo, sha) {
  return `${repoUrl(owner, repo)}/commit/${sha}`;
}

export function profileUrl(login) {
  return `https://github.com/${login}`;
}

export { APP_CONFIG };
