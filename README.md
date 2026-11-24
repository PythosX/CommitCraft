# CommitCraft

**Every file. A meaningful commit.**

CommitCraft is a GitHub publishing studio. Upload a local project folder, choose exactly which files to
publish, write a commit message for each one, and publish them to a GitHub repository as **one real Git
commit per file** — in your chosen order, on the branch you choose.

No bundled "initial commit". No squashed history. Every file gets its own message, its own SHA and its own
diff on GitHub.

---

## Why it exists

Dropping a whole folder into GitHub produces one enormous commit that nobody can review. CommitCraft turns
that into a readable history:

```
Local folder → file selection → commit planning → GitHub publishing → individual commits
```

## Features

- **Real GitHub OAuth** with state validation, encrypted server-side tokens and HttpOnly sessions.
- **File-by-file publishing** through the GitHub Git Database API (blob → tree → commit → ref).
- **Folder-aware paths** — `assets/images/logo.svg` stays exactly there.
- **Existing files preserved** — new trees are built on top of the current tree, never replacing it.
- **Fast-forward only** — branch updates use `force: false`; a moved branch stops the job instead of
  overwriting work.
- **Editable commit messages** with four templates, per-file editing, reset and reordering.
- **Smart ignore rules** (gitignore-style) with `.git`, `node_modules`, `dist`, `.env` excluded by default,
  visible reasons, manual restore and custom patterns.
- **Secret blocking** on both the client and the server: `.env`, private keys and credential files are
  refused.
- **Live progress** from server state, with commit links, speed, elapsed time and ETA.
- **Crash-safe recovery** — progress is persisted per file, so an interrupted job resumes without
  duplicating commits that already landed.
- **Publishing history** with per-commit SHAs and durations.
- **Settings** that actually apply: default template, publishing mode, custom ignore patterns, theme.
- Responsive, keyboard-accessible, dark/light/system themes, reduced-motion support.

## Architecture

```
┌────────────────────────────┐        ┌──────────────────────────────┐        ┌─────────────┐
│ Frontend (static, Vercel)  │  HTTPS │ CommitCraft API (Worker)     │  REST  │  GitHub     │
│ HTML + CSS + ES modules    │ ─────► │ Hono-free hand-rolled router │ ─────► │  REST +     │
│ No framework, no build     │ cookie │ Sessions · jobs · publishing │        │  Git DB API │
└────────────────────────────┘        └──────────────┬───────────────┘        └─────────────┘
                                                     │
                                           Cloudflare KV (3 namespaces)
                                        sessions · jobs + file blobs · history
```

- The browser **never** receives a GitHub access token.
- A publishing job is stored in KV and advanced in bounded batches (`PUBLISH_BATCH_SIZE`, default 4 files
  per request) so a Worker never exceeds its subrequest budget.
- Every file is committed with the previous commit as its parent; the branch ref is updated with
  `force: false`.

More detail: [docs/architecture.md](docs/architecture.md).

## Repository layout

```
backend/                 Cloudflare Worker (JavaScript, zero runtime dependencies)
  src/index.js           Router + request pipeline
  src/routes/            auth · github · publishing · history · settings
  src/services/          oauth · github-api · git-data · commit-engine · publishing-engine · recovery
  src/storage/           KV session, job and history stores
  src/middleware/        auth · CORS · rate limit · error handling
  src/utils/             crypto · validation · path validation · responses · logging
  test/                  Node test runner suites (26 tests, no network)

frontend/                Static site (no build step)
  index.html             Landing page
  dashboard.html         Dashboard
  repositories.html      Repository + branch selection
  upload.html            Folder upload, explorer, smart ignore
  commit-plan.html       Commit Message Studio + plan review
  publishing.html        Live publishing progress
  history.html           Publishing history
  settings.html          Account, publishing, appearance, security
  privacy.html           Privacy
  terms.html             Terms
  css/                   reset · variables · global · layout · components · animations · per-page · responsive
  js/config/             API base + app constants
  js/core/               api-client · auth-manager · router · state-manager · event-bus
  js/components/         navbar · sidebar · modal · toast · dropdown · file-tree · progress-bar · commit-card · icons · app-shell
  js/services/           github · repository · branch · upload · file · commit · publishing · history
  js/utils/              file · path · format · validation · error-handler · theme
  js/pages/              one module per page
  assets/icons/          favicon

docs/                    architecture · github-setup · deployment · security · api
tests/                   manual + integration test guide
```

