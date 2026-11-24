# Testing

## Automated tests (run these)

```bash
cd backend
npm install     # wrangler is the only dev dependency
npm test        # node --test test/
```

36 tests, no network access, ~1 second.

| Suite                        | What it proves                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `path-validation.test.js`    | Traversal, absolute paths, `.git`, secret filenames, duplicates, size limits    |
| `commit-engine.test.js`      | Blob → tree → commit → ref chaining, existing-file preservation, empty repo bootstrap, non-fast-forward rejection |
| `publishing-engine.test.js`  | 5 files → 5 chained commits, empty repo, add/update flags, crash adoption without duplication, branch conflict pause, rate-limit pause + retry, cancel + history record |
| `auth.test.js`               | Authorize URL/state, OAuth error handling, 401 without session, origin allowlist, CSRF rejection, session isolation, encrypted token at rest, expired session rejection |
| `github-api.test.js`         | Header shape, 401/403/404/422 mapping, rate-limit `retryAfter`, network failure, missing token |
| `api-publishing.test.js`     | Full HTTP flow: create job → body-less `start` → real fake commits → history → idempotent re-start; another user gets `404` for the job |

The fake GitHub server (`test/helpers/fake-github.js`) implements the Git Database endpoints in memory and
enforces fast-forward-only ref updates, so the engine is tested against real Git semantics rather than
mocks that always succeed.

### What is **not** covered by automated tests

- Real GitHub OAuth (requires a browser, an OAuth app and a real account)
- Real GitHub API responses (rate-limit headers, validation messages, protected branches)
- Browser behaviour: directory upload, drag & drop, IndexedDB persistence
- The visual interface

Those require the manual pass below. Be explicit about this when reporting test results.

---

## Manual end-to-end checklist

Use a **dedicated test repository**. Create one with a README so you can verify existing files are kept.

### Setup

1. Worker running: `cd backend && npx wrangler dev --port 8787`
2. Frontend served: `python3 -m http.server 3000 --directory frontend`
3. `backend/.dev.vars` contains the OAuth credentials.
4. OAuth app callback = `http://localhost:8787/api/auth/github/callback`.

### The 18 required scenarios

| #  | Scenario                            | Steps                                                                 | Expected |
| -- | ----------------------------------- | --------------------------------------------------------------------- | -------- |
| 1  | Successful GitHub login             | Click *Get started*, approve on GitHub                                | Redirect to `dashboard.html`, avatar visible, session cookie set |
| 2  | Failed login                        | Deny access on the GitHub consent screen                              | Redirect to landing with `?auth_error=access_denied`, toast shown, no session |
| 3  | Repository selection                | Open *Repositories*, search and pick a repo                           | Repo and branches load, branch dropdown populated |
| 4  | Repository creation                 | *New repository* → valid name → create                                | Repo appears in the list and is auto-selected; invalid names show inline errors |
| 5  | Branch selection                    | Pick a repo, change branch, continue                                  | Destination chip shows `repo · branch` on the upload page |
| 6  | Upload nested folder                | Drop a folder containing `src/app.js` and `assets/logo.svg`           | Tree shows the hierarchy; paths are not flattened |
| 7  | Exclude `.env` and `node_modules`   | Include both in the uploaded folder                                   | Both appear under *Excluded & ignored* with reasons; `.env` cannot be restored |
| 8  | Publish 5 files as 5 commits        | Select 5 files, write messages, publish                               | Plan shows 5 commits; 5 rows complete with 5 distinct SHAs |
| 9  | Each commit parents the previous    | `git log --format='%H %P %s'` in a clone                              | Every new commit's parent is the previous commit, ending at the old head |
| 10 | All files exist in the repo         | Open the repository on GitHub                                         | All 5 files present at their exact paths |
| 11 | Existing repo files unchanged       | Compare README before/after                                           | README still present and byte-identical |
| 12 | Update an existing file             | Re-upload with a changed `index.html`                                 | Row is marked **update**; a new commit changes only that file |
| 13 | Retry a failed commit               | Rate-limit by running a large job, or revoke the token mid-run, then restore and retry | Job pauses with a reason; *Retry failed files* completes without duplicating successful commits |
| 14 | Resume an interrupted job           | Start a 10-file job, close the tab after 2 commits, reopen `publishing.html?job=<id>` | Job shows 2 completed; *Resume* continues from file 3 |
| 15 | Handle API rate limits              | Exhaust GitHub's limit (or set `PUBLISH_BATCH_SIZE` high and publish many files) | Job pauses with "GitHub rate limit reached", no crash, resumable |
| 16 | Handle branch conflicts             | Pause a job, push a commit to the branch from elsewhere, then resume  | Job pauses with a branch-conflict warning; remote commit is not overwritten |
| 17 | Logout and session termination      | *Sign out*                                                            | Redirect to landing; `GET /api/github/repos` returns 401 with the old cookie |
| 18 | No tokens in frontend storage       | DevTools → Application → Local/Session Storage, IndexedDB, Cookies    | No GitHub token anywhere; only the HttpOnly session cookie and UI preferences |

### Extra checks worth doing once

- Publish into an **empty** repository (create without README): first commit must have no parent, and the
  branch must be created.
- Publish a file with a 3-level path (`a/b/c.txt`) and confirm intermediate trees exist.
- Cancel a job mid-run: committed files remain, remaining files show **Skipped**.
- Open *History*, click **Details** on a job, and follow a SHA link.
- Clear history in *Settings* and confirm the history page empties (commits on GitHub remain).
- Toggle the theme and reload: the choice persists and there is no flash of the wrong theme.
- Resize to 380px wide: navigation becomes a drawer, tables become cards, nothing overflows horizontally.
- Enable "reduce motion" in the OS: reveals and transitions become instant.

### Recording results

For each scenario note: pass/fail, browser, and the job id. If a GitHub-side scenario cannot be run
(no OAuth app, no test repository, rate limits), report it as **not run** — never as passed.
