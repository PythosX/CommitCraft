import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSensitivePath,
  validateBranchName,
  validateFilePath,
  validateRepoName,
} from '../src/utils/path-validator.js';
import { decodeBase64Size, validateFiles } from '../src/utils/validation.js';

const config = { maxFilesPerJob: 10, maxFileBytes: 1024 * 1024, maxJobBytes: 5 * 1024 * 1024 };

test('accepts nested relative paths and preserves them', () => {
  assert.equal(validateFilePath('src/components/Button.js'), 'src/components/Button.js');
  assert.equal(validateFilePath('assets/images/logo.svg'), 'assets/images/logo.svg');
  assert.equal(validateFilePath('README.md'), 'README.md');
});

test('rejects traversal, absolute paths, backslashes and empty segments', () => {
  for (const bad of ['../secret.txt', 'a/../../b', '/etc/passwd', 'C:\\temp\\x', 'a\\\\b', 'src//x.js', './x.js']) {
    assert.throws(() => validateFilePath(bad), /path|traversal|absolute|segment|backslash/i, bad);
  }
});

test('rejects .git and sensitive files', () => {
  assert.throws(() => validateFilePath('.git/config'), /cannot be published/);
  assert.throws(() => validateFilePath('config/.env'), /secret file/);
  assert.throws(() => validateFilePath('id_rsa'), /secret file/);
  // Templates are allowed because they contain no real secrets.
  assert.equal(validateFilePath('.env.example'), '.env.example');
  assert.equal(isSensitivePath('deploy.key.pem'), true);
  assert.equal(isSensitivePath('src/index.js'), false);
});

test('validates repository and branch names', () => {
  assert.equal(validateRepoName('my-portfolio'), 'my-portfolio');
  assert.throws(() => validateRepoName('bad name'));
  assert.throws(() => validateRepoName('repo.git'));
  assert.equal(validateBranchName('feature/commitcraft'), 'feature/commitcraft');
  assert.throws(() => validateBranchName('bad branch'));
  assert.throws(() => validateBranchName('a..b'));
  assert.throws(() => validateBranchName('ends.lock'));
});

test('base64 size detection matches decoded length', () => {
  const content = Buffer.from('hello world').toString('base64');
  assert.equal(decodeBase64Size(content), 11);
  assert.equal(decodeBase64Size('not-base64!'), -1);
});

test('validateFiles normalises messages and rejects duplicates', () => {
  const content = Buffer.from('body{}').toString('base64');
  const files = validateFiles([{ path: 'a/style.css', message: 'Add style', content }], config);
  assert.equal(files[0].message, 'Add style');
  assert.equal(files[0].size, 6);

  assert.throws(() =>
    validateFiles(
      [
        { path: 'a.css', content },
        { path: 'a.css', content },
      ],
      config
    )
  );
});

test('validateFiles enforces the per-file size limit', () => {
  const big = Buffer.alloc(2048, 1).toString('base64');
  assert.throws(
    () => validateFiles([{ path: 'big.bin', content: big }], { ...config, maxFileBytes: 1024 }),
    /larger than/
  );
});
