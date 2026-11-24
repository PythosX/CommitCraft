import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './helpers/fake-github.js';
import { createFakeKV } from './helpers/fake-kv.js';
import { getConfig } from '../src/config/env.js';
import { advanceJob, cancelJob, createPublishJob, publicJob } from '../src/services/publishing-engine.js';
import { getJob, saveJob } from '../src/storage/job-store.js';
import { commitFile } from '../src/services/commit-engine.js';
import { gitBlobSha } from '../src/utils/crypto.js';

const TOKEN = 'token';
const USER = { id: 42, login: 'octocat' };

function makeEnv(overrides = {}) {
  const kv = createFakeKV();
  return {
    GITHUB_CLIENT_ID: 'client',
    GITHUB_CLIENT_SECRET: 'secret',
    SESSION_SECRET: 'session-secret-value',
    ENCRYPTION_KEY: 'encryption-key-value',
    FRONTEND_URL: 'http://localhost:3000',
    GITHUB_CALLBACK_URL: 'http://localhost:8787/api/auth/github/callback',
    PUBLISH_BATCH_SIZE: '2',
    SESSIONS: kv,
    JOBS: kv,
    HISTORY: kv,
    ...overrides,
  };
}

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function files(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    path: index === 0 ? 'index.html' : `src/file-${index}.js`,
    message: `Add ${index === 0 ? 'index.html' : `src/file-${index}.js`}`,
    content: b64(`content ${index}`),
    size: `content ${index}`.length,
  }));
}

async function runToCompletion(env, config, job, token = TOKEN) {
  let guard = 0;
  let current = job;
  while (guard < 40) {
    guard += 1;
    const result = await advanceJob(env, config, current, token);
    current = result.job;
    if (result.done || current.status === 'paused') break;
  }
  return current;
}

test('publishes five files as five chained commits and keeps existing files', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/portfolio');
  const restore = fake.install();
  try {
    const env = makeEnv();
    const config = getConfig(env);
    const job = await createPublishJob(env, config, {
      user: USER,
      token: TOKEN,
      owner: 'octocat',
      repo: 'portfolio',
      branch: 'main',
      files: files(5),
    });

    assert.equal(job.mode, 'existing');
    assert.equal(job.files.length, 5);

    const final = await runToCompletion(env, config, job);
    assert.equal(final.status, 'completed');
    const stats = publicJob(final).stats;
    assert.equal(stats.completed, 5);
    assert.equal(stats.commits, 5);

    const snapshot = fake.snapshot('octocat/portfolio', 'main');
    assert.deepEqual(Object.keys(snapshot.files).sort(), [
      'README.md',
      'index.html',
      'src/file-1.js',
      'src/file-2.js',
      'src/file-3.js',
      'src/file-4.js',
    ]);

    // Parent chain: 5 new commits on top of the initial commit.
    assert.equal(snapshot.commits.length, 6);
    for (let index = 0; index < 5; index += 1) {
      const commit = snapshot.commits[index];
      assert.equal(commit.parents.length, 1, 'each new commit has exactly one parent');
      assert.equal(commit.parents[0], snapshot.commits[index + 1].sha, 'parent is the previous commit');
    }
    assert.equal(snapshot.commits[5].message, 'Initial commit');

    // Every published commit is visible with its SHA.
    assert.equal(final.files.every((file) => file.commitSha && file.commitSha.length === 40), true);
  } finally {
    restore();
  }
});

test('creates the branch when publishing to an empty repository', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/blank', { empty: true });
  const restore = fake.install();
  try {
    const env = makeEnv();
    const config = getConfig(env);
    const job = await createPublishJob(env, config, {
      user: USER,
      token: TOKEN,
      owner: 'octocat',
      repo: 'blank',
      branch: 'main',
      files: files(3),
    });
    assert.equal(job.mode, 'empty');

    const final = await runToCompletion(env, config, job);
    assert.equal(final.status, 'completed');
    const snapshot = fake.snapshot('octocat/blank', 'main');
    assert.deepEqual(Object.keys(snapshot.files).sort(), ['index.html', 'src/file-1.js', 'src/file-2.js']);
    assert.equal(snapshot.commits.length, 3);
    assert.deepEqual(snapshot.commits[2].parents, [], 'first commit has no parent');
  } finally {
    restore();
  }
});

test('marks updates separately from additions', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const env = makeEnv();
    const config = getConfig(env);
    const job = await createPublishJob(env, config, {
      user: USER,
      token: TOKEN,
      owner: 'octocat',
      repo: 'site',
      branch: 'main',
      files: [
        { path: 'README.md', message: 'Update README.md', content: b64('# New readme') },
        { path: 'app.js', message: 'Add app.js', content: b64('app') },
      ],
    });
    assert.equal(job.files[0].existed, true);
    assert.equal(job.files[1].existed, false);

    const final = await runToCompletion(env, config, job);
    assert.equal(final.status, 'completed');
    const view = publicJob(final);
    assert.equal(view.files[0].updated, true);
    assert.equal(view.files[1].updated, false);
    assert.equal(view.stats.updated, 1);
    assert.equal(view.stats.added, 1);
  } finally {
    restore();
  }
});

