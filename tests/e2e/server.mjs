// E2E harness: serves ./frontend and the REAL Worker router in-process, with an in-memory fake GitHub behind it.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../../backend/src/index.js';
import { GitHubClient } from '../../backend/src/services/github-api.js';
import { FakeGitHub, MemoryKV } from '../../backend/test/helpers.js';

const PORT = Number(process.env.PORT || 5199);
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../frontend');
const gh = new FakeGitHub({ files: { 'README.md': 'old readme', 'keep.txt': 'untouched' } });
const base = gh.fetch;
gh.fetch = async (url, init = {}) => {
  const u = new URL(url), m = init.method || 'GET';
  const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/user/repos' && m === 'GET') return j([{ id: 1, name: 'site', full_name: 'octo/site', owner: { login: 'octo' }, private: false, default_branch: 'main', description: 'Demo repo', pushed_at: new Date().toISOString(), permissions: { push: true }, html_url: 'https://github.com/octo/site', size: 1 }]);
  if (u.pathname === '/repos/octo/site/branches') return j([{ name: 'main', protected: false }]);
  if (u.pathname === '/repos/octo/site') return j({ default_branch: 'main', permissions: { push: true } });
  return base(url.replace('/repos/octo/site', '/repos/o/r'), init);
};
const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'sec', GITHUB_CALLBACK_URL: `http://localhost:${PORT}/api/auth/github/callback`, FRONTEND_URL: `http://localhost:${PORT}`, SESSION_SECRET: 's'.repeat(32), ENCRYPTION_KEY: 'k'.repeat(32), CC_KV: new MemoryKV() };
const overrides = {
  clientFactory: (t) => { const c = new GitHubClient(t, { fetch: gh.fetch, sleep: async () => {} }); c.getUser = async () => ({ id: 7, login: 'octo', name: 'Octo Cat', avatar_url: '', html_url: 'https://github.com/octo' }); return c; },
  fetchImpl: async () => new Response(JSON.stringify({ access_token: 'gho_E2E' })),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const api = (path, init = {}) => handle(new Request(`http://localhost:${PORT}${path}`, init), env, {}, overrides);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/__login') {
      const a = await api('/api/auth/github');
      const jar = a.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const cb = await api(`/api/auth/github/callback?code=c&state=${new URL(a.headers.get('Location')).searchParams.get('state')}`, { headers: { Cookie: jar } });
      res.writeHead(302, { Location: '/dashboard.html', 'Set-Cookie': cb.headers.getSetCookie() }); return res.end();
    }
    if (url.pathname === '/__state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ log: gh.log().map((c) => ({ message: c.message, parents: c.parents.length })), files: Object.keys(gh.files()) }));
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
      const r = await api(url.pathname + url.search, { method: req.method, headers: req.headers, body });
      const h = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; }); h['set-cookie'] = r.headers.getSetCookie();
      res.writeHead(r.status, h);
      if (r.body) for await (const c of r.body) res.write(c);
      return res.end();
    }
    const p = url.pathname === '/' ? '/index.html' : url.pathname;
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(buf);
  } catch (e) { res.writeHead(e.code === 'ENOENT' ? 404 : 500); res.end(String(e.message)); }
}).listen(PORT, () => console.log('e2e server ready'));
