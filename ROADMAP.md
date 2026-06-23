# Senior Bro — Product Roadmap

> **This is the persistent plan.** Any Claude session continuing this product:
> read this file + `memory/INDEX.md` first, work the lowest unfinished phase,
> mark items `[x]` as they land, and append a memory entry per milestone.
> Product owner reviews between phases — finish a phase, stop, show it.

## Product vision (owner's brief, refined)

A web platform where anyone preps for real job interviews with an AI coach that
**gets to know them over time**. Feels limitless: it's their token (or our hosted
subscription), so the app proactively personalizes — builds their profile, shapes
their resume, finds real openings, runs interviews tuned to their weaknesses and
targets, teaches while testing, and gamifies progress until weaknesses become medals.

**Business model:** closed-source SaaS. Two ways in: (a) bring your own API key
(free tier, our costs ≈ 0), (b) buy a subscription that uses host tokens —
metered usage, fiat + crypto payments.

## Decisions made (owner gave authority — revisit only if owner objects)

| # | Decision | Why |
|---|---|---|
| D1 | Keep zero-heavy-deps policy for the landing page: custom Canvas 3D engine, no three.js | 60fps, tiny bundle, fully agent-maintainable; we can add three.js later only if a phase truly needs WebGL materials |
| D2 | Personalization = **event log + LLM-distilled "user model" document**, regenerated incrementally after sessions | One readable artifact the interviewer prompt consumes; cheap; auditable by the user ("what do you know about me?") |
| D3 | BYOK consistency via **capability tiers**: probe the configured model once, store tier (fast/standard/deep), select prompt variants + token budgets per tier | Same UX promise on a $5 Haiku key and an Opus key; no silent quality cliff |
| D4 | Hosted tokens & billing: usage metering per request (tokens in/out × model price) recorded locally per user; payments via Stripe first, crypto via a processor (e.g. Coinbase Commerce) second — never hand-roll wallets | Metering is the prerequisite for ANY business model; crypto direct-custody is a security/regulatory trap |
| D5 | Admin "site can change itself" ships as an **agent console with approval gates** (proposes diffs/PRs, admin approves), never live self-modification in prod | The wow stays; the blast radius doesn't |
| D6 | User-level skills (curated packs) are read-only to users; user personalization lives in their user-model doc, separate namespace | Owner requirement; clean trust boundary |
| D7 | Gamification metaphor: **constellation skill map** — each field is a star cluster, interviews light up stars, fully-lit cluster crystallizes into a medal | Fits the dark UI, maps 1:1 to weakness data we already collect |

## Open questions for the product owner

- ~~Q1~~ **ANSWERED (2026-06-24): dual mode, hosted-first.** Keep local BYOK as a
  free/dev tier but make multi-user hosted the primary product (one codebase,
  `SENIORBRO_MODE=local|hosted`). **Deploy target: `95.38.235.93`** (owner's SSH key
  is already on the box). Do NOT deploy until Phase 3 (accounts + isolation) exists —
  shipping the single-user app to a public host would expose one shared datastore.
- Q2: Which countries first for job-opportunity search? Affects which job boards/APIs.
- Q3: Subscription pricing instinct (e.g. $9/mo with N interview-hours) — needed before Phase 8 ships.

## Build order (owner-directed, may differ from phase numbers)

- 2026-06-24: owner chose **Phase 6 (gamification)** as the next build — works
  single-user today, highest demo impact. Phase 3 (accounts/hosted) deferred but
  is the gate before any deploy to `95.38.235.93`.

---

## Phases

### Phase 0 — Foundation ✅ (2026-06-11)
Working app: BYOK setup, profile, calibration, voice/text interviews, evaluation,
weakness coaching, 4 company packs. See `memory/2026-06-11-v0.1-foundation.md`.

### Phase 1 — Landing page that blows minds ✅ (2026-06-11, owner approved)
- [x] L1: Cursor-aware 3D hero — morphing particle shapes (sphere → torus → helix → wave),
      mouse bends rotation + repels particles, click/tap morphs, depth-colored connective lines
- [x] L2: Cursor spotlight, 3D tilt feature cards, magnetic CTA
- [x] L3: Live "interview demo" card — auto-typing interviewer/candidate exchange
- [x] L4: Fully responsive (≤380px up), touch fallbacks, `prefers-reduced-motion` respected
- [x] L5: Landing is the entry view; "Launch" drops into the existing app flow
- [x] L6: App screens responsive pass (chat, tables, dashboard, composer)
- [x] L7: Makefile (install/dev/build/check/smoke/clean)
- **Gate: owner reviews the landing before Phase 2 starts.**

