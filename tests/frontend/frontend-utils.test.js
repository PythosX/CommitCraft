import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRules, evaluate, sensitiveReason, gitBlobSha } from '../../frontend/js/utils/file-utils.js';
import { renderMessage, orderFiles } from '../../frontend/js/services/commit-service.js';
import { validRepoPath, normalizePrefix } from '../../frontend/js/utils/path-utils.js';
import * as V from '../../frontend/js/utils/validation.js';
import { bytes } from '../../frontend/js/utils/format-utils.js';

const ignored = (p, o) => evaluate(p, buildRules(o)).ignored;

test('default exclusions match the spec', () => {
  for (const p of ['.git/config', 'node_modules/x/index.js', 'a/node_modules/b.js', '.env', '.env.local', '.env.production', 'dist/app.js', 'build/x', '.next/cache', '.vercel/p.json', '__pycache__/a.pyc', 'src/__pycache__/a.pyc', '.DS_Store', 'img/Thumbs.db']) assert.ok(ignored(p), p);
  for (const p of ['index.html', 'src/dist-notes.md', '.env.example', 'assets/logo.svg', 'builder.js']) assert.ok(!ignored(p), p);
});
test('gitignore syntax: negation, anchors, dir-only, globs', () => {
  const o = { gitignoreText: '*.log\n!keep.log\n/root-only.txt\ntmp/\ndocs/**/*.draft\n# comment\n' };
  assert.ok(ignored('a/b/x.log', o)); assert.ok(!ignored('keep.log', o));
  assert.ok(ignored('root-only.txt', o)); assert.ok(!ignored('sub/root-only.txt', o));
  assert.ok(ignored('tmp/a.txt', o)); assert.ok(ignored('x/tmp/a.txt', o));
  assert.ok(ignored('docs/a/b/c.draft', o)); assert.ok(!ignored('docs/a.md', o));
});
test('custom patterns and reasons', () => {
  const r = evaluate('notes/secret.txt', buildRules({ custom: ['notes/'] }));
  assert.ok(r.ignored); assert.match(r.reason, /Custom pattern/);
  assert.match(evaluate('.env', buildRules()).reason, /Default rule/);
});
test('sensitive filename detection', () => {
  for (const p of ['.env', 'config/.env.production', 'server.pem', 'id_rsa', 'credentials.json', '.npmrc', 'a/secrets.yml']) assert.ok(sensitiveReason(p), p);
  for (const p of ['.env.example', 'index.html', 'src/keyboard.js']) assert.equal(sensitiveReason(p), null, p);
});
test('commit message templates', () => {
  assert.equal(renderMessage('add', 'assets/logo.svg'), 'Add assets/logo.svg');
  assert.equal(renderMessage('create', 'index.html'), 'Create index.html');
  assert.equal(renderMessage('update', 'a.js'), 'Update a.js');
  assert.equal(renderMessage('folder', 'assets/logo.svg'), 'Add assets file: logo.svg');
  assert.equal(renderMessage('folder', 'README.md'), 'Add root file: README.md');
  assert.equal(renderMessage('add', 'a.js', 'update'), 'Update a.js');
});
test('ordering', () => {
  const f = [{ path: 'z.txt', size: 1 }, { path: 'a/b.txt', size: 9 }, { path: 'a.txt', size: 5 }];
  assert.deepEqual(orderFiles(f, 'path').map((x) => x.path), ['a.txt', 'a/b.txt', 'z.txt']);
  assert.deepEqual(orderFiles(f, 'size-asc').map((x) => x.path), ['z.txt', 'a.txt', 'a/b.txt']);
  assert.deepEqual(orderFiles(f, 'folders-first').map((x) => x.path)[0], 'a/b.txt');
});
test('path and name validation mirrors the server', () => {
  assert.ok(validRepoPath('a/b/c.txt')); for (const p of ['../a', '/a', 'a//b', '.git/x', 'a/']) assert.ok(!validRepoPath(p), p);
  assert.deepEqual(normalizePrefix(' /docs/site/ '), { ok: true, value: 'docs/site' }); assert.equal(normalizePrefix('../x').ok, false);
  assert.ok(V.repoName('bad name')); assert.equal(V.repoName('good-name.1'), null); assert.ok(V.branchName('a..b')); assert.equal(V.branchName('feat/x'), null);
  assert.equal(V.commitMessage('Add a'), null); assert.equal(V.commitMessage('  ').level, 'error');
  assert.equal(bytes(1536), '1.5 KB');
});
test('git blob sha matches git itself', async () => {
  // `printf 'hello' | git hash-object --stdin`
  assert.equal(await gitBlobSha(new Blob(['hello'])), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  assert.equal(await gitBlobSha(new Blob([''])), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});
