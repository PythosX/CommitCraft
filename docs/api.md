# API reference

Base URL: the Worker origin, e.g. `https://commitcraft-api.<subdomain>.workers.dev`.

All responses are JSON (`content-type: application/json`) with `cache-control: no-store`.
Authentication is a session cookie (`cc_session`, or `__Host-cc_session` in production). Every mutating
request requires the `x-csrf-token` header with the token from `GET /api/auth/session`.

Errors always look like:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Select at least one file to publish",
    "details": { "field": "files" }
  }
}
```

Common codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `CSRF_MISMATCH`, `ORIGIN_NOT_ALLOWED`,
`NOT_FOUND`, `JOB_NOT_FOUND`, `RATE_LIMITED`, `SESSION_EXPIRED`, `GITHUB_*`, `PAYLOAD_TOO_LARGE`,
`INTERNAL_ERROR`.

---

## Health

### `GET /api/health`

```json
{ "ok": true, "service": "commitcraft-api", "version": "1.0.0", "time": "2026-01-01T00:00:00.000Z" }
```

---

## Authentication

### `GET /api/auth/github`

302 to `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `scope=repo read:user`,
`state`. Sets a short-lived HttpOnly state cookie.

### `GET /api/auth/github/callback?code&state`

Validates state, exchanges the code, creates the session, sets the session cookie and redirects to
`{FRONTEND_URL}/dashboard.html?connected=1`. On failure redirects to
`{FRONTEND_URL}/index.html?auth_error=state_mismatch|exchange_failed|github_error|access_denied`.

### `GET /api/auth/session`

```json
{
  "authenticated": true,
  "user": { "id": 1, "login": "octocat", "name": "Octo Cat", "avatarUrl": "...", "htmlUrl": "..." },
  "csrfToken": "…",
  "scopes": "repo, read:user",
  "expiresAt": "2026-01-15T00:00:00.000Z",
  "secureCookies": true
}
```

When signed out: `{ "authenticated": false }` (200).

### `POST /api/auth/logout`

Requires CSRF. Deletes the session and clears the cookie. `204 No Content`.

---

## GitHub data

All routes below require a session. The Worker proxies with the user's token.

### `GET /api/github/repos?page=1&per_page=50&sort=updated`

Repositories the user can push to (`affiliation=owner,collaborator,organization_member`).

```json
{
  "repositories": [
    {
      "id": 1,
      "name": "portfolio",
      "fullName": "octocat/portfolio",
      "owner": "octocat",
      "private": false,
      "defaultBranch": "main",
      "description": "",
      "updatedAt": "2026-01-01T00:00:00Z",
      "htmlUrl": "https://github.com/octocat/portfolio",
      "permissions": { "push": true, "admin": true }
    }
  ],
  "hasMore": false,
  "page": 1
}
```

### `POST /api/github/repos`

```json
{ "name": "my-portfolio", "description": "Optional", "private": false, "autoInit": true }
```

`201` with `{ "repository": { … } }`. `422 REPO_NAME_TAKEN` when GitHub rejects the name.

### `GET /api/github/repository?owner=octocat&repo=portfolio`

Returns repository metadata plus `branches: [{ name, sha, protected }]`.

### `GET /api/github/branches?owner=octocat&repo=portfolio`

```json
{ "branches": [{ "name": "main", "sha": "…", "protected": false }], "defaultBranch": "main", "empty": false }
```

---

## Publishing

### `POST /api/publish/jobs`

Creates a draft job. No commits are made yet: this validates the destination and stores the file contents.

```json
{
  "owner": "octocat",
  "repo": "portfolio",
  "branch": "main",
  "files": [
    {
      "path": "index.html",
      "message": "Add index.html",
      "content": "PGgxPkhlbGxvPC9oMT4="
    }
  ]
}
```

- `content` is standard base64 of the raw bytes.
- `path` is repository-relative and validated (no `..`, absolute paths, `.git/`, secrets).
- Limits: 200 files, 5 MB/file, 25 MB/job (configurable).

`201 Created`:

```json
{
  "job": {
    "id": "job_ab12cd34ef",
    "status": "queued",
    "owner": "octocat",
    "repo": "portfolio",
    "repoFullName": "octocat/portfolio",
    "repoUrl": "https://github.com/octocat/portfolio",
    "branch": "main",
    "branchUrl": "https://github.com/octocat/portfolio/tree/main",
    "mode": "existing",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "startedAt": null,
    "finishedAt": null,
    "error": null,
    "blockedReason": null,
    "stats": { "total": 1, "completed": 0, "failed": 0, "skipped": 0, "pending": 1, "added": 0, "updated": 0, "commits": 0, "percent": 0 },
    "files": [
      {
        "index": 0,
        "path": "index.html",
        "message": "Add index.html",
        "size": 14,
        "status": "waiting",
        "existed": false,
        "commitSha": null,
        "commitUrl": null,
        "error": null,
        "attempts": 0,
        "updated": false
      }
    ]
  },
  "settings": { "batchSize": 4 }
}
```

