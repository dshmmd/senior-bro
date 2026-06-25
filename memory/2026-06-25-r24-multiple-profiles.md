# 2026-06-25 — R24: Multiple profiles per user

A user can keep several profiles (different stack/seniority) and switch between them.
The DB already stored many profiles per user (`profiles.user_id`); the app only ever
surfaced the latest. Added an explicit active-profile pointer + a switcher.

## What shipped
- **`users.active_profile_id`** (migration `0003_even_shinobi_shaw.sql`) → `profiles.id`,
  `onDelete: set null`.
- **db.ts:** `listProfiles(userId)`, `activeProfile(userId)` (explicit choice if owned, else
  latest), `setActiveProfile(userId, id)`; `createProfile` now sets the new profile active.
- **routes.ts:** `GET /api/profiles` (`{profiles, active_profile_id}`), `POST /api/profiles/:id/select`
  (guarded by `ownProfile`). `/profile`, `/weaknesses`, `/progress` now read `activeProfile` instead
  of `latestProfile`.
- **web:** `api.listProfiles`/`selectProfile`; Dashboard shows switcher **pills + "New"** only when
  the user has >1 profile; selecting calls `selectProfile` then `App.refresh()`. Switching to a
  profile with no level routes to calibration (each profile calibrates independently).

## Gotcha (important)
- Adding `users.activeProfileId.references(() => profiles.id)` created a **circular FK**
  (profiles.userId → users, users.activeProfileId → profiles). TypeScript inference collapsed
  **both** Drizzle tables to `any`, producing ~90 `no-unsafe-*` lint errors across db.ts. Fix:
  annotate the reference thunk return type — `.references((): AnyPgColumn => profiles.id, …)`.
  This is the documented Drizzle pattern for self/circular foreign keys. (Runtime was fine; it was
  purely a type-inference cycle.)

## Branch hygiene note (this session)
- The Phase 12/13/voice work had been committed on a local `feat/test` branch (also pushed to
  origin/feat/test); main was behind at Phase 12. Reconciled by **fast-forwarding main → feat/test**
  (clean — main was a strict ancestor), dropping a stale GitHub-Desktop stash (the superseded
  throwaway `0002_next_sumo` half-migration; clean replacement `0002_last_banshee` was already
  committed), and deleting the redundant local `feat/test`. origin/feat/test still exists.

## Verified
- `make check` + `make e2e` green (migration 0003 applies on boot; e2e text flow unchanged —
  switcher hidden at 1 profile).

## Next (Phase 17 remaining)
- R21 Back navigation, R22 fuzzy/tiered target, R23 evidence-gated knowledge.