### Phase 2 — Production hardening ✅ (2026-06-13)
- [x] CI: GitHub Actions — typecheck, ESLint (max strictness) + Prettier, build, smoke, on every push/PR
- [x] SSE streaming interviewer replies (kill the "thinking…" wait; speak sentence-by-sentence in voice mode)
- [x] Server input validation (zod), rate limiting, structured logging
- [x] Error boundaries + retry UX in the SPA; offline/disconnected states
- [x] E2E happy-path test (Playwright) with a mocked provider
- **Gate: owner reviews before Phase 3 (accounts & hosted mode) starts.**

### Phase 3 — Accounts & hosted mode
- [ ] User accounts (email magic-link; no passwords), sessions, per-user data isolation
- [ ] Same codebase runs in `local` mode (today's behavior) or `hosted` mode (multi-user)
- [ ] Provider keys per user, encrypted at rest; host-key pool for subscribers

### Phase 4 — Personalization engine ("it knows me")
- [ ] Event log: every action (answers, skips, durations, struggles, choices) appended per user
- [ ] User-model document distilled by LLM after each session; injected into all prompts (D2)
- [ ] Interactive micro-prompts instead of forms — one-tap chips ("more system design", "easier pace")
- [ ] "What you know about me" page — user can read/correct/delete their model
- [ ] Capability tiers for BYOK consistency (D3)

### Phase 5 — Resume & opportunity pipeline
- [ ] Resume intake (PDF/text upload → parsed into profile) or guided resume *builder* interview
- [ ] Resume improvement loop driven by interview evidence ("you said X in interviews — your resume undersells it")
- [ ] Job discovery: web search for live openings in the user's country/role; match-scored against profile
- [ ] Target-company mode: pick a real opening → interview prep tuned to that posting

### Phase 6 — Progress visualization & gamification (BAD-ASS edition) ✅ (2026-06-24)
- [x] Constellation skill map (D7): canvas star field, 5 dimension clusters light as interviews cover skills
- [x] Weakness arcs: open/improving/resolved rift bar; crystallized clusters glow gold
- [x] Medal shelf: dimension-mastery medals + Clean Slate / Marathoner / Seasoned; crystallization glow + "sky complete" finale banner
- [x] Streaks, 12-week practice heat strip, level-progression trail (junior → staff)
- Server: `GET /api/progress` (`server/src/progress.ts` derives everything from interviews + weaknesses).
- **Gate: owner reviews before next phase.**
- Deferred polish: full-screen medal *ceremony* animation on the exact interview where a cluster crystallizes (currently shown as state on the progress page, not a triggered moment).

### Phase 7 — Learn-while-interviewing
- [ ] Teaching mode: when the user doesn't know a topic, interviewer switches to socratic micro-lesson, then re-asks
- [ ] Per-question "explain like I'm new" escape hatch (one tap, no typing)
- [ ] Post-interview study plan generated from gaps; links into coaching drills

### Phase 8 — Billing & host tokens
- [ ] Usage metering: tokens in/out per request, priced per model, stored per user (D4)
- [ ] Subscription plans + quota enforcement; usage dashboard for users
- [ ] Stripe checkout; crypto checkout via processor; invoices
- [ ] Margin/analytics report for the owner

### Phase 9 — Admin panel
- [ ] Admin auth + RBAC; everything audited
- [ ] Manage: models/providers/defaults, skill packs (CRUD + publish), users, quotas, usage analytics
- [ ] Agent console (D5): admin types intent → agent proposes change as a diff/PR → admin approves → deploy
- [ ] Kill switches: per-provider, per-feature flags

### Phase 10 — Content & skills at scale
- [ ] Skill-pack generator: company name → web research → drafted `skills/<company>.md` → owner review queue
- [ ] Authoring skills/docs so ANY model/agent can extend data safely (schemas + validation + examples)
- [ ] Role packs (frontend, data, PM, …) and non-tech interview support

---

## Working agreement recap

1. One phase at a time; owner reviews at every gate.
2. Verification gate before any commit: `make check` (typecheck + build + smoke; lint once Phase 2 lands).
3. Mark checkboxes here, log milestones in `memory/`, keep `CLAUDE.md` architecture section current.
