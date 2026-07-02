# Phase 5 — Résumé & opportunity pipeline

**Shipped 2026-07-02.** Three evidence-driven career tools on top of interview history. (Résumé
*intake* was already delivered as R31/Phase 23; this closes the remaining three items.)

## What landed

- **Résumé improvement** — `POST /api/resume/review` (prompt `resume.improve`, feature key
  `resume.improve`). Grounds suggestions in **demonstrated** skill claims (R23) + open weaknesses +
  the profile's recent finished reports. Returns `{ summary, suggestions:[{area,insight,suggested_bullet}] }`.
  Deliberately honest — the prompt forbids inventing achievements the interviews didn't show.
- **Job discovery** — `POST /api/opportunities` (prompt `opportunity.discover`, feature
  `opportunity.discover`). Match-scored openings for the profile; **web-search-augmented when the
  resolved provider is Anthropic** (`ChatOptions.webSearch`, D16), degrades to plausible openings
  otherwise. Returns `{ opportunities:[{title,company,location,match_score,why,url}], searched }`.
- **Target-company mode** — `POST /api/opportunities/target`. Adopt an opening as the profile's
  target: ensures the company pack (reuses the D10 `generatePack` generate-on-miss pipeline) and
  repoints the profile (company/role/skill_pack) via `db.updateProfile`, so the next interview is
  tuned to it. Records a `target_set` event.

## Design decisions / gotchas

- **Entitlement**: all three are value-adds that build on interview history, so they're gated
  **exactly like interviews** — `requireCall(c, 'interview', { feature })`. Free-intro users get a
  402 ("pick a plan"); BYOK/local are free; host users spend token credit. (Kept `CallKind` as-is;
  'interview' is the plan-gated, non-first-impression bucket.) Routing feature is separate from the
  gating kind — target mode gates as 'interview' but routes to the `company.pack` model.
- **Feature routing (R35)**: registered `resume.improve` + `opportunity.discover` in
  `server/src/features.ts` so an admin can point them at cheaper/stronger models.
- **Mock provider**: added branches keyed on the system strings `'résumé coach'` and
  `'job-search assistant'` returning valid JSON (so verify/e2e work offline). Note: mock keys off the
  **system** string, so the route system prompts must contain those phrases.
- **Web**: single **Career tools** page (`web/src/pages/Career.tsx`) with two sections (Résumé boost +
  Job matches, each opening has "Target this →"); Dashboard "🚀 Career tools" card; `career` view in
  `App.tsx`; `onTargeted → refresh()` so the repointed profile reloads. `db.packSlug(company)` is
  stored as `skill_pack` (resolvePublishedPack accepts slug or id).

## Verification / status

`scripts/verify-ph5.mjs` proves: plan-gating (free-intro 402), grounded résumé suggestions,
match-scored opportunities, target mode repointing the profile + ensuring the pack, and cross-user
404 isolation. `make check` + `make e2e` green.

**Phase 5 done.** Next in the owner-authorized track: **Phase 7 (learn-while-interviewing)** then
**Phase 4 leftover — D3 capability tiers**. See [[senior-bro-project]].
