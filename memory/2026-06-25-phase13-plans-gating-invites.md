# 2026-06-25 — Phase 13: Plans, gating & invite codes (D11)

Free level-check for everyone, then a required plan; mocked checkout + admin-minted
token-credit invite codes; per-call entitlement. Satisfies R18. Builds on Phase 8
metering and Phase 12 identity ([[2026-06-25-phase12-identity-resumable]]).

## Model
- `users.plan` ∈ **free-intro** (default) / **host** (paid) / **byok** (free) / **local**
  (the implicit local owner). New `invite_codes` table (token_credit, note, revoked,
  redeemed_by/at, expires_at). Migration `0002_last_banshee.sql`.
- **Credit is token-denominated (Q3):** `token_quota` is the allowance, `tokens_used`
  (from `usage_events`) decrements it. `credit_left = max(0, quota − used)`.

## Gating (hosted only — local mode is always unrestricted, so the local owner + e2e are unchanged)
- `resolveCall` gained a **free-intro fallback**: a free-intro user with no key/model
  runs on the admin **default model** (`db.defaultModel()`), flagged `freeIntro`.
- `enforceEntitlement(user, call, kind)` (replaces `enforceQuota`, called once in
  `requireCall(c, kind)`):
  - BYOK/CLI (`call.modelId === null`) → free, never blocked.
  - `freeIntro` → **calibration only**, under `FREE_INTRO_TOKEN_BUDGET` (30k); interviews 402.
  - paid host model → needs remaining credit (`tokens_used < token_quota`), else 402.
- Calibration routes pass `kind:'calibration'`; interview routes `kind:'interview'`.

## Endpoints
- User: `POST /api/plan/checkout {tokens}` (mock pay, packs 100k/500k/1M → grant + host),
  `POST /api/plan/redeem {code}` (single-use/not-expired/not-revoked → grant + host).
  `GET /api/usage` now returns `plan`, `credit_left`, `free_intro_budget`.
- Admin: `GET/POST /api/admin/invites`, `POST /api/admin/invites/:code/revoke`.
- `/config` save → sets `byok` (hosted); `/models/select` → sets `host` (hosted).
- `/health` now returns `plan` + `has_model` (drives the web onboarding gate).

## Web flow change (hosted)
- Onboarding reordered: the old "`!configured` → Setup" gate is **local-mode only** now.
  Hosted: Profile → Calibration (free, no key) → **Plan** (if `!configured && !has_model`)
  → Dashboard. `App.refresh` keys off `health.has_model`/`configured`.
- New `Plan.tsx` (topbar 💳): plan + credit summary, mock-pay packs, invite redeem, then
  pick a host model; BYO-key routes to Setup. `Admin.tsx` got an invite-codes section.

## Gotchas
- After redeem/checkout a user is `host` with credit **but no model selected** →
  `resolveCall` returns 409 ("Not configured"); the Plan page then shows the model picker.
  The web gate (`!has_model`) keeps them on Plan until they pick. Verified the 409 path.
- A mid-session working-tree **revert to the last commit wiped schema.ts/db.ts/migration**
  while routes.ts edits had persisted → typecheck caught the missing db symbols; re-applied
  schema.ts + db.ts and regenerated the migration (now `0002_last_banshee`, not the earlier
  throwaway `0002_next_sumo`). Lesson: after instability, re-verify each file via Read/typecheck.
- `grep` via the `rtk` proxy mangles output — use the Read/Grep tools for ground truth.

## Verified
- `make check` green (migration 0002 applies on boot against the existing local DB).
- `make e2e` green (local happy path unchanged — local mode bypasses gating).
- **Hosted gating end-to-end** via `scripts/verify-ph13.mjs` (boot hosted on a throwaway DB):
  admin default model + mint invite → user free-intro calibration OK → interview 402 →
  redeem (1M, single-use re-redeem 400) → host-without-model 409 → select model →
  interview 200 → usage shows host plan + decremented credit. All assertions pass.

## Next
- **Phase 14 — Admin-managed versioned prompts + guardrails (D12, D13):** prompts move
  from `server/src/prompts.ts` into a DB table with versions + rollback; a fixed
  guardrail frame wraps every interview prompt (prompt-injection resistance); red-team CI.
