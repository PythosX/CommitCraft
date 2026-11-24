import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './helpers/fake-github.js';
import { commitFile, createInitialCommit, resolveBaseState } from '../src/services/commit-engine.js';
import { getCommit, getTreeMap, getBranchRef } from '../src/services/git-data-service.js';
import { gitBlobSha } from '../src/utils/crypto.js';

const env = {};
const TOKEN = 'token';

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

test('creates one commit per file, chained to the previous commit', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const base = await resolveBaseState(env, TOKEN, 'octocat', 'site', 'main');
    assert.equal(base.mode, 'existing');

    const first = await commitFile(env, TOKEN, 'octocat', 'site', {
      branch: 'main',
      headSha: base.headSha,
      baseTreeSha: base.baseTreeSha,
      filePath: 'index.html',
      message: 'Add index.html',
      content: b64('<h1>hi</h1>'),
    });

    const second = await commitFile(env, TOKEN, 'octocat', 'site', {
      branch: 'main',
      headSha: first.commitSha,
      baseTreeSha: first.treeSha,
      filePath: 'assets/logo.svg',
      message: 'Add assets/logo.svg',
      content: b64('<svg/>'),
    });

    const snapshot = fake.snapshot('octocat/site', 'main');
    assert.equal(snapshot.head, second.commitSha);
    assert.deepEqual(Object.keys(snapshot.files).sort(), ['README.md', 'assets/logo.svg', 'index.html']);
    assert.equal(snapshot.files['README.md'] !== undefined, true, 'existing file preserved');

    const commit = await getCommit(env, TOKEN, 'octocat', 'site', second.commitSha);
    assert.deepEqual(commit.parents, [first.commitSha]);
    assert.equal(commit.message, 'Add assets/logo.svg');

    const tree = await getTreeMap(env, TOKEN, 'octocat', 'site', second.treeSha);
    assert.equal(tree.map.get('index.html').sha, await gitBlobSha(b64('<h1>hi</h1>')));
    assert.equal(tree.map.get('assets/logo.svg').sha, await gitBlobSha(b64('<svg/>')));
  } finally {
    restore();
  }
});

test('updates an existing file without touching siblings', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const base = await resolveBaseState(env, TOKEN, 'octocat', 'site', 'main');
    const result = await commitFile(env, TOKEN, 'octocat', 'site', {
      branch: 'main',
      headSha: base.headSha,
      baseTreeSha: base.baseTreeSha,
      filePath: 'README.md',
      message: 'Update README.md',
      content: b64('# Updated'),
    });
    const snapshot = fake.snapshot('octocat/site', 'main');
    assert.deepEqual(Object.keys(snapshot.files), ['README.md']);
    assert.equal(snapshot.files['README.md'], b64('# Updated'));
    assert.equal(snapshot.head, result.commitSha);
  } finally {
    restore();
  }
});

test('bootstraps an empty repository with an initial parentless commit', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/blank', { empty: true });
  const restore = fake.install();
  try {
    const base = await resolveBaseState(env, TOKEN, 'octocat', 'blank', 'main');
    assert.equal(base.mode, 'empty');
    assert.equal(base.headSha, null);

    const initial = await createInitialCommit(env, TOKEN, 'octocat', 'blank', {
      branch: 'main',
      filePath: 'README.md',
      message: 'Add README.md',
      content: b64('# Blank'),
    });

    const ref = await getBranchRef(env, TOKEN, 'octocat', 'blank', 'main');
    assert.equal(ref.exists, true);
    assert.equal(ref.sha, initial.commitSha);
    const commit = await getCommit(env, TOKEN, 'octocat', 'blank', initial.commitSha);
    assert.deepEqual(commit.parents, []);

    const second = await commitFile(env, TOKEN, 'octocat', 'blank', {
      branch: 'main',
      headSha: initial.commitSha,
      baseTreeSha: initial.treeSha,
      filePath: 'src/app.js',
      message: 'Add src/app.js',
      content: b64('console.log(1)'),
    });
    const snapshot = fake.snapshot('octocat/blank', 'main');
    assert.deepEqual(Object.keys(snapshot.files).sort(), ['README.md', 'src/app.js']);
    assert.equal(snapshot.head, second.commitSha);
  } finally {
    restore();
  }
});

test('refuses to move a branch that advanced underneath us', async () => {
  const fake = createFakeGitHub();
  fake.addRepo('octocat/site');
  const restore = fake.install();
  try {
    const base = await resolveBaseState(env, TOKEN, 'octocat', 'site', 'main');
    fake.state.failNextRefUpdate = true;
    await assert.rejects(
      () =>
        commitFile(env, TOKEN, 'octocat', 'site', {
          branch: 'main',
          headSha: base.headSha,
          baseTreeSha: base.baseTreeSha,
          filePath: 'x.txt',
          message: 'Add x.txt',
          content: b64('x'),
        }),
      (error) => error.status === 422 || error.name === 'GitHubError'
    );
    assert.equal(fake.snapshot('octocat/site', 'main').head, base.headSha);
  } finally {
    restore();
  }
});