`frontend/js/core/router.js` is intentionally small: this is a multi-page app, so navigation is real
document loads with a transition class — no client-side router to keep in sync with URLs.

## Local development

### Requirements

- Node.js 20+ (for the Worker CLI and tests)
- A Cloudflare account (free plan is enough) — only needed for deploying
- A GitHub account with permission to create OAuth apps

### 1. Backend

```bash
cd backend
npm install                  # installs wrangler (dev dependency)
npx wrangler login           # once per machine
```

Create the KV namespaces and paste their ids into `wrangler.toml`:

```bash
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create JOBS
npx wrangler kv namespace create HISTORY
```

Create `.dev.vars` **inside `backend/`** (never commit it):

```ini
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SESSION_SECRET=any_long_random_string_at_least_32_chars
ENCRYPTION_KEY=any_other_long_random_string
```

Run it:

```bash
npx wrangler dev --port 8787
```

Check `http://localhost:8787/api/health` — it should return `{"ok":true,...}`.

> **Note:** if `wrangler dev` complains about a namespace id, create the namespaces above and replace the
> placeholders in `wrangler.toml`. Local development uses Miniflare's local KV storage.

### 2. Frontend

Serve the static folder (any static server works):

```bash
python3 -m http.server 3000 --directory frontend
# or: npx serve frontend -l 3000
```

Open `http://localhost:3000`.

Each page declares the API origin in a meta tag:

```html
<meta name="commitcraft-api" content="http://localhost:8787" />
```

Change that value (in every page) for a deployed API, or append `?api=https://your-worker.workers.dev`
once — it is remembered in localStorage.

### 3. GitHub OAuth app

Create it at <https://github.com/settings/developers> → **New OAuth App**:

| Field                      | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| Application name           | CommitCraft (local)                                      |
| Homepage URL               | `http://localhost:3000`                                  |
| Authorization callback URL | `http://localhost:8787/api/auth/github/callback`         |

Scopes requested: `repo read:user` (`repo` is required to commit to private repositories).

Full walkthrough: [docs/github-setup.md](docs/github-setup.md).

## Tests

```bash
cd backend
npm test
```

36 tests run against an in-memory fake of GitHub's Git Database API and a fake KV namespace. They cover:

