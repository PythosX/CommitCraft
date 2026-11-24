# Architecture

CommitCraft is two independently deployable pieces and one external API:

| Piece     | Runtime               | Responsibility                                              |
| --------- | --------------------- | ----------------------------------------------------------- |
| Frontend  | Static files (Vercel) | Upload, filter, plan, and drive publishing; render progress |
| Backend   | Cloudflare Worker     | Sessions, GitHub proxy, commit engine, job state, history   |
| GitHub    | REST + Git Database   | The actual repositories and commits                         |

There is no build step and no runtime dependency in either piece. The Worker uses only Web APIs
(`fetch`, `crypto.subtle`, KV bindings).

## Request pipeline

```
Browser request
   │
   ▼
index.js
   ├─ CORS preflight (explicit allowlist)
   ├─ /api/health
   ├─ origin check (when the browser sends Origin)
   ├─ load session cookie → KV → decrypt GitHub token
   ├─ CSRF check (mutations, X-CSRF-Token vs session token)
   ├─ JSON body parse with size cap
   ├─ route handler (auth / history / settings / github / publishing)
   └─ error middleware → typed JSON error
```

Every response is `cache-control: no-store`, has a request id, and CORS headers are only emitted for
allowlisted origins.

## Session model

1. `GET /api/auth/github` creates a random state, stores it in KV (`oauth:<state>`, 10 min TTL) and sets an
   HttpOnly state cookie.
2. GitHub redirects to `/api/auth/github/callback?code&state`.
3. The Worker validates `state` against both KV and the cookie, exchanges the code, reads `/user`, then:
   - encrypts the access token with AES-GCM (PBKDF2 key from `SESSION_SECRET`),
   - stores `{userId, csrfToken, user, token, expiresAt}` in KV under a random 256-bit id,
   - sets the session cookie (HttpOnly; `Secure; SameSite=None` + `__Host-` prefix in production).
4. The browser only ever holds the opaque session id.

`GET /api/auth/session` returns `{authenticated, user, csrfToken, scopes, expiresAt}`. The CSRF token is
readable by same-origin JS **because CORS prevents other origins from reading the response**.

## Publishing engine

A job is created once, then advanced in batches. This keeps every Worker invocation inside its subrequest
budget while remaining resumable.

### Job creation (`POST /api/publish/jobs`)

```
validate payload (paths, messages, base64, sizes, duplicates, secrets)
   │
   ├─ GET /repos/:owner/:repo            → permissions, default branch
   ├─ GET /git/ref/heads/:branch         → 404/409 means "empty"
   ├─ GET /git/commits/:sha              → current tree sha
   ├─ GET /git/trees/:tree?recursive=1   → which files already exist
   │
   ├─ store job metadata in KV           → job:<id>          (7 day TTL)
   ├─ store each file's content in KV    → blob:<id>:<index> (7 day TTL)
   └─ append to the user's job index     → jobs:<userId>
```

Nothing is committed yet. The job is `queued`.

### One publishing tick (`POST /api/publish/jobs/:id/start|resume|retry`)

```
1. reconcile:
   - read the branch head
   - if head === job.headSha → continue
   - if head is our own unrecorded commit (message + parent + blob match)
     → adopt it, mark that file completed, continue
   - otherwise → pause with a branch-conflict message
2. for up to PUBLISH_BATCH_SIZE files:
   a. read content from KV
   b. compute the expected Git blob sha locally (SHA-1 of "blob <len>\0"+bytes)
   c. mark file "committing" and persist  ← crash marker
   d. POST /git/blobs
   e. POST /git/trees  { base_tree: headTree, tree: [{path, mode, sha}] }
   f. POST /git/commits { message, tree, parents: [headSha] }
   g. PATCH /git/refs/heads/:branch { sha, force: false }
   h. mark file completed, persist headSha/headTreeSha, delete content from KV
3. if every file is terminal → finalize + write history
```

`force: false` is the safety net: if anything else moved the branch between (a) and (g), GitHub rejects the
update and the job pauses. CommitCraft never force-pushes.

### State machine

```
queued ──start──► running ──all done──► completed
                    │  │
                    │  └──some failed──► partial
                    │
                    ├──conflict / rate limit / auth──► paused ──resume──► running
                    ├──every file failed────────────► failed
                    └──user cancels─────────────────► cancelled
```

Files move `waiting → processing → committing → completed|failed`. `skipped` is only used when a job is
cancelled.

### Recovery guarantees

- Job state is persisted **before** a commit is attempted and again after every successful commit.
- If the process dies between "commit landed" and "state saved", reconciliation compares the remote head
  with the recorded `headSha`, the pending file's expected blob sha and the commit's parent. A match is
  adopted — no duplicate commit.
- Re-running `start` on a terminal job returns the job unchanged.
- Uploaded content is deleted per file as it succeeds, and the whole job expires in 7 days.

## Storage layout

| Namespace  | Keys                                      | Notes                          |
| ---------- | ----------------------------------------- | ------------------------------ |
| `SESSIONS` | `session:<id>`, `oauth:<state>`, `settings:<userId>`, `rate:*` | encrypted token, CSRF token |
| `JOBS`     | `job:<id>`, `blob:<id>:<index>`, `jobs:<userId>` | job metadata + file contents |
| `HISTORY`  | `history:<userId>:<jobId>`, `history-index:<userId>` | immutable job records |

KV values are JSON. File contents are stored as base64 in their own keys so a job document never approaches
the KV value limit. A single KV binding (`KV`) can be used as a fallback for all three.

## Frontend flow

```
repositories.html → localStorage: {owner, repo, branch}
       │
upload.html → reads folder (File System APIs) → base64 → IndexedDB
       │        applies ignore rules, previews text
       ▼
commit-plan.html → loads IndexedDB project, edits messages, reorders
       │            POST /api/publish/jobs (contents uploaded once)
       ▼
publishing.html?job=id → POST .../start repeatedly until done/paused
       │                  renders server state after every tick
       ▼
history.html → GET /api/publish/history
```

Only preferences live in localStorage. The project between screens lives in IndexedDB. No token ever
reaches the browser.

## Failure modes and responses

| Failure                        | Behaviour                                                   |
| ------------------------------ | ----------------------------------------------------------- |
| GitHub 401                     | Session marked expired, job pauses, UI asks to sign in again |
| GitHub 403 / 429               | Job pauses with a rate-limit message; retry resumes          |
| GitHub 422 (not fast-forward)  | Treated as a branch conflict; job pauses, nothing is lost    |
| Network error / timeout        | File marked failed with a retryable message                  |
| Browser closed                 | Job persists; reopening `publishing.html?job=<id>` resumes    |
| User cancels                   | Waiting files are skipped; committed files stay on GitHub    |

## Why a hand-rolled router

The API has 18 routes. A framework would add bundle weight, a build step and version churn for no benefit
inside a Worker. Routing is a list of handler functions that return `null` when a path does not match.
