# Deployment

Two independent deployments:

- **Frontend** — static files, deployed to Vercel
- **Backend** — Cloudflare Worker + three KV namespaces

Do the backend first so you know its URL when configuring the frontend.

---

## 1. Backend → Cloudflare Workers

### 1.1 Prerequisites

- A Cloudflare account (free plan is sufficient)
- Node.js 20+
- `npx wrangler login`

### 1.2 Create KV namespaces

From `backend/`:

```bash
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create JOBS
npx wrangler kv namespace create HISTORY
```

Each command prints an id. Paste them into `backend/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "…"

[[kv_namespaces]]
binding = "JOBS"
id = "…"

[[kv_namespaces]]
binding = "HISTORY"
id = "…"
```

> Prefer one namespace? Set only `KV = "<id>"`; `config/env.js` falls back to it for all three stores.

### 1.3 Secrets

```bash
cd backend
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

`SESSION_SECRET` and `ENCRYPTION_KEY` are long random strings (`openssl rand -base64 48`). Changing
`SESSION_SECRET` invalidates existing sessions (users simply sign in again).

### 1.4 Variables

Edit `[vars]` in `wrangler.toml` before deploying:

```toml
[vars]
FRONTEND_URL = "https://your-project.vercel.app"
GITHUB_CALLBACK_URL = "https://commitcraft-api.<subdomain>.workers.dev/api/auth/github/callback"
PUBLISH_BATCH_SIZE = "4"
MAX_JOB_BYTES = "26214400"
MAX_FILE_BYTES = "5242880"
MAX_FILES_PER_JOB = "200"
```

- `FRONTEND_URL` is the CORS allowlist and the post-login redirect target. For preview deployments add a
  comma-separated list (`https://app.vercel.app,https://app-*.vercel.app` is **not** supported — Vercel
  preview URLs change per deployment, so list exact origins or use `EXTRA_ORIGINS`).
- `GITHUB_CALLBACK_URL` must be registered on the OAuth app as well.

### 1.5 Deploy

```bash
npx wrangler deploy
```

Verify:

```bash
curl -s https://commitcraft-api.<subdomain>.workers.dev/api/health
# {"ok":true,"service":"commitcraft-api","version":"1.0.0","time":"..."}
```

### 1.6 Register the callback

In <https://github.com/settings/developers> → your OAuth app, set the Authorization callback URL to the
deployed `GITHUB_CALLBACK_URL`.

### 1.7 Cookie behaviour in production

`getConfig()` treats the deployment as production only when `ENVIRONMENT=production` is set. Set it:

```toml
[vars]
ENVIRONMENT = "production"
```

Then the session cookie is named `__Host-cc_session` with `Secure; HttpOnly; SameSite=None; Path=/`.
`SameSite=None` is required because the frontend and API are on different sites. Two consequences:

- **HTTPS is mandatory** (Workers and Vercel both provide it).
- Browsers that block third-party cookies (e.g. Safari with ITP) may not send the session cookie.

If you need guaranteed cross-browser sessions, put both on the same registrable domain:

| Host                          | Deployment                       |
| ----------------------------- | -------------------------------- |
| `app.yourdomain.com`          | Vercel frontend                   |
| `api.yourdomain.com`          | Worker custom domain (`routes`)   |

Then set `FRONTEND_URL=https://app.yourdomain.com` and keep `SameSite=None`. Same-site cookies are sent
reliably.

---

## 2. Frontend → Vercel

### 2.1 Point the frontend at the API

Each HTML page contains:

```html
<meta name="commitcraft-api" content="http://localhost:8787" />
```

Replace the value in **all** pages with your Worker origin (no trailing slash):

```html
<meta name="commitcraft-api" content="https://commitcraft-api.<subdomain>.workers.dev" />
```

You can override it at runtime without editing files by visiting any page with
`?api=https://your-worker.workers.dev` once; it is stored in localStorage. For a real deployment, edit the
meta tags — it is explicit and reviewable.

### 2.2 Deploy

**Option A — dashboard**

1. Import the repository in Vercel.
2. **Root Directory**: `frontend`
3. **Framework Preset**: Other
4. **Build Command**: *(empty)*
5. **Output Directory**: `.`  (the `frontend` folder is already static)
6. Deploy.

**Option B — Vercel CLI**

```bash
cd frontend
npx vercel --prod
```

When prompted, keep the framework as "Other" and leave the build command empty.

### 2.3 No rewrites needed

Every page is a real HTML file (`dashboard.html`, `upload.html`, …). There is no client-side router, so no
SPA fallback is required. If you add one later, add a rewrite for unknown paths only.

### 2.4 After the first deployment

1. Copy the production URL.
2. Set `FRONTEND_URL` in `wrangler.toml` to that origin and run `npx wrangler deploy` again.
3. Add the same origin to the OAuth app's Homepage URL.
4. Open the site, sign in, and publish one file to a test repository.

---

## 3. Post-deployment verification

Run through this list once, on the deployed origins:

1. `GET /api/health` returns `ok: true`.
2. Landing page loads with fonts and no console errors.
3. **Sign in** completes and lands on the dashboard with your avatar.
4. Dashboard shows your real repositories (not placeholders).
5. Choose a **test** repository and branch.
6. Upload a folder with a nested file; confirm paths are preserved and `node_modules`/`.env` are excluded.
7. Publish 3 files. Each row should reach **Completed** with a distinct SHA link.
8. Open the repository: three commits, each with the previous as parent.
9. Pre-existing files (e.g. README) are unchanged.
10. Publish again with one updated file: shown as **update**, committed on top.
11. Sign out, then hit `/api/github/repos` directly: expect `401 UNAUTHORIZED`.
12. In DevTools → Application, confirm no GitHub token in localStorage/sessionStorage/cookies (only the
    opaque session cookie, which is HttpOnly).

Anything that fails here is a deployment problem, not a code problem — check the Worker logs
(`npx wrangler tail`) and the browser network panel.

---

## 4. Costs

The V1 workflow fits free tiers:

- **Workers free plan**: 100k requests/day, but **50 subrequests per invocation** and 10 ms CPU. The
  default batch of 4 files costs ~28 GitHub subrequests per tick, which fits. Do not raise
  `PUBLISH_BATCH_SIZE` above ~5 on the free plan.
- **KV free plan**: 100k reads + 1k writes/day, 1 GB storage. Each file costs ~2 writes. Large folders may
  hit the daily write limit; the paid plan removes it.
- **Vercel Hobby**: more than enough for static files.
- **GitHub API**: 5,000 requests/hour per authenticated user. A 200-file job uses ~1,200 requests.

## 5. Updating

```bash
git pull
cd backend && npx wrangler deploy
cd ../frontend && npx vercel --prod
```

No migrations: KV is schema-less, and old job documents remain readable.

## 6. Rolling back

- **Worker**: Deployments → select the previous version → Rollback (or `npx wrangler rollback`).
- **Vercel**: Deployments → previous deployment → Promote to Production.
- **KV data**: never required for the app to boot. Sessions are recreated on sign-in.
