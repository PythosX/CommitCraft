import test from 'node:test';
import assert from 'node:assert/strict';
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

test('publishes through the HTTP API with body-less start requests', async () => {
  const env = makeEnv();
  const config = getConfig(env);
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  const ORIGIN = 'http://localhost:3000';

  try {
    const session = await createSession(env, config, {
      token: 'gho_token',
      user: { id: 42, login: 'octocat', name: 'Octo Cat', avatar_url: 'a', html_url: 'h' },
    });
    const cookie = `cc_session=${session.id}`;

    const created = await handleRequest(
      new Request('https://api.example.com/api/publish/jobs', {
        method: 'POST',
        headers: {
          cookie,
          origin: ORIGIN,
          'content-type': 'application/json',
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({
          owner: 'octocat',
          repo: 'site',
          branch: 'main',
          files: [
            { path: 'index.html', message: 'Add index.html', content: Buffer.from('<h1>hi</h1>').toString('base64') },
            { path: 'src/app.js', message: 'Add src/app.js', content: Buffer.from('console.log(1)').toString('base64') },
          ],
        }),
      }),
      env
    );
    assert.equal(created.status, 201);
    const job = (await created.json()).job;
    assert.equal(job.status, 'queued');
    assert.equal(job.stats.total, 2);

    // A POST with no body and no content-type must be accepted (start/resume/retry/cancel).
    const started = await handleRequest(
      new Request(`https://api.example.com/api/publish/jobs/${job.id}/start`, {
        method: 'POST',
        headers: { cookie, origin: ORIGIN, 'x-csrf-token': session.csrfToken },
      }),
      env
    );
    assert.equal(started.status, 200, 'body-less POST is not rejected with 415');
    const result = await started.json();
    assert.equal(result.done, true);
    assert.equal(result.job.status, 'completed');
    assert.equal(result.job.stats.commits, 2);
    assert.ok(result.job.files.every((file) => file.commitSha && file.commitSha.length === 40));
    assert.ok(result.job.files.every((file) => file.commitUrl.includes('/commit/')));

    // The commits really exist, with the correct parent chain.
    const snapshot = fake.snapshot('octocat/site', 'main');
    assert.deepEqual(Object.keys(snapshot.files).sort(), ['README.md', 'index.html', 'src/app.js']);
    assert.equal(snapshot.commits[0].parents[0], snapshot.commits[1].sha);

    // History is recorded and readable.
    const historyResponse = await handleRequest(
      new Request('https://api.example.com/api/publish/history', { headers: { cookie, origin: ORIGIN } }),
      env
    );
    const history = await historyResponse.json();
    assert.equal(history.history.length, 1);
    assert.equal(history.history[0].commitsCreated, 2);
    assert.equal(history.history[0].status, 'completed');
    assert.equal(history.totals.commits, 2);

    // Repeating start on a finished job is idempotent.
    const repeated = await handleRequest(
      new Request(`https://api.example.com/api/publish/jobs/${job.id}/start`, {
        method: 'POST',
        headers: { cookie, origin: ORIGIN, 'x-csrf-token': session.csrfToken },
      }),
      env
    );
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).done, true);
    assert.equal(fake.commits.size, 3, 'no duplicate commits were created');
  } finally {
    restore();
  }
});

test('another user cannot read or advance a job', async () => {
  const env = makeEnv();
  const config = getConfig(env);
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();

  try {
    const owner = await createSession(env, config, {
      token: 'token-a',
      user: { id: 1, login: 'owner', name: 'Owner', avatar_url: 'a', html_url: 'h' },
    });
    const intruder = await createSession(env, config, {
      token: 'token-b',
      user: { id: 2, login: 'intruder', name: 'Intruder', avatar_url: 'a', html_url: 'h' },
    });
    const ownerHeaders = {
      cookie: `cc_session=${owner.id}`,
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'x-csrf-token': owner.csrfToken,
    };

    const created = await handleRequest(
      new Request('https://api.example.com/api/publish/jobs', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          owner: 'octocat',
          repo: 'site',
          branch: 'main',
          files: [{ path: 'a.txt', message: 'Add a.txt', content: Buffer.from('a').toString('base64') }],
        }),
      }),
      env
    );
    const job = (await created.json()).job;

    const stolen = await handleRequest(
      new Request(`https://api.example.com/api/publish/jobs/${job.id}`, {
        headers: { cookie: `cc_session=${intruder.id}`, origin: 'http://localhost:3000' },
      }),
      env
    );
    assert.equal(stolen.status, 404);
    assert.equal((await stolen.json()).error.code, 'JOB_NOT_FOUND');

    const advanced = await handleRequest(
      new Request(`https://api.example.com/api/publish/jobs/${job.id}/start`, {
        method: 'POST',
        headers: {
          cookie: `cc_session=${intruder.id}`,
          origin: 'http://localhost:3000',
          'x-csrf-token': intruder.csrfToken,
        },
      }),
      env
    );
    assert.equal(advanced.status, 404);
    assert.equal(fake.refs.get('octocat/site#main'), fake.snapshot('octocat/site', 'main').head);
  } finally {
    restore();
  }
});
