# 2026-06-24 — Phase 3: accounts & hosted mode

The prerequisite gate for deploying to a host (95.38.235.93) and the foundation
layer of the R13 hosted-admin bundle. The app was 100% single-user before this
(`latestProfile()` everywhere, one global `config.json`).

## Mode switch
- `server/src/mode.ts`: `SENIORBRO_MODE=local|hosted` (default `local`).
  - **local** = exactly the old behavior. One implicit owner (`LOCAL_USER_ID = 1`,
    seeded as role `admin`), no auth, no login screen. CLI subscription providers stay.
  - **hosted** = multi-user: magic-link sessions, per-user isolation, CLI providers rejected.

## Accounts (hosted)
- Tables added in `db.ts`: `users`, `sessions`, `magic_links`. Passwordless:
  `POST /auth/request {email}` → mints a 20-min magic link; `POST /auth/verify {token}`
  → upserts the user, opens a 30-day session, sets `sb_session` httpOnly cookie.
  `POST /auth/logout`, `GET /auth/me`.
- `server/src/auth.ts`: `requireUser(c)` (local → owner; hosted → session or 401),
  `currentUser(c)` (never throws), `startSession`/`endSession`. Uses `hono/cookie`.
- `server/src/mailer.ts`: **no SMTP dependency**. Link is logged + optionally POSTed to
  `SENIORBRO_MAGICLINK_WEBHOOK`. In non-prod (`NODE_ENV !== 'production'`) the link is
  returned in the `/auth/request` response so dev/staging can sign in with no mailbox.
  The web `Login.tsx` surfaces it as a one-click "Sign in now (dev)" button.

## Per-user isolation
- `user_id` added to `profiles` via an **additive idempotent migration** (`migrate()` in
  db.ts: PRAGMA-checks the column, ALTERs if missing, back-fills NULLs → local owner).
  Child tables (calibrations/interviews/weaknesses) inherit ownership via their profile.
- Every route resolves the user, then guards by-id access with `ownProfile` /
  `ownInterview` (404 on cross-user). `latestProfile(userId)`, `listInterviewsForUser(userId)`.

## Per-user provider config, encrypted at rest
- Config moved off `config.json` into the `users` row (`provider`/`model`/`api_key_enc`).
  `getUserConfig`/`setUserConfig` in db.ts. Legacy `~/.senior-bro/config.json` is
  **auto-imported into the local owner once** on first boot (migrate()).
- `server/src/crypto.ts`: AES-256-GCM via stdlib `node:crypto` (no dep). Master key from
  `SENIORBRO_SECRET` (required in prod) or a persisted `~/.senior-bro/secret.key` (0600)
  for zero-config local. `encryptSecret`/`decryptSecret`/`randomToken`.
- Hosted `/config` rejects `claude-cli`/`codex-cli` (D8: can't proxy a customer's CLI login).

## Frontend
- `web/src/pages/Login.tsx` (hosted only). `App.tsx` reads `/health` (now returns
  `{mode, authed, user, configured}`); hosted+unauthed → Login; magic `?magic=token` in the
  URL is auto-verified on load then stripped. Topbar shows a sign-out pill in hosted mode.
- `api.ts` requests now send `credentials: 'same-origin'`.

## Verified
- `make check` + `make e2e` green (e2e runs local mode + mock; migration imports the
  setup's config.json so it still finds the mock provider with no auth).
- Hosted curl smoke: unauth `/profile` → 401; request→verify sets cookie; authed health
  shows the user; CLI provider rejected; new user's profile gets a distinct `user_id`
  (isolation). See the session transcript.

## Still open / next
- Host-key pool for subscribers was deferred — it belongs with admin key management
  (Phase 9) + metering (Phase 8), i.e. the rest of the R13 bundle.
- A real mailbox/webhook for magic links is deploy-time config, not code.
- See [[2026-06-24-subscription-auth-and-continuity]] — the CLI subscription providers
  still need a real-machine smoke test (owner reported `claude` CLI mode not working).
