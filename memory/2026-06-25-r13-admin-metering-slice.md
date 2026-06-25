# 2026-06-25 — R13 hosted-admin vertical slice (Phase 9 admin + Phase 8 metering)

The owner-queued R13 bundle, built as one slice on top of Phase 3 accounts:
**admin registers a model+key → user picks from enabled models → each call is
metered & quota-checked.** Backend curl-verified + admin UI verified in the
hosted preview. See [[2026-06-24-phase3-accounts-hosted]] for the accounts layer.

## Data model (db.ts)
- `models` — admin catalog: label, provider, model, `api_key_enc` (encrypted host key),
  enabled, is_default, `price_in`/`price_out` (USD per 1M tokens). CRUD + `modelConfig(id)`
  decrypts the key into an AppConfig.
- `usage_events` — per-call ledger: user_id, model_id, provider, model, input/output tokens,
  cost_usd. `recordUsage`, `tokensUsed(userId)`, `usageSummary(userId)`.
- `users` gained `model_id` (chosen catalog model → host key path) and `token_quota`
  (nullable = unlimited), via additive migration. Selecting a curated model clears the
  user's BYOK key and vice-versa (mutually exclusive).

## Metering & quota (routes.ts)
- `resolveCall(user)` → either the catalog model (host key, priced, metered, quota-enforced)
  or the user's BYOK config (recorded at $0, never blocked).
- `runModel(user, call, …)` wraps every model call: `enforceQuota` (402 when
  `tokensUsed >= token_quota`, host-key calls only) → `chat()` → `recordUsage` (cost from price).
  All 5 call sites (calibration ×2, interview opener/message/finish) go through it.
- `providers.chat()` now returns `{ text, usage: {inputTokens, outputTokens} }`.
  Anthropic uses `final.usage`; OpenAI uses `usage` (+ `stream_options.include_usage` when
  streaming); CLI/mock estimate ~4 chars/token (subscriptions don't report counts).

## Admin (admin.ts + routes)
- `requireAdmin(c)`: local owner is admin; hosted admins listed in `SENIORBRO_ADMIN_EMAILS`
  (comma list) are promoted on magic-link verify. 403 otherwise.
- `/api/admin/models` GET/POST/PATCH/DELETE (POST validates the key via `validateKey`
  before saving; mock needs none). `/api/admin/users` (+ per-user usage), `/api/admin/users/:id/quota`.
- User-facing: `GET /api/models` (enabled only, no keys), `POST /api/models/select`,
  `GET /api/usage`.

## Frontend
- `web/src/pages/Admin.tsx` (topbar 🛠️ admin pill, role=admin only): models table +
  add-model form + users/usage table with inline "set quota".
- `Setup.tsx` (hosted): "Use a provided model" cards from `/api/models`; CLI providers
  hidden in hosted mode; BYOK key copy is mode-aware.
- `App.tsx` tracks `account.role`; `api.ts` has the catalog/usage/admin client methods.

## Verified
- `make check` + `make e2e` green.
- Hosted curl: admin promoted via `SENIORBRO_ADMIN_EMAILS`; admin creates a mock model;
  user sees & selects it; calibration call metered (155 in + 78 out, cost = 155/1e6·3 +
  78/1e6·15 = $0.001635); admin users console shows per-user totals; quota=50 → first call
  200, second 402.
- Preview (hosted, port 4755, isolated HOME): Admin page + Setup model-picker render with
  no console errors; CLI cards correctly absent in hosted.

## Boundaries / still open
- Quota is a lifetime token cap (no billing-period reset yet); no soft-warn threshold.
- No audit log, user suspend, skill-pack admin, kill switches, or agent console yet.
- Billing/checkout (Stripe/crypto) is the remaining Phase 8 work.
- Host key path uses API providers only (CLI rejected in hosted per D8 / [[2026-06-24-subscription-auth-and-continuity]]).
