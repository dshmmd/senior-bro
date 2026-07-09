# 2026-07-09 — RF-7 + RF-8 shipped: plain language + the dopamine loop

Commits `9472469` (RF-7), `d81d80a` (RF-8). Gates green (`make check` + `make e2e`).

## RF-7 — plain-language pricing & copy (owner: bundles of interviews, never tokens)

- Server: `TOKENS_PER_INTERVIEW` (env `SENIORBRO_TOKENS_PER_INTERVIEW`, default
  25k) served as `interview_estimate_tokens` in `/health` + `/usage` (shared
  types + `satisfies` updated).
- `web/src/strings.ts` = the i18n seam (owner: single-locale deploys, EN or FA
  per build): `interviewsLabel/interviewsFor/costPerInterview` + `TIER_LABELS`
  (fast/standard/deep → Quick/Balanced/Deepest with plain hints).
- Plan page sells Starter/Regular/Marathon bundles ("≈ N practice interviews"),
  balance reads "Interviews left ≈ N", models show "≈ $X per interview".
  Dashboard cost card, Setup, Memory ("what your coach remembers") swept of
  token/model/provider jargon. "Level check" kept (already plain).
- Landing de-BYOKed: hero badge, key-card → "It teaches while it tests",
  steps rewritten résumé-first. (Closes the 2026-07-03 follow-up.)

## RF-8 — dopamine loop (adaptive by level, owner decision)

- `web/src/components/Celebration.tsx`: full-screen `Celebration` overlay —
  `intensityForLevel()`: junior/mid → 'loud' (canvas confetti), senior/staff →
  'subtle' (premium glow). Reduced-motion → static banner. + `CountUp`.
- `ReportReveal` (Interview.tsx): celebration → score counts up → "▲ N points
  better than your last interview" (overall delta from the interviews list) →
  "See my progress →" CTA (routes to /progress). **Medal ceremony** (the
  deferred Phase 6 polish): after finishing, progress is fetched and earned
  medal ids are diffed against `localStorage['sb-medals-<profileId>']` — a
  newly-earned medal triggers a second full-screen ceremony.
- Dashboard header shows a 🔥 N-day streak badge (progress query).
- RF-10 robustness fix landed alongside: a failed send rolls back the optimistic
  message and restores the draft ("hit Send to retry").

## Refactor status after this session

P0 (RF-1…5) ✅ · RF-6 slice 1 ✅ (slice 2 = component adoption on remaining
pages + axe audit) · RF-9 ✅ · RF-7 ✅ (onboarding progress indicator folded
into RF-8 remainder) · RF-8 core ✅ (remaining: per-dimension deltas,
in-interview phase dots, constellation mini-preview) · RF-10 partial (draft
recovery done; component split + mobile pass remain). **P2 remains:** RF-11
(cost numeric + quota periods + double-spend test), RF-12 (single-locale FA
build + RTL), RF-13 (frontend unit tests), RF-14/15 (= ROADMAP R28/R29/R27).
