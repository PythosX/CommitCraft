// End to end through the real Worker router: sign in, create job, upload blobs, stream commits, verify Git state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../backend/src/index.js';
import { GitHubClient } from '../../backend/src/services/github-api.js';
import { FakeGitHub, MemoryKV } from '../../backend/test/helpers.js';
import { _reset } from '../../backend/src/middleware/rate-limit.js';

const b64 = (s) => Buffer.from(s).toString('base64');
async function boot(ghOpts) {
  _reset();
  const gh = new FakeGitHub(ghOpts);
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'sec', GITHUB_CALLBACK_URL: 'https://app.test/api/auth/github/callback', FRONTEND_URL: 'https://app.test', SESSION_SECRET: 's'.repeat(32), ENCRYPTION_KEY: 'k'.repeat(32), CC_KV: new MemoryKV() };
  const clientFactory = (t) => { const c = new GitHubClient(t, { fetch: gh.fetch, sleep: async () => {} }); c.getUser = async () => ({ id: 7, login: 'octo', name: 'Octo', avatar_url: 'x', html_url: 'y' }); return c; };
  const overrides = { clientFactory, fetchImpl: async () => new Response(JSON.stringify({ access_token: 'gho_X' })) };
  const call = (path, init = {}, cookie) => handle(new Request('https://api.test' + path, { ...init, headers: { 'X-Requested-With': 'CommitCraft', Origin: 'https://app.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) } }), env, {}, overrides);
  const login = await call('/api/auth/github', { headers: { Origin: '' } });
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const jar = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const cb = await call(`/api/auth/github/callback?code=c&state=${state}`, {}, jar);
  const cookie = cb.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith('__Host-')).join('; ');
  return { gh, call, cookie, env };
}

test('publish five nested files as five commits over HTTP, streaming progress', async () => {
  const { gh, call, cookie } = await boot({ files: { 'README.md': 'existing readme' } });
  const names = ['index.html', 'style.css', 'script.js', 'assets/logo.svg', 'docs/guide/intro.md'];
  const create = await call('/api/publish/jobs', { method: 'POST', body: JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', items: names.map((n) => ({ path: n, size: ('content of ' + n).length, action: 'add', message: `Add ${n}` })) }) }, cookie);
  assert.equal(create.status, 201);
  const { job } = await create.json(); assert.ok(!('userId' in job) && !('lock' in job));
  const up = await call(`/api/publish/jobs/${job.id}/blobs`, { method: 'POST', body: JSON.stringify({ files: names.map((n, i) => ({ index: i, content: b64('content of ' + n) })) }) }, cookie);
  assert.equal(up.status, 200);
  const start = await call(`/api/publish/jobs/${job.id}/start`, { method: 'POST', body: '{}', headers: { Accept: 'application/x-ndjson' } }, cookie);
  const events = (await start.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.type === 'item' && e.item.status === 'completed').length, 5);
  assert.equal(events.at(-1).type, 'job'); assert.equal(events.at(-1).job.status, 'completed');
  const log = gh.log(); assert.equal(log.length, 6);
  for (let i = 0; i < 5; i++) assert.equal(log[i].parents[0].sha, log[i + 1].sha);
  const files = gh.files(); for (const n of names) assert.ok(files[n]);
  assert.ok(files['README.md']);
  const hist = await (await call('/api/publish/history', {}, cookie)).json();
  assert.equal(hist.totals.commits, 5); assert.equal(hist.jobs[0].status, 'completed');
});

test("another user cannot read or advance someone else's job", async () => {
  const a = await boot(); 
  const create = await a.call('/api/publish/jobs', { method: 'POST', body: JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', items: [{ path: 'a', size: 1, action: 'add', message: 'Add a' }] }) }, a.cookie);
  const { job } = await create.json();
  const { Response: _R } = globalThis;
  // tamper: a job id that belongs to a different user id
  const stored = JSON.parse(a.env.CC_KV.m.get(`job:${job.id}`)); stored.userId = '999'; a.env.CC_KV.m.set(`job:${job.id}`, JSON.stringify(stored));
  assert.equal((await a.call(`/api/publish/jobs/${job.id}`, {}, a.cookie)).status, 404);
  assert.equal((await a.call(`/api/publish/jobs/${job.id}/start`, { method: 'POST', body: '{}' }, a.cookie)).status, 404);
});

test('API rejects traversal paths, oversize bodies and bad owners', async () => {
  const { call, cookie } = await boot();
  const post = (b) => call('/api/publish/jobs', { method: 'POST', body: JSON.stringify(b) }, cookie);
  const item = { path: 'a.txt', size: 1, action: 'add', message: 'm' };
  assert.equal((await post({ owner: 'o', repo: 'r', branch: 'main', items: [{ ...item, path: '../../etc/passwd' }] })).status, 400);
  assert.equal((await post({ owner: 'o/../x', repo: 'r', branch: 'main', items: [item] })).status, 400);
  assert.equal((await post({ owner: 'o', repo: 'r', branch: 'bad branch', items: [item] })).status, 400);
  assert.equal((await post({ owner: 'o', repo: 'r', branch: 'main', items: [{ ...item, size: 26 * 1024 * 1024 }] })).status, 400);
});

test('settings persist and validate; logout ends the session', async () => {
  const { call, cookie } = await boot();
  const put = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultTemplate: 'update', customIgnore: ['*.log'] }) }, cookie);
  assert.equal((await put.json()).settings.defaultTemplate, 'update');
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: 'neon' }) }, cookie)).status, 400);
  assert.equal((await (await call('/api/settings', {}, cookie)).json()).settings.customIgnore[0], '*.log');
  assert.equal((await call('/api/auth/logout', { method: 'POST', body: '{}' }, cookie)).status, 200);
  assert.equal((await call('/api/settings', {}, cookie)).status, 401);
});

test('the access token never appears in any API response body or cookie', async () => {
  const { call, cookie } = await boot();
  for (const p of ['/api/auth/session', '/api/settings', '/api/publish/history']) assert.ok(!(await (await call(p, {}, cookie)).text()).includes('gho_X'));
  assert.ok(!cookie.includes('gho_X'));
});
