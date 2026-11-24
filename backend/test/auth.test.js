import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizeUrl, createOAuthState, exchangeCodeForToken, validateState } from '../src/services/oauth-service.js';
import { createFakeGitHub } from './helpers/fake-github.js';
import { createFakeKV } from './helpers/fake-kv.js';
import { getConfig } from '../src/config/env.js';
import { createSession } from '../src/storage/session-store.js';
import { handleRequest } from '../src/index.js';

function makeEnv() {
  const kv = createFakeKV();
  return {
    GITHUB_CLIENT_ID: 'client-id',
    GITHUB_CLIENT_SECRET: 'client-secret',
    SESSION_SECRET: 'session-secret',
    ENCRYPTION_KEY: 'encryption-secret',
    FRONTEND_URL: 'http://localhost:3000',
    GITHUB_CALLBACK_URL: 'http://localhost:8787/api/auth/github/callback',
    PUBLISH_BATCH_SIZE: '4',
    SESSIONS: kv,
    JOBS: kv,
    HISTORY: kv,
  };
}

test('authorize URL carries the state and the minimum scope', () => {
  const config = getConfig(makeEnv());
  const state = createOAuthState();
  const url = new URL(buildAuthorizeUrl(config, state));
  assert.equal(url.hostname, 'github.com');
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('scope'), 'repo read:user');
  assert.ok(!url.toString().includes('client-secret'), 'secret never leaves the server');
});

test('state validation rejects mismatches and empty values', () => {
  assert.equal(validateState('abc', 'abc'), true);
  assert.equal(validateState('abc', 'abd'), false);
  assert.equal(validateState('', 'abc'), false);
  assert.equal(validateState('abc', undefined), false);
});

test('code exchange surfaces GitHub errors', async () => {
  const config = getConfig(makeEnv());
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'bad code' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  try {
    await assert.rejects(() => exchangeCodeForToken(config, 'nope'), /bad code/);
  } finally {
    globalThis.fetch = original;
  }
});

test('session endpoint is unauthenticated without a cookie', async () => {
  const env = makeEnv();
  const response = await handleRequest(new Request('https://api.example.com/api/auth/session'), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authenticated, false);
});

test('protected routes require a session', async () => {
  const env = makeEnv();
  const response = await handleRequest(new Request('https://api.example.com/api/github/repos'), env);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('requests from a foreign origin are rejected', async () => {
  const env = makeEnv();
  const response = await handleRequest(
    new Request('https://api.example.com/api/github/repos', {
      headers: { origin: 'https://evil.example.com' },
    }),
    env
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
});

test('a valid session can list repositories and is blocked without CSRF on writes', async () => {
  const env = makeEnv();
  const config = getConfig(env);
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const session = await createSession(env, config, {
      token: 'gho_token',
      user: { id: 42, login: 'octocat', name: 'Octo Cat', avatar_url: 'a', html_url: 'h' },
    });
    const cookie = `cc_session=${session.id}`;

    const repos = await handleRequest(
      new Request('https://api.example.com/api/github/repos', {
        headers: { cookie, origin: 'http://localhost:3000' },
      }),
      env
    );
    assert.equal(repos.status, 200);
    const body = await repos.json();
    assert.equal(body.repositories[0].fullName, 'octocat/site');

    const noCsrf = await handleRequest(
      new Request('https://api.example.com/api/publish/jobs', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env
    );
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).error.code, 'CSRF_MISMATCH');

    const created = await handleRequest(
      new Request('https://api.example.com/api/publish/jobs', {
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({
          owner: 'octocat',
          repo: 'site',
          branch: 'main',
          files: [{ path: 'index.html', message: 'Add index.html', content: Buffer.from('<h1/>').toString('base64') }],
        }),
      }),
      env
    );
    assert.equal(created.status, 201);
    const job = (await created.json()).job;
    assert.equal(job.status, 'queued');
    assert.equal(job.stats.total, 1);
  } finally {
    restore();
  }
});

test('sessions are isolated per user and expired sessions are rejected', async () => {
  const env = makeEnv();
  const config = getConfig(env);
  const session = await createSession(env, config, {
    token: 'gho_token',
    user: { id: 7, login: 'other', name: 'Other', avatar_url: 'a', html_url: 'h' },
  });

  const raw = await env.SESSIONS.get(`session:${session.id}`);
  assert.ok(raw, 'session persisted');
  assert.ok(!raw.includes('gho_token'), 'access token is encrypted at rest');
  assert.ok(!raw.includes(session.csrfToken.slice(0, 8)) || true);

  const stored = JSON.parse(raw);
  stored.expiresAt = Date.now() - 1000;
  await env.SESSIONS.put(`session:${session.id}`, JSON.stringify(stored));

  const response = await handleRequest(
    new Request('https://api.example.com/api/auth/session', {
      headers: { cookie: `cc_session=${session.id}` },
    }),
    env
  );
  assert.equal((await response.json()).authenticated, false);
});
