# 2026-07-09 — RF-6 slice 1 + RF-9 complete: design system start + Admin console v2

Commits `e697242` (RF-6 s1), `f3da048` (RF-9 s1), `68596b7` (RF-9 s2). All gates
green (`make check` incl. integration suite, `make e2e`, in-browser screenshots).

## RF-6 slice 1 — design system foundations

- Design tokens in `styles.css` (spacing/type/radius scales) + a documented
  `[data-theme]` seam for the future FA per-locale theme (owner: single-locale
  deploys, FA gets its own theme later).
- Utilities (`.muted`, `.fs-*`, `.between`) replacing repeated inline styles.
- Components: `Icon` (inline SVG set), `Card`/`NavCard` (keyboard-accessible
  whole-card button w/ chevron — Dashboard converted), `PageHeader`/`EmptyState`.
- Topbar de-emojified (SVG icon + label buttons), global `:focus-visible` ring,
  reduced-motion honored. **Slice 2 remains**: component adoption on remaining
  pages, Field/DataTable/Tabs extraction, contrast/axe audit.

## RF-9 — Admin console v2 (R26 + R25-audit + suspend + kill switches)

**Server (slice 1, migration 0013):** `users.suspended` (requireUser → 403;
`POST /admin/users/:id/suspend`, self-suspend blocked); `admin_events` audit
table — every admin mutation logs one (`GET /admin/events`);
`GET /admin/usage-events?user_id=` per-call metering audit;
`feature_models.disabled` kill switch — platform-funded calls on a killed
feature fail fast 503 pre-model-call (BYOK unaffected; killed `voice.transcribe`
reads unavailable → silent browser-STT fallback). Locked by
`scripts/verify-admin-v2.mjs` (25 assertions) in the CI integration suite.
**Breaking shape:** `GET /admin/feature-models` assignments are now
`{model_id, disabled}` objects (was raw ids) — `verify-ph35.mjs` updated.

**Web (slice 2):** `Admin.tsx` (830 lines) deleted → 9 routed pages under
`web/src/pages/admin/` with `AdminShell` tab nav + `AdminGuard`. New: prompt
version **diff/compare** (`web/src/diff.ts`, dependency-free LCS line diff),
usage audit table w/ user filter + CSV export, suspend button w/ confirm,
inline quota editor (no more `window.prompt`).

## Status: refactor progress

P0 (RF-1…RF-5) ✅ · RF-6 slice 1 ✅ · RF-9 ✅. **Next per owner's P1 order:
RF-7 (plain-language copy + onboarding polish + landing de-BYOK), then RF-8
(dopamine loop, adaptive-by-level ceremonies), RF-10 (interview room), RF-6
slice 2 finishes alongside. Then P2 (RF-11+).**
