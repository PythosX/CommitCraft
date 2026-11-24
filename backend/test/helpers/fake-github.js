/**
 * In-memory GitHub Git Database API used by the engine tests.
 * It models blobs, trees, commits and refs closely enough to assert real Git
 * semantics: parent chaining, tree preservation and fast-forward ref updates.
 */

import { gitBlobSha } from '../../src/utils/crypto.js';

function sha1Like(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 0xffffffff;
  return hash.toString(16).padStart(8, '0').repeat(5).slice(0, 40);
}

export function createFakeGitHub(options = {}) {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const refs = new Map();
  const repos = new Map();
  const calls = [];
  const state = {
    failNextRefUpdate: false,
    failNextBlob: false,
    rateLimitNext: false,
  };

  function addRepo(fullName, { empty = false, defaultBranch = 'main', private: isPrivate = false } = {}) {
    const [owner, name] = fullName.split('/');
    repos.set(fullName, {
      id: repos.size + 1,
      name,
      full_name: fullName,
      owner: { login: owner },
      private: isPrivate,
      default_branch: defaultBranch,
      size: empty ? 0 : 12,
      html_url: `https://github.com/${fullName}`,
      description: '',
      permissions: { admin: true, push: true },
    });
    if (!empty) {
      const treeSha = sha1Like(`tree:${fullName}:init`);
      const commitSha = sha1Like(`commit:${fullName}:init`);
      trees.set(treeSha, new Map([['README.md', sha1Like('blob:readme')]]));
      blobs.set(sha1Like('blob:readme'), 'IyBSRVBN');
      commits.set(commitSha, { sha: commitSha, message: 'Initial commit', tree: treeSha, parents: [] });
      refs.set(`${fullName}#${defaultBranch}`, commitSha);
    }
    return repos.get(fullName);
  }

  function resolveFiles(sha) {
    const commit = commits.get(sha);
    if (!commit) return null;
    const entries = trees.get(commit.tree);
    return entries ? { commit, entries } : null;
  }

  function snapshot(fullName, branch) {
    const head = refs.get(`${fullName}#${branch}`);
    if (!head) return null;
    const resolved = resolveFiles(head);
    if (!resolved) return null;
    const files = {};
    for (const [path, blobSha] of resolved.entries) files[path] = blobs.get(blobSha);
    const chain = [];
    let cursor = head;
    while (cursor) {
      const commit = commits.get(cursor);
      if (!commit) break;
      chain.push(commit);
      cursor = commit.parents[0];
    }
    return { head, files, commits: chain };
  }

  function moveBranch(fullName, branch, sha) {
    refs.set(`${fullName}#${branch}`, sha);
  }

  function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' },
    });
  }

  function notFound() {
    return json({ message: 'Not Found' }, 404);
  }

  async function handler(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';
    const path = url.pathname.replace(/^\/api\/v3/, '');
    calls.push({ method, path, search: url.search });

    if (state.rateLimitNext) {
      state.rateLimitNext = false;
      return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30) },
      });
    }

    if (path === '/user' && method === 'GET') {
      return json({ id: 1, login: 'octocat', name: 'Octo Cat', avatar_url: 'https://avatars/x.png', html_url: 'https://github.com/octocat' });
    }

    if (path === '/user/repos' && method === 'POST') {
      const body = JSON.parse(init.body || '{}');
      const repo = addRepo(`octocat/${body.name}`, { empty: !body.auto_init, private: Boolean(body.private) });
      return json(repo, 201);
    }

    if (path === '/user/repos' && method === 'GET') {
      return json([...repos.values()]);
    }

    const gitMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!gitMatch) return notFound();
    const [, owner, name, rest = ''] = gitMatch;
    const fullName = `${owner}/${name}`;
    const repo = repos.get(fullName);
    if (!repo) return notFound();
    const body = init.body ? JSON.parse(init.body) : {};

    if (rest === '' && method === 'GET') return json(repo);

    if (rest === '/branches' && method === 'GET') {
      return json(
        [...refs.entries()]
          .filter(([key]) => key.startsWith(`${fullName}#`))
          .map(([key, sha]) => ({ name: key.split('#')[1], commit: { sha }, protected: false }))
      );
    }

    const refMatch = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (refMatch && method === 'GET') {
      const branch = decodeURIComponent(refMatch[1]);
      const sha = refs.get(`${fullName}#${branch}`);
      if (!sha) return notFound();
      return json({ ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } });
    }

    if (rest === '/git/refs' && method === 'GET') {
      return json(
        [...refs.entries()]
          .filter(([key]) => key.startsWith(`${fullName}#`))
          .map(([key, sha]) => ({ ref: `refs/heads/${key.split('#')[1]}`, object: { sha } }))
      );
    }

    if (rest === '/git/refs' && method === 'POST') {
      const branch = body.ref.replace('refs/heads/', '');
      const key = `${fullName}#${branch}`;
      if (refs.has(key)) return json({ message: 'Reference already exists' }, 422);
      refs.set(key, body.sha);
      return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }

    const patchRefMatch = rest.match(/^\/git\/refs\/heads\/(.+)$/);
    if (patchRefMatch && method === 'PATCH') {
      const branch = decodeURIComponent(patchRefMatch[1]);
      const key = `${fullName}#${branch}`;
      if (state.failNextRefUpdate) {
        state.failNextRefUpdate = false;
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      const current = refs.get(key);
      const commit = commits.get(body.sha);
      if (!commit) return json({ message: 'Object does not exist' }, 422);
      if (!body.force && commit.parents[0] !== current) {
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      refs.set(key, body.sha);
      return json({ ref: `refs/heads/${branch}`, object: { sha: body.sha } });
    }

    const commitMatch = rest.match(/^\/git\/commits\/([^/?]+)$/);
    if (commitMatch && method === 'GET') {
      const commit = commits.get(commitMatch[1]);
      if (!commit) return notFound();
      return json({
        sha: commit.sha,
        message: commit.message,
        tree: { sha: commit.tree },
        parents: commit.parents.map((sha) => ({ sha })),
      });
    }

    if (rest === '/git/commits' && method === 'POST') {
      const parents = body.parents || [];
      for (const parent of parents) if (!commits.has(parent)) return json({ message: 'Parent not found' }, 422);
      const sha = sha1Like(`commit:${commits.size}:${body.message}:${body.tree}:${parents.join(',')}`);
      commits.set(sha, { sha, message: body.message, tree: body.tree, parents });
      return json({ sha, tree: { sha: body.tree }, parents: parents.map((p) => ({ sha: p })) }, 201);
    }

    const treeMatch = rest.match(/^\/git\/trees\/([^/?]+)$/);
    if (treeMatch && method === 'GET') {
      const treeSha = treeMatch[1];
      const entries = trees.get(treeSha);
      if (!entries) return notFound();
      const list = [...entries.entries()].map(([entryPath, blobSha]) => ({
        path: entryPath,
        mode: '100644',
        type: 'blob',
        sha: blobSha,
        size: 10,
      }));
      return json({ sha: treeSha, tree: list, truncated: false });
    }

    if (rest === '/git/trees' && method === 'POST') {
      const base = body.base_tree ? trees.get(body.base_tree) : new Map();
      if (body.base_tree && !base) return json({ message: 'Base tree not found' }, 422);
      const next = new Map(base);
      for (const entry of body.tree || []) {
        if (!blobs.has(entry.sha)) return json({ message: 'Blob not found' }, 422);
        next.set(entry.path, entry.sha);
      }
      const sha = sha1Like(`tree:${trees.size}:${[...next.entries()].map(([p, s]) => `${p}=${s}`).join('|')}`);
      trees.set(sha, next);
      return json({ sha, tree: [], truncated: false }, 201);
    }

    if (rest === '/git/blobs' && method === 'POST') {
      if (state.failNextBlob) {
        state.failNextBlob = false;
        return json({ message: 'Server Error' }, 500);
      }
      const sha = await gitBlobSha(body.content);
      blobs.set(sha, body.content);
      return json({ sha }, 201);
    }

    const contentsMatch = rest.match(/^\/contents\/(.+)$/);
    if (contentsMatch && method === 'GET') {
      const ref = url.searchParams.get('ref');
      const branch = ref || repo.default_branch;
      const head = refs.get(`${fullName}#${branch}`) || ref;
      const resolved = resolveFiles(head);
      if (!resolved) return notFound();
      const fileSha = resolved.entries.get(contentsMatch[1]);
      if (!fileSha) return notFound();
      return json({ path: contentsMatch[1], sha: fileSha, type: 'file' });
    }

    return notFound();
  }

  return {
    handler,
    addRepo,
    snapshot,
    moveBranch,
    repos,
    refs,
    commits,
    trees,
    blobs,
    calls,
    state,
    install() {
      const original = globalThis.fetch;
      globalThis.fetch = handler;
      return () => {
        globalThis.fetch = original;
      };
    },
  };
}
