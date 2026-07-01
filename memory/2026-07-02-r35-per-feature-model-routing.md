# 2026-07-02 — R35 / D23: per-feature model routing

**What shipped:** the admin can assign a specific curated model to each *feature* (kind of model
call), instead of one global default powering everything.

## Model
- `server/src/features.ts` — the registry (`FEATURES[]`, `FeatureKey`, `isFeatureKey`). Current
  keys, all wired to a real call site (no dead knobs): `resume.parse`, `calibration`,
  `company.pack`, `interview.technical`, `personalization.distill`. New interview domains
  (`interview.hr`, Phase 24) add a row here when they land.
- `feature_models` table (migration `0010`): `feature_key` (PK) → `model_id` (FK `set null`).
- db: `assignedFeatureModel(key)` (returns the assigned id only if the model exists + enabled,
  else null → fall back), `listFeatureModels()` (raw map for the admin UI), `setFeatureModel`
  (upsert; null clears).

## Routing rule (in `resolveCall(user, feature?)`)
- **Host plan** (user picked a curated model): the admin's per-feature assignment **overrides**
  the user's pick; else their pick.
- **Free-intro**: the per-feature model, else the global default (`is_default`).
- **BYOK/local: never routed** — it's the user's own key + cost.
- Unassigned or a disabled/deleted assignment → falls back, so **zero admin action preserves
  today's behavior**.

## Wiring
`requireCall(c, kind, { profileId?, feature? })` threads the feature. Call sites: calibration →
`calibration`; `/packs/ensure` + admin regenerate → `company.pack`; interview opener/messages/
finish → `interview.technical`; post-interview distill re-resolves with `personalization.distill`
(reuses the interview's already-passed entitlement — `resolveCall` is pure, entitlement is
separate, so no double gate).

## Admin API + UI
`GET /api/admin/feature-models` (catalogue + assignments), `PUT /api/admin/feature-models/:key`
(`{model_id}`; null clears; 404 unknown key/model). Admin.tsx "Feature model routing" table with a
per-feature `<select>` (Global default + enabled models).

## Verification
`scripts/verify-ph35.mjs` (hosted, mock) — 12 assertions. Routing is proven **functionally via
metering**: a free-intro user's calibration costs 0 on the price-0 default, but > 0 once
calibration is routed to a priced model. Also covers round-trip, clear→fallback, 404s, admin-only.
`make check` + `verify-ph23` green (the resolveCall refactor didn't regress R32).

## Gotcha
`modelCreateSchema` caps `price_in`/`price_out` at 10000 — the verify script hit this first.

Remaining Phase 23: **R31** (CV onboarding) — will route the CV parse through the `resume.parse`
feature added here. See [[INDEX]], [[2026-07-02-phase23-first-impression-free-tier]].
