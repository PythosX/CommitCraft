# Security

CommitCraft performs privileged operations (writing commits) on a user's repositories. This document states
what is protected, how, and what remains out of scope.

## Assets

| Asset                       | Where it lives                            | Protection                                  |
| --------------------------- | ----------------------------------------- | ------------------------------------------- |
| GitHub access token         | Cloudflare KV, encrypted                  | AES-GCM, PBKDF2-derived key, never sent to JS |
| Session id                  | HttpOnly cookie                           | `__Host-`, `Secure`, `SameSite=None` in prod |
| CSRF token                  | In the session record + returned to same-origin JS | Synchronizer token, required on mutations |
| Uploaded file contents      | KV, per-file keys                          | TTL 7 days, deleted as each commit succeeds  |
| Publishing history          | KV                                        | Owner-scoped, user-deletable                 |

## Authentication

- OAuth web flow with `state` generated with `crypto.getRandomValues` (192 bits).
- State is validated against **both** a KV entry (single-use, 10 minute TTL) and an HttpOnly cookie, using a
  constant-time comparison.
- The authorization code is exchanged server-side; the client secret never leaves the Worker.
- Session ids are 256-bit random hex strings, not derived from anything guessable.
- Sessions expire after 14 days (`SESSION_TTL_SECONDS`), are deleted on logout, and are rejected and purged
  when expired on read.

## Token handling

- Encrypted with AES-GCM; the key is derived via PBKDF2-SHA256 (60k iterations) from `SESSION_SECRET` with a
  random per-session salt. A fresh 96-bit IV is generated per encryption.
- Decrypted only inside the Worker immediately before a GitHub request.
- Never logged: the logger redacts any field whose key matches `token|secret|password|authorization|cookie|content|code`.
- Never returned by any endpoint. `GET /api/auth/session` returns the profile, CSRF token, scopes and
  expiry — not the token.
- The frontend stores **no** tokens in localStorage, sessionStorage, IndexedDB or cookies. IndexedDB holds
  only the user's own file contents between screens.

## CSRF and origin policy

- Every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) requires `x-csrf-token` equal to the value stored
  in the session. Because the session response is only readable by the allowlisted frontend origin, a
  cross-site attacker cannot obtain it.
- When a browser sends `Origin`, it must be in `allowedOrigins` (`FRONTEND_URL` + `EXTRA_ORIGINS`).
- Non-browser clients without `Origin` still need the CSRF token, which requires a valid session cookie.
- CORS responses only carry `Access-Control-Allow-Origin` for allowlisted origins, with credentials.
- The OAuth callback and health endpoints are exempt from CSRF (they are top-level navigations / GETs).

## Authorization

- Every authenticated route loads the session from the cookie; no user id is ever accepted from the client.
- Jobs carry `userId`; reading or advancing a job owned by another user returns `404 JOB_NOT_FOUND`
  (indistinguishable from a missing job).
- Settings are keyed by the session's user id.
- Repository access is GitHub's decision: the Worker acts with the user's own token, so it can only touch
  what that account can already push to. `permissions.push === false` is rejected before a job is created.

## Input validation

- **Paths**: string, ≤ 400 chars, no leading `/`, no drive letters, no backslashes, no NUL, no empty or `.`
  segments, no `..`, no `.git`/`.hg`/`.svn` segments, ≤ 20 levels, segment charset restricted, plus a
  secret-filename denylist. Validated **server-side** in `utils/path-validator.js`; the browser has a
  parallel, non-authoritative copy.
- **Repository names / owners / branches**: regex-validated against Git's rules, including `..`, `@{`,
  trailing `.lock`, whitespace and control characters.
- **Commit messages**: 1–500 characters, CRLF normalised, blank-line runs collapsed.
- **Files**: ≤ 200 per job, ≤ 5 MB each, ≤ 25 MB per job; base64 must be valid and the decoded size is
  recomputed server-side (the client `size` field is ignored for limits).
- **Duplicate paths** are rejected.
- **Secret files** (`.env*` except templates, `id_rsa`, `*.pem`, `*.p12`, `secrets.*`, `credentials*`,
  `serviceaccount*.json`) are rejected by the API and blocked in the UI.
- JSON bodies are rejected unless `content-type: application/json`, with a hard length cap checked before
  parsing.

## Publishing safety

- New trees are built with `base_tree`, so existing paths are inherited rather than replaced.
- Branch updates use `PATCH /git/refs/heads/...` with `force: false` — GitHub rejects non-fast-forward
  updates; CommitCraft pauses instead of overwriting.
- The expected parent of each commit is the recorded head sha. A mismatch pauses the job.
- Recovery only adopts a remote commit if the commit's parent matches the recorded head **and** the file's
  blob sha matches the locally computed sha. Anything else is a conflict.
- No branch deletion, no repository deletion, no force-push, no history rewriting anywhere in the codebase.
- Cancelling a job never deletes commits that already succeeded.

## Rate limiting and abuse

- Fixed-window counters in KV: reads 120/min, writes 30/min, publish ticks 120/min, auth 20/min — keyed by
  user id when authenticated, otherwise by `CF-Connecting-IP`.
- Limits are approximate (KV is eventually consistent) and deliberately fail-open if KV errors: an outage
  must not take the API down.
- Job/file size caps bound the work a single request can cause.
- GitHub's own rate limits surface as `429 RATE_LIMITED` with the job paused, not as a retry storm.

## Response headers

- `cache-control: no-store` on all API responses (personalized data).
- `x-content-type-options: nosniff`, `referrer-policy: no-referrer` on JSON.
- `vary: origin` on CORS responses.
- No HTML is served by the Worker, so API responses cannot be used for script injection.

## Frontend rendering safety

- All dynamic strings are inserted with `textContent` or an `escapeHtml()` helper before being placed in
  `innerHTML`. File paths and commit messages are treated as untrusted.
- Uploaded HTML/JS is shown as escaped text in a `<pre>`; it is never injected into the DOM or executed.
- GitHub avatars are loaded with `referrerpolicy="no-referrer"` and are plain `<img>` sources.
- External links use `rel="noopener noreferrer"`.

## Known limitations / residual risk

1. **KV is eventually consistent.** Rate limits can briefly under-count; sessions written in one colo are
   visible elsewhere within a second. Not suitable for hard financial guarantees.
2. **Secret detection is filename-based.** A token pasted into `src/config.js` is not detected.
3. **The OAuth `repo` scope is broad.** It is GitHub's granularity, not CommitCraft's choice. Use
   `public_repo` if you only publish public projects.
4. **Cross-site cookies.** With `SameSite=None`, Safari/ITP may refuse to send the session cookie when the
   API is on an unrelated domain. Use a shared registrable domain for production.
5. **No per-repository allowlist.** Any repository the token can push to can be selected; the user must
   choose deliberately.
6. **Publishing is client-driven.** A malicious client can call `/start` repeatedly, but each call is
   rate-limited and makes the same commits it would anyway.
7. **No virus scanning.** Files are published verbatim, exactly as Git would.

## Reporting

This is a V1 reference implementation. If you deploy it, review the code yourself, keep dependencies
(only `wrangler`, a dev dependency) updated, rotate secrets, and use a dedicated test repository when
evaluating behavior.
