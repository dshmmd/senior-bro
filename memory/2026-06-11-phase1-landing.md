# 2026-06-11 — Phase 1: landing page + responsive + Makefile

## Shipped

- **ROADMAP.md created** — the persistent product plan (10 phases, decisions D1–D7,
  open questions Q1–Q3). It is now the source of truth for "what next"; CLAUDE.md
  rule 0 points to it.
- **Landing page** (`web/src/pages/Landing.tsx`, `web/src/landing/engine.ts`,
  `web/src/landing.css`):
  - Custom Canvas-2D 3D particle engine, zero deps: 380 particles morphing
    sphere → torus → double-helix → wave every 7s; cursor bends rotation
    (targetRot from pointer position) and repels particles in screen space;
    click/tap morphs immediately; depth-colored particles + connective lines.
  - Cursor spotlight (CSS vars --mx/--my), 3D tilt feature cards with cursor-tracked
    glow, magnetic CTA buttons, auto-typing live interview demo card.
  - `prefers-reduced-motion`: settles particles, renders one static frame, kills loop.
  - Entry logic: landing shows unless `localStorage['sb-entered']`; logo click in
    the app clears it and returns to landing.
- **Responsive pass** on app shell (≤640px and ≤380px breakpoints; tables scroll
  via `.table-wrap`). Landing responsive at 375px verified by screenshot.
- **Makefile**: `make check` = typecheck + build + smoke — the commit gate.
- `.claude/launch.json` for preview tooling (port 4747, `npm start`).

## Verified

`make check` green; desktop + mobile screenshots of landing via preview tooling
(sphere + helix shapes confirmed rendering, mobile stacking correct).

## Gotchas

- Hero canvas listens on `window` pointermove so the effect works while scrolled;
  engine must be destroyed on unmount (Landing useEffect cleanup does it).
- Line-linking is O(n²) with an x-axis early-out — keep COUNT ≤ ~450 or switch to
  a spatial grid if increased.
- Phase 1 gate: owner review of the landing before starting Phase 2 (CI, streaming, hardening).
