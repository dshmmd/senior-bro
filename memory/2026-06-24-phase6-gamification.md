# 2026-06-24 — Phase 6: gamification (constellation skill map)

Built out of phase order at owner's request (chosen over Phase 3 accounts).

## Shipped

- **`GET /api/progress`** (`server/src/progress.ts`, `computeProgress`): derives
  everything from existing data — no new tables.
  - `dimensions`: the 5 evaluation dimensions become star clusters. `lit` (0-1)
    blends avg score quality (70%) with experience (interview count toward cap 4, 30%).
    `crystallized` = avg ≥ 8 over ≥ 2 finished interviews.
  - `weaknesses`: open/improving/resolved counts + items.
  - `streak`: current + longest + 84-day heatmap from finished-interview `created_at`.
  - `level_trail`: junior→mid→senior→staff from `profile.level`.
  - `medals`: per-dimension mastery + Clean Slate (all weaknesses resolved) +
    Marathoner (7-day streak) + Seasoned (10 interviews).
  - `overall_completion`: mean cluster lit-ness → "% sky lit" + finale.
- **Constellation canvas** (`web/src/progress/constellation.ts`): zero-dep Canvas 2D,
  5 clusters ringed around a completion-driven core glow; lit stars twinkle + link,
  crystallized clusters get a gold halo; reduced-motion renders one static frame.
- **Progress page** (`web/src/pages/Progress.tsx` + `progress.css`): constellation,
  4 stat cards, level trail, 12-week heat strip, medal shelf (earned first, locked
  greyed), weakness rift bar, "sky complete" finale banner when all weaknesses resolved.
- Entry: prominent "🌌 Your constellation" card on the dashboard → `progress` view in `App.tsx`.

## Verified

`make check` + `make e2e` green (E2E now walks into the constellation and asserts
"sky lit" / level trail / Communication Master). Screenshotted with 2 seeded mock
interviews: 63% sky lit, Communication crystallized gold, 1 medal. Seed data
cleaned from `~/.senior-bro` afterward.

## Notes / next

- Owner decisions this session: **dual mode, hosted-first**; deploy target
  `95.38.235.93` (hold until Phase 3 accounts exist — see ROADMAP Q1).
- Deferred: a *triggered* full-screen medal ceremony at the moment a cluster
  crystallizes (today it's page state, not an animated moment).
- Constellation is data-driven off the 5 dimension names — if evaluation rubric
  dimensions in `prompts.ts` change, update `DIMENSIONS` in `progress.ts` to match.
