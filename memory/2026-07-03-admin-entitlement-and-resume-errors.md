# Admin is staff (un-metered) + résumé onboarding surfaces errors

Fixed 2026-07-03 from a bug report (hosted mode): "admin résumé doesn't work but MUST work
because I'm admin" + "no-credit user starting from a résumé sees no error."

## Root causes

1. **Admin was treated as an ordinary unpaid `free-intro` user.** Nothing in `enforceEntitlement`
   or `/health.interview_ready` exempted staff, so an admin hit the same first-impression / credit
   paywall and showed `interview_ready:false`. An admin is the deploy owner / a `SENIORBRO_ADMIN_EMAILS`
   address — they run the platform and should never be metered.
2. **Résumé extraction errors rendered only in the form card below**, not at the résumé card where
   the button is — so a failed extract (out of free tier, no plan, model error) looked silent.
3. **Data (not code):** the owner's default Arvan model had a wrong/stale key → every model call
   500'd (`Arvan API error 401`). Fixing the key made résumé work. (Later in the session the network
   from this machine to arvancloudai.ir / 185.143.233.235 became unreachable entirely — curl + node
   both time out — an environment/routing issue, not the app.)

## Fixes (server/src/routes.ts, web/src/pages/ProfileSetup.tsx)

- `enforceEntitlement`: `if (user.role === 'admin') return` right after the `!isHosted` guard —
  admins run every feature un-metered.
- `/health`: for `role === 'admin'`, `interview_ready = hasModel || configured || a default model exists`.
- ProfileSetup: the résumé card now renders `{error && …}` inline, so extraction failures show at
  the action.

Locked by `scripts/verify-admin-entitlement.mjs` (admin is ready + can résumé/interview un-metered;
a normal free-intro user's 4th résumé is a **402 with a clear, surfaceable message**). Verified live
in-browser (admin résumé prefilled the form; a maxed-out user saw the block message in the résumé card).

## Demo model setup (Arvan)

Adding a model validates the key against the live provider — so it fails when Arvan is unreachable.
Rather than commit gateway URLs + the account key, there's now a re-runnable seeder:
`scripts/seed-demo-models.mjs` reads an untracked `.demo-models.json` (gitignored) and adds the
models + wires `voice.transcribe` in one command against a running hosted server:
`SB_ADMIN_EMAIL=you@… node scripts/seed-demo-models.mjs`. The real Arvan configs (Haiku default brain,
GLM 5.2, GPT-4o-Transcribe voice) are in the owner's local `.demo-models.json` — run once Arvan is
reachable from the shell (needs the right network/VPN route to the ir host).

`make check` + `make e2e` green.
