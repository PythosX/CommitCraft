import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubError, githubRequest, hasNextPage } from '../src/services/github-api.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function withFetch(handler, action) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}

test('sends the expected headers and parses JSON', async () => {
  let captured;
  await withFetch(
    (url, init) => {
      captured = { url, init };
      return jsonResponse({ ok: true });
    },
    async () => {
      const result = await githubRequest({}, 'gho_token', '/user');
      assert.deepEqual(result.data, { ok: true });
    }
  );
  assert.equal(captured.url, 'https://api.github.com/user');
  assert.equal(captured.init.headers.authorization, 'Bearer gho_token');
  assert.equal(captured.init.headers['x-github-api-version'], '2022-11-28');
  assert.equal(captured.init.headers.accept, 'application/vnd.github+json');
});

test('401 becomes SESSION_EXPIRED', async () => {
  await withFetch(
    () => jsonResponse({ message: 'Bad credentials' }, 401),
    async () => {
      await assert.rejects(
        () => githubRequest({}, 't', '/user'),
        (error) => error instanceof GitHubError && error.code === 'SESSION_EXPIRED' && error.status === 401
      );
    }
  );
});

test('403 with exhausted rate limit becomes RATE_LIMITED with retryAfter', async () => {
  const reset = Math.floor(Date.now() / 1000) + 42;
  await withFetch(
    () =>
      jsonResponse(
        { message: 'API rate limit exceeded' },
        403,
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }
      ),
    async () => {
      await assert.rejects(
        () => githubRequest({}, 't', '/user/repos'),
        (error) => {
          assert.equal(error.code, 'RATE_LIMITED');
          assert.equal(error.status, 429);
          assert.ok(error.retryAfter >= 40 && error.retryAfter <= 45);
          return true;
        }
      );
    }
  );
});

test('403 without rate limiting becomes GITHUB_FORBIDDEN', async () => {
  await withFetch(
    () => jsonResponse({ message: 'Resource not accessible by integration' }, 403),
    async () => {
      await assert.rejects(
        () => githubRequest({}, 't', '/repos/a/b'),
        (error) => error.code === 'GITHUB_FORBIDDEN' && error.status === 403
      );
    }
  );
});

test('404 and 422 map to actionable codes', async () => {
  await withFetch(
    (url) =>
      String(url).includes('missing')
        ? jsonResponse({ message: 'Not Found' }, 404)
        : jsonResponse({ message: 'Reference update failed', errors: [{ code: 'custom' }] }, 422),
    async () => {
      await assert.rejects(
        () => githubRequest({}, 't', '/repos/a/missing'),
        (error) => error.code === 'GITHUB_NOT_FOUND'
      );
      await assert.rejects(
        () => githubRequest({}, 't', '/repos/a/b/git/refs', { method: 'PATCH', body: {} }),
        (error) => error.code === 'GITHUB_VALIDATION' && error.status === 422 && error.details.length === 1
      );
    }
  );
});

test('network failures become NETWORK_ERROR, never an unhandled rejection', async () => {
  await withFetch(
    () => {
      throw new TypeError('fetch failed');
    },
    async () => {
      await assert.rejects(
        () => githubRequest({}, 't', '/user'),
        (error) => error.code === 'NETWORK_ERROR' && error.status === 502
      );
    }
  );
});

test('a missing token fails fast without calling fetch', async () => {
  let called = false;
  await withFetch(
    () => {
      called = true;
      return jsonResponse({});
    },
    async () => {
      await assert.rejects(() => githubRequest({}, '', '/user'), (error) => error.code === 'NO_TOKEN');
    }
  );
  assert.equal(called, false);
});

test('Link header pagination detection', () => {
  assert.equal(hasNextPage('<https://api.github.com/user/repos?page=2>; rel="next"'), true);
  assert.equal(hasNextPage('<https://api.github.com/user/repos?page=1>; rel="prev"'), false);
  assert.equal(hasNextPage(''), false);
});
