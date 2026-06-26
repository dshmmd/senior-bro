# 2026-06-26 — R22: Fuzzy / tiered target (Phase 17)

When the candidate doesn't have a specific company, they pick a **tier** instead of naming one;
the interview calibrates to that tier's hiring bar. Builds directly on Phase 15 company packs.

## What shipped
- **3 tier packs** (`TIER_SEED_PACKS` in `skills.ts`): `tier-1` (Big Tech / FAANG-bar), `tier-2`
  (high-growth scale-up), `tier-3` (established / general). Each has a hand-written playbook body
  describing that tier's process, signals, question styles, and how to calibrate difficulty.
- Tiers are seeded into **`company_packs` as `source: 'tier'`** with stable `tier-N` slugs, so they
  reuse the entire Phase 15 pipeline — attached to a profile, injected into the interview prompt via
  `resolvePublishedPack`/`skillBlock`. No new table, no migration (`source` is a free text column;
  `PackSource` type += `'tier'` in db.ts + web api.ts).
- `db.seedPacks()` now seeds both the `skills/*.md` companies (`source:'seed'`) and the tiers
  (`source:'tier'`), each idempotent by slug.
- `GET /api/skills` now returns **`source`** so the UI can split tiers from real companies.
- **ProfileSetup** reworked: a free-text "target company" box (generate-on-miss, unchanged) plus a
  row of **tier cards** ("Don't know the company? Aim for a tier instead"). Picking a tier sets the
  skill_pack to that tier and fills the company field with the tier label (so it shows as the target
  in the interview/report); typing a company clears a picked tier. The old known-company dropdown was
  removed — typing a known company name cache-hits its seed pack anyway.

## Decisions
- Tiers seeded with **hand-written** bodies (not generated): deterministic, free, immediately usable,
  and they show up in the admin "Company packs" queue like any pack (staleness flag only applies to
  `source:'generated'`, so tiers never show as stale).
- R22's "calibrates to that tier's bar" is realized by **pack injection into the interview** (the main
  deliverable). The level-check (calibration.generate) still keys off role/level, not the tier — left
  as-is to avoid scope creep.

## Verified
- `make check` (smoke: 7 packs now) + `make e2e` green. Live (isolated test DB + mock): `/skills`
  exposes the 3 tiers with `source:'tier'`; a profile targeting Tier 1 starts an interview (tier pack
  resolves, no error). Browser: 3 tier cards render in ProfileSetup, selecting one highlights it
  (accent border) and sets the target field; no console errors.

## Next
- **R23 — evidence-gated knowledge** (the last open Phase 17 item): don't treat self-reported skills
  as true until demonstrated; level/strengths reflect *shown* ability. Ties into calibration (R6) +
  weakness detection (R7).
