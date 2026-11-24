# GitHub OAuth setup

CommitCraft uses a **GitHub OAuth App** (not a GitHub App). The web application flow is enough for V1 and
keeps the permission model simple.

## 1. Create the OAuth app

1. Open <https://github.com/settings/developers>.
2. Select **OAuth Apps → New OAuth App**.
3. Fill in:

| Field                        | Local development                        | Production                                        |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Application name             | CommitCraft (local)                      | CommitCraft                                        |
| Homepage URL                 | `http://localhost:3000`                  | `https://your-frontend.vercel.app`                 |
| Authorization callback URL   | `http://localhost:8787/api/auth/github/callback` | `https://<worker>.workers.dev/api/auth/github/callback` |

The callback URL must match `GITHUB_CALLBACK_URL` **exactly**, including scheme, host, port and path.
GitHub rejects the exchange otherwise ("redirect_uri_mismatch"), and CommitCraft will send you back to the
landing page with `?auth_error=exchange_failed`.

4. Copy **Client ID** and generate a **Client secret**.

## 2. Provide the credentials

### Local

Create `backend/.dev.vars` (gitignored):

```ini
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SESSION_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -base64 48>
```

`wrangler dev` loads this file automatically. `.dev.vars` must never be committed — `.gitignore` already
excludes it.

### Production

```bash
cd backend
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

Secrets are write-only: `wrangler secret list` shows names, never values.

Then set the non-secret variables in `wrangler.toml`:

```toml
[vars]
FRONTEND_URL = "https://your-frontend.vercel.app"
GITHUB_CALLBACK_URL = "https://<worker>.workers.dev/api/auth/github/callback"
PUBLISH_BATCH_SIZE = "4"
```

Redeploy after changing `[vars]`: `npx wrangler deploy`.

## 3. Scopes

The authorization request asks for:

| Scope      | Why                                                          |
| ---------- | ------------------------------------------------------------ |
| `repo`     | Read and write repository contents, including private repos  |
| `read:user`| Read your public profile (login, name, avatar) for the UI     |

`repo` is broad by GitHub's design: it grants read/write access to all repositories the account can push
to. There is no narrower classic OAuth scope for writing commits to private repositories. CommitCraft only
writes to the repository you explicitly select, but the token itself is broader — treat it accordingly.

If you only publish to **public** repositories, change `OAUTH_SCOPE` in
`backend/src/services/oauth-service.js` to `public_repo read:user`. This is a code change, not a setting,
so it is visible in review.

## 4. Test the flow

1. Start the Worker (`npx wrangler dev --port 8787`) and the frontend (`http://localhost:3000`).
2. Open `http://localhost:3000` and click **Get started**.
3. GitHub shows the consent screen. Approve.
4. You should land on `dashboard.html?connected=1` with your avatar in the top bar.

Check the Worker logs. A successful callback logs no token; a failure logs a redacted event and redirects
with `?auth_error=...`.

### Troubleshooting

| Symptom                                  | Cause / fix                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `?auth_error=state_mismatch`             | State cookie or KV entry missing — cookies blocked, or the state expired (10 min). |
| `?auth_error=exchange_failed`            | Callback URL mismatch, wrong client secret, or the code was already used.    |
| `?auth_error=github_error`               | You denied the authorization, or GitHub returned an error.                   |
| Redirected back to the landing page      | API unreachable — check the `commitcraft-api` meta tag and Worker logs.      |
| `401 SESSION_EXPIRED` after some time     | Token revoked in GitHub settings, or the 14-day session expired. Sign in again. |
| Repositories list is empty               | The token lacks `repo`, or the account only has access to organization repos that require SSO. |

If your organization enforces SAML SSO, authorize the OAuth app for that organization in
**Settings → Applications → Authorized OAuth Apps → CommitCraft → SSO**.

## 5. Rotating credentials

1. Generate a new client secret in the OAuth app.
2. `npx wrangler secret put GITHUB_CLIENT_SECRET`.
3. Delete sessions if you also rotate `SESSION_SECRET` (existing sessions become undecryptable and users are
   asked to sign in again — this is expected).

Never place the client secret in the frontend, in `wrangler.toml`, or in a commit.
