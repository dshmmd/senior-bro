# 2026-07-09 — RF-3 slice 1: routes.ts monolith split (commit `459db07`)

The 1,598-line / 60-endpoint `server/src/routes.ts` is gone, replaced by
per-domain modules — behavior-preserving, proven by the RF-2 integration suite.

## Shape

- `server/src/routes/` — `index.ts` (builds the `api` Hono, owns `onError`,
  registers every module via `register*Routes(api)`); `shared.ts` (parseBody,
  wantsStream, ownProfile/ownInterview isolation guards); `health` (health +
  /config BYOK), `auth`, `models` (catalog/select/usage), `voice`, `plan`,
  `admin` (294 lines — models/feature-routing/users/invites/prompts/packs),
  `packs` (/skills + /packs/ensure), `career` (resume/review, study-plan,
  opportunities), `profiles` (CRUD + from-cv + calibration), `interviews`, `me`
  (weaknesses/progress/me-model). Largest file 294 lines (<300 target).
- `server/src/services/` — `entitlement.ts` (FREE_IMPRESSION_LIMIT, ResolvedCall,
  resolveCall, enforceEntitlement, requireCall, callForInterview,
  resolveTranscribeCall), `model-runner.ts` (meterUsage/runModel/runModelFull),
  `pack-generator.ts` (draftPack/generatePack), `interview-engine.ts`
  (systemFor/stripToken/distillUserModel).
- Zod schemas stayed with their route modules — RF-4 lifts them to a `shared/`
  workspace next.
- `server/src/index.ts` imports `./routes/index.js`.

## Notes / gotchas

- One real de-duplication: admin `POST /admin/packs/:id/regenerate` had a copy of
  the pack-draft logic — both it and `generatePack` now call `draftPack()`
  (draft.body typed non-optional after the 502 check).
- `career.ts` also de-duped the "recent finished reports" filter into
  `recentReports()`.
- Remember `npm run format` before `make check` — prettier gate fails on freshly
  written files otherwise. And don't pipe `make check` to `tail` without
  `set -o pipefail` (a failure looked like success and mis-pointed at e2e).

## Verification

`make check` green with pipefail (lint, typecheck, build, unit + RF-2 integration
suite = all former verify scripts, smoke) + `make e2e` green.

## Next

RF-3 slice 2: split `db.ts` (1,311 lines) into `server/src/db/…` query modules
re-exported behind the same `db` object, and `prompts.ts` (725) into seeds /
render / guardrail. Then RF-4 (shared API types), RF-5 (web router + query cache).