test('adopts a commit that landed before a crash instead of duplicating it', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const env = makeEnv();
    const config = getConfig(env, {});
    const job = await createPublishJob(env, config, {
      user: USER,
      token: TOKEN,
      owner: 'octocat',
      repo: 'site',
      branch: 'main',
      files: files(3),
    });

    // One tick completes two files (PUBLISH_BATCH_SIZE=2).
    const firstTick = await advanceJob(env, config, job, TOKEN);
    assert.equal(firstTick.job.files[0].status, 'completed');
    assert.equal(firstTick.job.files[1].status, 'completed');
    const headAfterFirst = firstTick.job.headSha;
    const jobDoc = await getJob(env, job.id);

    // Simulate the crash window: the third commit reached GitHub but the job
    // document was never updated.
    const content = files(3)[2].content;
    const blobSha = await gitBlobSha(content);
    const landed = await commitFile(env, TOKEN, 'octocat', 'site', {
      branch: 'main',
      headSha: headAfterFirst,
      baseTreeSha: jobDoc.headTreeSha,
      filePath: jobDoc.files[2].path,
      message: jobDoc.files[2].message,
      content,
    });

    jobDoc.headSha = headAfterFirst;
    jobDoc.files[2].status = 'committing';
    jobDoc.files[2].expectedBlobSha = blobSha;
    jobDoc.files[2].attempts = 1;
    await saveJob(env, jobDoc);

    const commitsBefore = fake.commits.size;
    const resumed = await advanceJob(env, config, jobDoc, TOKEN);
    assert.equal(fake.commits.size, commitsBefore, 'no duplicate commit was created');
    assert.equal(resumed.job.files[2].status, 'completed');
    assert.equal(resumed.job.headSha, landed.commitSha);
    assert.equal(resumed.done, true);
    assert.equal(resumed.job.status, 'completed');
  } finally {
    restore();
  }
});

test('pauses on a branch conflict instead of overwriting remote work', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const env = makeEnv();
    const config = getConfig(env);
    const job = await createPublishJob(env, config, {
      user: USER,
      token: TOKEN,
      owner: 'octocat',
      repo: 'site',
      branch: 'main',
      files: files(4),
    });

    const firstTick = await advanceJob(env, config, job, TOKEN);
    assert.equal(firstTick.done, false);

    const externalSha = 'f'.repeat(40);
    const head = fake.snapshot('octocat/site', 'main');
    fake.commits.set(externalSha, { sha: externalSha, message: 'Someone else', tree: fake.snapshot('octocat/site', 'main').commits[0].tree, parents: [head.head] });
    fake.moveBranch('octocat/site', 'main', externalSha);

    const result = await advanceJob(env, config, firstTick.job, TOKEN);
    assert.equal(result.job.status, 'paused');
    assert.equal(result.conflict, 'conflict');
    assert.match(result.job.error, /branch changed/i);
    assert.equal(fake.snapshot('octocat/site', 'main').head, externalSha, 'remote head untouched');
  } finally {
    restore();
  }
});

test('retries failed files and finishes the job', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const env = makeEnv();
    const config = getConfig(env);
    const job = await createPublishJob(env, config, {
      user: USER,
      token: TOKEN,
      owner: 'octocat',
      repo: 'site',
      branch: 'main',
      files: files(2),
    });

    fake.state.rateLimitNext = true;
    const paused = await advanceJob(env, config, job, TOKEN);
    assert.equal(paused.job.status, 'paused');
    assert.equal(paused.job.blockedReason, 'auth-or-rate-limit');
    assert.match(paused.job.error, /rate limit/i);
    assert.ok(fake.snapshot('octocat/site', 'main').head === job.headSha, 'nothing committed while rate limited');

    let final = paused.job;
    for (let attempt = 0; attempt < 10 && final.status !== 'completed'; attempt += 1) {
      const step = await advanceJob(env, config, final, TOKEN, { retryFailed: true });
      final = step.job;
    }
    assert.equal(final.status, 'completed');
    assert.equal(publicJob(final).stats.completed, 2);
  } finally {
    restore();
  }
});

test('cancel marks the job cancelled and records history', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const env = makeEnv();
    const config = getConfig(env);
    const job = await createPublishJob(env, config, {
      user: USER,
      token: TOKEN,
      owner: 'octocat',
      repo: 'site',
      branch: 'main',
      files: files(3),
    });
    const cancelled = await cancelJob(env, job);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.files.every((file) => file.status === 'skipped'), true);

    const historyKey = 'history:42:' + cancelled.id;
    const stored = await env.HISTORY.get(historyKey);
    assert.ok(stored, 'history record written');
    assert.equal(JSON.parse(stored).status, 'cancelled');
  } finally {
    restore();
  }
});
