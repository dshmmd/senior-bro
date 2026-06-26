# 2026-06-26 — Phase 15: Dynamic company skill packs (D10 / R14)

Company interview packs moved out of static `skills/*.md` files into a DB table, **generated on
demand** for any company the user names, cached + reused across all users, with an admin review
queue. R14 done.

## What shipped
- **`company_packs` table** (migration `0005_slim_rachel_grey.sql`): `slug` (unique, normalized
  company), `company`, `roles` (json), `summary`, `body` (markdown), `status`
  (published|draft|archived), `source` (seed|generated), `model`, `searched`, `created_by`,
  timestamps. (12 tables now.)
- **`skills.ts` is seed-only now**: `loadSkillPacks` → `loadSeedPacks`; `getSkillPack` removed.
  `db.seedPacks()` imports the 4 `skills/*.md` on boot as `source: 'seed'`. Runtime reads the DB.
- **db.ts pack layer**: `packSlug()` (lowercase, strips inc/llc/…, alnum-collapse → cache key),
  `listPublishedPacks`/`listAllPacks`/`getPack`/`getPackBySlug`/`resolvePublishedPack`,
  `createPack` (optional explicit slug; `onConflictDoNothing` on slug → returns the winner of a
  concurrent-generation race), `updatePack` (re-derives slug if company renamed), `deletePack`.
- **Generation prompt is a versioned prompt** (`company.pack`, plugs into Phase 14): asks for
  strict JSON `{company, roles[], summary, body}`. `renderCompanyPack(body, company, role)`.
- **Web search seam (D16)**: `providers.ts` `chat()` takes `ChatOptions.webSearch`; on **Anthropic**
  it adds the hosted `web_search_20250305` tool and reports `searched` (true if the model invoked
  it). Other providers (OpenAI/CLI/mock) ignore it and draft from model knowledge. `runModelFull()`
  in routes surfaces `searched` while keeping metering.
- **Generate-on-miss**: `POST /api/packs/ensure {company, role}` → published pack by slug, else
  generate (capped 1500 tok) + cache + return. Wired into **ProfileSetup** ("…name your target
  company — we'll research it"); a "Researching {company}…" button state. Best-effort: a failed
  generation still saves the profile (no pack → generic interview). New `CallKind: 'pack'`.
- **Admin review queue** (`Admin.tsx` "Company packs", `/api/admin/packs*`): list (seed+generated),
  edit body, publish/unpublish (status), **regenerate** (re-draft, search-augmented), delete;
  **stale** badge for generated packs >90d old.
- Interviews resolve the attached pack via `db.resolvePublishedPack(profile.skill_pack)` (id or slug).

## Decisions / gotchas
- **Product call (flag at gate):** packs auto-generate on miss and are **used immediately**; the
  admin queue is *post-hoc* QC, not an approval gate (UX/scale). Free-intro users may generate during
  onboarding — `enforceEntitlement` now blocks only `kind === 'interview'` for free-intro (calibration
  + pack allowed under the 30k budget). Cost amortizes since packs are shared.
- Anthropic web_search tool type needs **literal** `name: 'web_search' as const` (else TS2345).
- ESLint `prefer-nullish-coalescing` rejects `x ? x : y` and string `||` fallbacks → used `?? `
  (the empty-after-trim edge case is irrelevant for real input).
- Mock provider returns a deterministic pack when the user message contains "interview playbook"
  (extracts company/role via regex) so e2e/CI generation is offline + stable.

## Verified
- `make check` + `make e2e` green. Live (isolated test DB + mock): 4 seed packs serve from
  `/skills`; `ensure` Stripe → generated; "stripe Inc" → cache hit (same id, slug normalization);
  admin edit / unpublish (drops from `/skills`) / regenerate / delete all work. Browser: Admin
  "Company packs" section + ProfileSetup research field render, no console errors.

## Next
- **Phase 16** (accent voice — mostly closed; native audio deferred) or **Phase 17 R22/R23**
  (tiered targets — builds directly on packs; evidence-gated knowledge).
