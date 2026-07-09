# 2026-07-09 — Refactor plan created (docs-only)

Owner directive: before continuously adding features, evaluate the project against
the vision ("help people with no AI/software knowledge improve technical/language/
soft skills and reach easy job application, in a dopamine-producing way") and
produce a comprehensive, prioritized refactor plan — especially UI/UX, admin
manageability, and maintainability/robustness/testability. Owner may execute it
with any model, so the plan is self-contained.

## What landed

- **`REFACTOR.md`** at the repo root — the live refactor plan. Structure:
  evaluation (strengths kept, weaknesses W1–W13), guiding principles, epics
  RF-1…RF-15 in P0/P1/P2 priority with effort sizes, dependency table, owner
  decision points, tracking conventions (checkboxes + memory entries + ROADMAP D
  entries, gates per epic).
- Pointers added: CLAUDE.md (top note + START HERE step 0) and ROADMAP.md (top
  note). Rule recorded: **refactor epics before new features** until the plan closes.

## Key evaluation findings (why the plan looks like it does)

- Biggest web blocker: no router — hand-rolled view state in `App.tsx`, no URLs/
  back/refresh/deep-links, 9-callback prop drilling (W1). No component library,
  inline styles + emoji-as-nav everywhere (W2). Errors swallowed via
  `.catch(() => undefined)` (W3).
- Biggest server risk: `routes.ts` 1,598 lines / 60 endpoints + `db.ts` 1,311
  lines (W8); and the real behavioral tests live in `scripts/verify-ph*.mjs`
  which **don't run in CI** (W9) — so RF-2 (promote them to an integration suite)
  gates the monolith split (RF-3).
- Vocabulary speaks to engineers ("tokens", "BYOK") not the vision's non-technical
  audience (W5); gamification exists but isn't a loop (medal ceremony still
  deferred) (W6); Admin has great config foundations but weak UX/visibility (W12
  → RF-9 implements queued R26 + audit + kill switches).
- **W13: the tree had uncommitted shipped work on `main`** (2026-07-03 R37/R39
  onboarding redesign, admin entitlement fix, R30 voice) — RF-1 (commit it) is
  the first P0 item. Still uncommitted as of this entry.

## Next

RF-1 (commit in-flight work), then RF-2. Owner decision points listed in
REFACTOR.md §6 (pricing display unit, first locale, library vetoes, celebration
tone, whether Admin v2 jumps the queue).
