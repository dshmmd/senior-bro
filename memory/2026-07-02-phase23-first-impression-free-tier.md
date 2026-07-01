# 2026-07-02 — Phase 23 (partial): first-impression free tier (R32) + delete profile (R36)

**What shipped** (the priority half of Phase 23 — the free-tier business-model change the
owner flagged as conflict-resolution priority, plus profile delete):

## R32 — shared "first impression" free tier (D21)
Redefines Phase 13's free tier. Before: a `free-intro` hosted user got an unconditional
30k-token calibration budget (`FREE_INTRO_TOKEN_BUDGET`). Now: **3 free "first impressions"**,
one per profile/position they onboard.

- **Design decision — the credit is tied to the profile.** Added
  `profiles.first_impression_at` (nullable timestamp, migration `0009`). It's set the first
  time a free onboarding action runs on that profile. Once set → that profile's onboarding is
  free forever (re-checking a position **never re-burns**, per owner). The gate is
  `firstImpressionCount(user) >= FREE_IMPRESSION_LIMIT` (3), counting the user's profiles with
  the timestamp set. **Deleting a profile (R36) frees the slot** automatically (count drops).
- Why profile-tied and not a pure counter: makes "delete frees a slot" + "progress persists
  unless deleted" + "partial use still counts 1" all fall out naturally, and it survives R31
  (CV-first onboarding will create the profile at parse time, so resume-check is profile-scoped
  too).
- `enforceEntitlement(user, call, kind, profileId?)` gained the profile id and now **consumes**
  the slot (idempotent `consumeFirstImpression`). **Ownership is verified BEFORE the entitlement
  check** in the calibration routes (`ownProfile` first, then `resolveCall` + enforce) so a
  credit can never be spent/bypassed against another user's profile. `CallKind` onboarding kinds
  (`calibration`, `pack`) draw from the budget via `FIRST_IMPRESSION_KINDS`; `interview` never
  does (always plan-gated).
- Pre-profile `POST /packs/ensure` has no profile id → allowed while the user still has a free
  slot, but doesn't itself consume (the calibration on the profile it's for does).
- `/api/usage` now returns `first_impressions_used` / `first_impressions_limit` (dropped
  `free_intro_budget`). Plan page shows "N/3 used" for free-intro users.

## R36 — delete a profile/position
`DELETE /api/profiles/:id` (owned; 404 cross-user). `db.deleteProfile` deletes the row; all
children (interviews, weaknesses, skill_claims, user_events, calibrations, user_models) cascade
at the DB via their `profile_id` FKs, and `users.active_profile_id` nulls out (FK `set null`) so
`activeProfile()` falls back to the latest remaining profile. Dashboard renders a per-profile
✕ (in the >1-profile switcher) with a `window.confirm`.

## Verification
`scripts/verify-ph23.mjs` — self-booting hosted + mock server, 16 assertions: consume 1/3 →
re-check same profile stays 1/3 → 2/3 → 3/3 → 4th profile onboarding 402 → delete frees a slot
(2/3) → 4th onboards (3/3) → interview still 402 → cross-user delete 404. `make check` green.

## Gotchas / notes
- `enforceEntitlement` is no longer pure-read (it writes `first_impression_at`). Fine, but keep
  the ownership-before-enforce ordering if you add more onboarding kinds.
- Local mode is unaffected (entitlement is hosted-only).
- Migration `0009_gray_morlocks.sql` = one `ADD COLUMN`.

## Remaining Phase 23 (next session)
- **R35** — per-feature admin model routing (D23): a `feature_key → model` map (mirrors D12
  prompt keys) so the admin can put cheap models on cheap actions; falls back to the global
  `is_default`. Groundwork for R31 (which model parses the CV).
- **R31** — CV-first onboarding: upload résumé (PDF/text) → LLM extracts target/company/tech/
  seniority into a draft profile; manual Q&A becomes the fallback. Consumes a first impression
  on the created profile.

See [[INDEX]].
