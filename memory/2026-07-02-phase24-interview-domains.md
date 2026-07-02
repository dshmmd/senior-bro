# Phase 24 — Interview domains (technical + HR) + per-domain constellations (R33, R34, D22)

**Shipped 2026-07-02.** Interviews now have a **domain** axis (technical + HR), extensible via a
registry, each with its own prompt and its own gamification constellation.

## What landed

- **`interviews.domain`** column (migration `0011_wonderful_wolverine`, default `'technical'` so all
  historical rows stay technical). Deliberately **separate from `interviews.kind`** (which is
  `full`/`coaching`) — do not overload `kind`.
- **`server/src/domains.ts`** — the registry. `DOMAINS` maps each domain →
  - `promptKey`: technical reuses the existing **`interview.system`** (so admin edits/versions are
    untouched); HR = new **`interview.hr.system`** seed (D12 versioned prompt).
  - `feature`: its R35 routing key — technical=`interview.technical`, HR=new **`interview.hr`**
    (added to `server/src/features.ts`).
  - Also holds `HR_GENERAL_TOPICS` (12) + `sampleHrTopics(seed, count)` — a **seeded** Fisher–Yates
    shuffle (mulberry32) sampling `HR_TOPIC_SAMPLE=5`. Seeded by the **interview id** so the same
    interview yields the same topic set every turn and after resume (`systemFor` rebuilds the prompt
    per message — an unseeded shuffle would swap questions mid-interview).
- **HR prompt** (`interview.hr.system` seed) = 3 pools per session: fixed core (open/close, in the
  body prose) + a random sampled general subset (`{{HR_TOPICS}}`) + deterministic company-values pool
  (the company pack via the shared skill block, injected only when the profile has one).
- **R7/R23 apply to HR** unchanged: `systemFor` injects weaknesses + skill claims + user model for HR
  too; the **shared** evaluation prompt scores it — the evaluator is told the domain for *context*
  only (`renderEvaluation(..., domainLabel)`), **no separate scoring axes** (owner's call).
- **Routing wiring** (`routes.ts`): POST `/interviews` parses body first, then routes by
  `domainDef(domain).feature`; message/finish route by the *stored* interview's domain via the new
  `callForInterview(user, interview)` helper. Coaching drills are domain-agnostic → always technical.
- **R34 per-domain constellations**: `/api/progress` now returns **`{ domains: [{domain,label,progress}] }`**
  — one `computeProgress` per domain, and a domain is **omitted until it has a finished interview**
  (real evidence). Progress page (`web/src/pages/Progress.tsx`) refactored into a `DomainConstellation`
  sub-component + per-domain tabs (shown when >1 unlocked). Weaknesses stay profile-wide.
- **Web**: Dashboard "Start a mock interview" has a Technical / HR toggle; `domain` threaded through
  `App` view → `Interview` page → `api.startInterview(..., domain)`. History "Type" column shows the
  domain. Interview header shows 🤝 for HR.

## Gotchas / decisions

- **`FeatureKey` is `string`, not a literal union** (FEATURES is annotated `readonly FeatureDef[]`), so
  `Extract<FeatureKey, 'interview.hr'>` collapses to `never`. `DomainDef.feature`/`promptKey` are typed
  as the plain `FeatureKey`/`PromptKey`, not `Extract<…>`.
- The **guardrail red-team test** hardcoded the allowed guardrailed prompt keys — updated
  `server/test/guardrail.test.mjs` to include `interview.hr.system` + render it (frame + no
  `{{TOKEN}}` leaks).
- Verified by **`scripts/verify-ph24.mjs`**: domain persists on the interview + history rows; HR routes
  to a priced `interview.hr` model (proven via metering cost delta) while technical stays on the free
  default; per-domain unlock (0 → technical-only → both). `make check` + `make e2e` green.

## Status

All owner requirements **R1–R36 shipped** except the queued/deferred **R26–R30** (admin dashboard UX,
NL-store lazy migration D18, k8s deploy, Prometheus/Grafana, server-side STT). No phase is queued —
next work is the owner's call. See [[senior-bro-project]].