`mode` is `existing` (commits on top of the branch) or `empty` (first commit creates the branch).

### `GET /api/publish/jobs/:jobId`

Returns `{ "job": { … } }`. A job owned by another user returns `404 JOB_NOT_FOUND`.

### `POST /api/publish/jobs/:jobId/start`

Commits up to `batchSize` waiting files and returns:

```json
{ "job": { … }, "done": false, "progressed": 4, "conflict": null, "stats": { … } }
```

Call it again until `done` is `true` or `job.status` becomes `paused`. Idempotent for terminal jobs.

Possible pauses:

| `job.blockedReason`   | Meaning                                                     |
| --------------------- | ----------------------------------------------------------- |
| `conflict`            | The branch head moved; nothing was overwritten              |
| `branch-missing`      | The target branch no longer exists                          |
| `auth-or-rate-limit`  | Token invalid or GitHub rate limit reached                   |
| `error`               | Other GitHub/network failure                                 |

### `POST /api/publish/jobs/:jobId/resume`

Re-verifies the remote head (adopting an unrecorded commit if it is ours) and continues. Use after a pause.

### `POST /api/publish/jobs/:jobId/retry`

Sets failed files back to `waiting` and commits another batch. Successful commits are never repeated.

### `POST /api/publish/jobs/:jobId/cancel`

Marks remaining files `skipped` and the job `cancelled`. Already-created commits stay on GitHub.
`{ "job": { … }, "done": true }`.

---

## History

### `GET /api/publish/history`

```json
{
  "history": [
    {
      "id": "job_ab12cd34ef",
      "owner": "octocat",
      "repo": "portfolio",
      "repoFullName": "octocat/portfolio",
      "repoUrl": "https://github.com/octocat/portfolio",
      "branch": "main",
      "status": "completed",
      "filesTotal": 5,
      "filesPublished": 5,
      "filesFailed": 0,
      "commitsCreated": 5,
      "startedAt": "…",
      "finishedAt": "…",
      "durationMs": 8421,
      "commits": [{ "path": "index.html", "message": "Add index.html", "sha": "…" }]
    }
  ],
  "recentJobs": [ … ],
  "totals": { "commits": 5, "files": 5, "jobs": 1 }
}
```

### `DELETE /api/publish/history`

Clears recorded history for the session's user. `{ "ok": true }`.

---

## Settings

### `GET /api/settings`

```json
{
  "settings": {
    "theme": "system",
    "defaultTemplate": "add",
    "publishMode": "standard",
    "ignorePatterns": [],
    "defaultFileFilters": ["node_modules", ".git", "dist", "build", ".env"]
  },
  "account": { "login": "octocat", "name": "Octo Cat", "avatarUrl": "…", "htmlUrl": "…", "scopes": "repo, read:user" },
  "session": { "createdAt": "…", "expiresAt": "…" }
}
```

### `PUT /api/settings`

Any subset of `{ theme, defaultTemplate, publishMode, ignorePatterns, defaultFileFilters }`.
Validation: `theme` ∈ `dark|light|system`, `defaultTemplate` ∈ `add|create|update|folder`,
`publishMode` ∈ `standard|careful`, pattern arrays ≤ 50 entries of ≤ 120 characters.

---

## Rate limits

| Bucket  | Limit          | Applies to                          |
| ------- | -------------- | ----------------------------------- |
| read    | 120 / minute   | GET routes and job reads            |
| write   | 30 / minute    | job creation, settings, history deletion |
| publish | 120 / minute   | start / resume / retry / cancel     |
| auth    | 20 / minute    | OAuth start                         |

Exceeding a limit returns `429 RATE_LIMITED` with a `retry-after` header.

## Example: publishing with curl

```bash
API=https://commitcraft-api.example.workers.dev

# 1. Session (you must complete OAuth in a browser first; reuse its cookie)
curl -s -c cookies.txt "$API/api/auth/session" | jq
CSRF=$(curl -s -b cookies.txt "$API/api/auth/session" | jq -r .csrfToken)

# 2. Create the job
JOB=$(curl -s -b cookies.txt -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"owner":"octocat","repo":"test","branch":"main","files":[
        {"path":"hello.txt","message":"Add hello.txt","content":"aGVsbG8="}]}' \
  "$API/api/publish/jobs" | jq -r .job.id)

# 3. Advance until done
for i in $(seq 1 10); do
  RESULT=$(curl -s -b cookies.txt -H "x-csrf-token: $CSRF" -X POST "$API/api/publish/jobs/$JOB/start")
  echo "$RESULT" | jq '.done, .job.status'
  [ "$(echo "$RESULT" | jq -r .done)" = "true" ] && break
done
```