- five files → five commits with a verified parent chain and all pre-existing files preserved
- empty repository bootstrap (parentless first commit, then a branch ref)
- updating an existing file without touching siblings
- crash recovery: a commit that landed before the job was saved is adopted, not duplicated
- branch conflict: the job pauses and the remote head is untouched
- rate-limit handling and retry
- cancellation writes a history record
- path traversal, absolute paths, `.git`, secret filenames, duplicate paths, size limits
- OAuth state validation, CSRF rejection, origin allowlist, session expiry, encrypted token at rest
- GitHub error mapping (401, 403 + rate limit, 404, 422, network failure, missing token, pagination)
- the full HTTP flow through the router: create job → body-less `start` → commits in GitHub → history →
  idempotent re-start, plus cross-user job isolation (`404` for someone else's job)

The fake GitHub server is deliberately strict about fast-forward ref updates and tree merging, so the
engine is exercised with realistic Git semantics. It is **not** a substitute for one end-to-end run against
a real test repository — see [tests/README.md](tests/README.md) for that checklist.

## Configuration

| Variable              | Where                        | Purpose                                             |
| --------------------- | ---------------------------- | --------------------------------------------------- |
| `GITHUB_CLIENT_ID`    | Worker secret                | OAuth app client id                                 |
| `GITHUB_CLIENT_SECRET`| Worker secret                | OAuth app client secret (never in the browser)      |
| `GITHUB_CALLBACK_URL` | Worker var                   | Must match the OAuth app callback exactly           |
| `FRONTEND_URL`        | Worker var                   | Allowed CORS origin and post-login redirect         |
| `SESSION_SECRET`      | Worker secret                | Encrypts the GitHub token at rest                   |
| `ENCRYPTION_KEY`      | Worker secret                | Fallback key material for token encryption          |
| `PUBLISH_BATCH_SIZE`  | Worker var (default `4`)     | Files committed per publishing request              |
| `MAX_JOB_BYTES`       | Worker var (default 25 MB)   | Upload limit per job                                |
| `MAX_FILE_BYTES`      | Worker var (default 5 MB)    | Upload limit per file                               |
| `MAX_FILES_PER_JOB`   | Worker var (default 200)     | Files per job                                       |
| `commitcraft-api` meta| Frontend HTML                | API base URL used by the browser                    |

`.env.example` documents the same values. `SESSION_SECRET`/`ENCRYPTION_KEY` are **not** needed by the
frontend and must never be placed there.

## Deployment

- Frontend → Vercel, static output, root directory `frontend`.
- Backend → Cloudflare Workers, with three KV namespaces and four secrets.

Step-by-step, including the CORS and callback configuration and the cookie caveat for cross-site
deployments: [docs/deployment.md](docs/deployment.md).

## Security summary

- GitHub token encrypted (AES-GCM, PBKDF2-derived key) before being stored in KV.
- Random 256-bit session id in an `HttpOnly` cookie; `__Host-` + `Secure` + `SameSite=None` in production.
- CSRF synchronizer token required on every mutation; strict Origin allowlist.
- All repository names, branch names and file paths are validated server-side; `..`, absolute paths,
  backslashes, `.git/` and secret files are rejected.
- No force-push, no branch deletion, no history rewriting.
- Per-user rate limits and job ownership checks (another user's job is indistinguishable from a missing one).

Details and residual risks: [docs/security.md](docs/security.md).

## API

Full endpoint reference: [docs/api.md](docs/api.md).

```
GET  /api/health
GET  /api/auth/github                 → redirect to GitHub
GET  /api/auth/github/callback        → creates the session
GET  /api/auth/session
POST /api/auth/logout
GET  /api/github/repos
POST /api/github/repos
GET  /api/github/repository
GET  /api/github/branches
POST /api/publish/jobs
GET  /api/publish/jobs/:jobId
POST /api/publish/jobs/:jobId/start
POST /api/publish/jobs/:jobId/retry
POST /api/publish/jobs/:jobId/resume
POST /api/publish/jobs/:jobId/cancel
GET  /api/publish/history
DELETE /api/publish/history
GET  /api/settings
PUT  /api/settings
```

## V1 limitations (honest list)

- **Publishing is driven by the open page.** Each request commits a batch of files and returns; the page asks
  for the next batch. If the tab closes, the job is saved and resumable, but it does not continue in the
  background. A future version could use Cloudflare Queues or Durable Objects.
- **No background cron or websockets.** Progress is server truth at each request, not a live stream.
- **Rate limiting is approximate** because it uses KV (eventually consistent).
- **Secret detection is filename-based.** A secret pasted inside `config.json` will not be caught.
- **Commit message generation is deterministic**, not AI. No AI service is integrated, and the UI never
  claims otherwise.
- **Reordering uses buttons**, not drag-and-drop, to stay keyboard accessible.
- **Safari ITP can block the cross-site session cookie** when the frontend and API are on unrelated domains.
  Use a custom domain pair (`app.example.com` + `api.example.com`) for the most reliable session behaviour.
- **Uploads are limited** to 5 MB per file, 25 MB per job and 200 files per job (configurable server-side).

## License

MIT — see [LICENSE](LICENSE).

System developed by **PythosX**.
