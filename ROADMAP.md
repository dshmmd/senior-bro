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

**Business model:** closed-source SaaS, **hosted-first**. A short level-check
interview is **free for everyone** (no plan, no payment — just enough to grade the
user). After that the user must pick a **plan**:

- **Plan A — Host models (paid):** we run the calls on our API keys; usage is metered
  and billed (payment **mocked for now**). This is the only paid plan.
- **Plan B — Bring your own API key (free):** user pastes their own provider key; their
  cost, our cost ≈ 0.
- **Plan C — Local subscription (free):** user's logged-in `claude`/`codex` CLI on their
  own machine (Plan C is local-only by definition — see D8).

**Invite codes** (admin-issued) carry prepaid credit and unlock paid usage without a
card — for testers, partners, and early users. See D11.

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
| D8 | **Subscription auth via local CLI** (2026-06-24): besides BYO-API-key, support `claude-cli`/`codex-cli` providers that shell out to the user's logged-in `claude`/`codex` CLI in print mode (`claude -p`, `codex exec`). Bills the user's Claude Pro/Max or ChatGPT/Codex subscription — **no API credits**. Local mode ONLY (CLI runs on the user's own machine). The hosted tier must NOT proxy a customer's subscription remotely (ToS + can't share logins) — hosted uses API keys / host tokens. `server/src/providers.ts` strips `ANTHROPIC_*`/`OPENAI_*` env overrides so the CLI uses subscription auth. | The owner (and most users) have a $20 subscription but no API credits — this is the difference between being able to use the product at all or not |
| D9 | **Durable datastore = PostgreSQL in Docker** (2026-06-25): replace `node:sqlite` with Postgres 16 run via `docker compose` (owner authorized Docker on their laptop). One real DB for both local-dev and hosted — no dual-DB burden. Data access through a **typed query/migration layer** (Drizzle ORM recommended, revisitable) with versioned migrations. This **supersedes the zero-runtime-deps rule** for the server: robustness/long-term per-user data now outranks install-surface minimalism. | "Make a good reliable design to work in long term" + "robust enterprise system" — SQLite single-file won't carry concurrent multi-user hosted load, migrations, and the new prompt/company/credit tables cleanly |
| D10 | **Dynamic company skill packs** (2026-06-25): drop the "one company = one hand-written file" model. When a user names a company we don't have, the model **web-searches the company + its domain + the role's interview process**, drafts a pack, and stores it in the DB (cached + reused across users). The 4 static `skills/*.md` become the initial seed. Admin can review/edit/publish generated packs. | "Defining a few companies is useless" — every real user targets a different company; generation + cache scales to any company without a code change |
| D11 | **Plans, gating & invite codes** (2026-06-25): free short level-check for all; then a plan is required. Plan A (host models) is metered + **mocked payment**; Plans B (BYO key) and C (local CLI) are free. **Credit & billing are denominated in TOKENS** (Q3) — exactly what `usage_events` records; an invite code (admin-minted) carries a **token balance** that metered usage decrements, unlocking paid usage without a card. Entitlement is checked server-side before any paid (host-key) call — extends the Phase 8 metering/quota we already have. | Owner's plan structure; tokens are the natural unit since we already meter them; lets us launch + onboard testers before real billing exists |
| D12 | **Admin-managed, versioned system prompts** (2026-06-25): prompts move from `server/src/prompts.ts` constants into the DB, **editable in the admin UI, versioned with history + rollback**, with an active version per prompt key. Code ships the seed/default version. | Owner wants to manage & improve prompts live; versioning = safe iteration + auditability (best practice for prompt ops) |
| D13 | **Prompt guardrails (anti-derailment)** (2026-06-25): every interview prompt wraps a **fixed, non-editable guardrail frame** that pins the model to the interview task and treats all candidate input as untrusted *content, never instructions*. Admin-edited prompt bodies sit **inside** the frame; users can never escape it (no "ignore previous instructions", topic changes, or role swaps). | "Users must not change the context far away from interview" — prompt-injection / jailbreak resistance is a correctness + brand requirement |
| D14 | **Session continuity & returning users** (2026-06-25): long-lived auth so a user is recognized on every visit; an interrupted interview is **resumable exactly where it left off** (server is the source of truth — transcripts are already persisted; add active-interview detection + a "resume" entry point). | Owner: "leave a session and come back later and continue that" — durable, resumable sessions are table-stakes for a real product |
| D15 | **Voice = accent-aware** (2026-06-25): stop auto-sending raw speech-to-text. Two paths: (a) **send the audio to the model** where the provider supports audio input (accent help, no lossy transcription); (b) universal fallback = STT with an **editable transcript** the user confirms before sending. Prefer (a) when available, always offer (b). | Owner: raw STT can't be edited and loses accent signal — let the model hear the voice or let the user fix the text first |
| D16 | **Company research via the provider's built-in web search tool** (2026-06-25, answers Q4): generate packs with Anthropic/OpenAI web search behind a thin `searchProvider` seam; results cached per company in DB (one-time cost, reused across users). Swap to Tavily/Brave later only if we need tighter per-search token control. | Easiest path to production; caching makes token cost a non-issue; the seam keeps the door open |
| D17 | **Voice = editable transcript by default; native audio is an OpenAI/Gemini-only upgrade** (2026-06-25, refines D15/Q6): the universal accent-aware path is STT → **editable transcript the user confirms before sending** (shipped). True "model hears the voice" requires an audio-in model — **Claude has none**; only OpenAI (`gpt-4o-audio` / realtime) and Gemini do. Treat native audio as a per-provider capability behind a seam, offered only when the selected model supports it; never block the core flow on it. | Owner wants the model to hear accents, but our primary provider (Claude) can't take audio — so the editable transcript must be the floor, and native audio is an opt-in upgrade on capable providers |

> **North star (owner, 2026-06-25):** "requirements are not god's words — use your
> creativity; the goal is an *easy-to-use service for people who want to learn*, built to
> **scale**." When a requirement and ease-of-use/scalability conflict, optimize for the
> learner's experience and a clean path to production, and note the deviation at the gate.

## Open questions for the product owner

- ~~Q1~~ **ANSWERED (2026-06-24): dual mode, hosted-first.** Keep local BYOK as a
  free/dev tier but make multi-user hosted the primary product (one codebase,
  `SENIORBRO_MODE=local|hosted`). **Deploy target: `95.38.235.93`** (owner's SSH key
  is already on the box). ~~Do NOT deploy until Phase 3 (accounts + isolation) exists~~
  **Phase 3 shipped 2026-06-24** — accounts + per-user isolation now exist, so a hosted
  deploy no longer exposes a shared datastore. Owner still wants the R13 admin/metering
  bundle (Phases 8/9) before actually charging users.
- Q2: Which countries first for job-opportunity search? Affects which job boards/APIs.
- ~~Q3~~ **ANSWERED (2026-06-25): the unit is TOKENS.** Plan A is billed and invite-code
  credit is denominated in tokens — which is exactly what `usage_events` already records.
  Credit balance is a token allowance; metered usage decrements it. (Real $-per-token rate is
  a later, mocked-for-now concern.)
- ~~Q4~~ **ANSWERED (2026-06-25): use the provider's built-in web search tool** (Anthropic web
  search / OpenAI), behind a thin `searchProvider` seam. Rationale: easiest to production (no
  extra vendor/key), and pack generation is **cached per company** so the (higher) token cost
  is one-time and amortized across all users — control matters less than simplicity here. A
  dedicated API (Tavily returns LLM-condensed results → fewer tokens; Brave is cheapest) is the
  swap-in if we ever need tighter per-search token control or a provider lacks search. See D16.
- ~~Q5~~ **ANSWERED (2026-06-25): Drizzle ORM + Postgres.** (D9 locked.)
- ~~Q6~~ **PARTIALLY ANSWERED (2026-06-25): editable-transcript fallback shipped as the default;
  native audio is provider-gated.** Capability check: **Claude / Anthropic Messages API does NOT
  accept audio input** (text + images + PDF only) — our primary provider can't hear the candidate.
  **OpenAI** does: `gpt-4o-audio-preview` (Chat Completions `input_audio`) and the **Realtime API**
  (`gpt-4o-realtime`). **Gemini 2.x** also takes native audio. So "send the audio to the model"
  only works on an OpenAI/Gemini path, never on Claude. **Still open for the owner:** do we add an
  OpenAI/Gemini audio path (and on which plan — BYO-OpenAI-key vs a host audio model), or ship
  accent-aware voice purely via the editable transcript for now? See D17.
- ~~Q7~~ **ANSWERED (2026-06-25): single Postgres for local + hosted; retire `node:sqlite`.**
  Local dev = a Postgres container on the laptop (temporary); **scalability is the north star**,
  so the schema/queries target a real server-grade DB from day one. Local single-user becomes a
  seeded account on the same Postgres.

## Build order (owner-directed, may differ from phase numbers)

- 2026-06-24: owner chose **Phase 6 (gamification)** as the next build — works
  single-user today, highest demo impact. Phase 3 (accounts/hosted) deferred but
  is the gate before any deploy to `95.38.235.93`.
- 2026-06-24: owner queued the **hosted admin bundle (R13)** as a near-term must for
  deploy: admin manages per-model API keys, users pick from admin-curated options
  (no redeploy to change), and usage metering + per-user token limits. Spans
  Phases 3 → 8 → 9; build the thin vertical slice across them first (see Phase 9 note).
- 2026-06-25: **R13 vertical slice landed** (Phase 3 accounts + Phase 9 admin model/key
  mgmt + Phase 8 metering/quota). The hosted-deploy bundle is functional end-to-end.
- 2026-06-25: **owner re-planning** (D9–D15 added). New near-term scope: durable Postgres
  store on Docker, dynamic company-pack generation, plans + gating + invite codes,
  admin-managed versioned prompts + guardrails, resumable sessions, accent-aware voice.
  These become **Phases 11–16**. **Recommended build order:**
  1. ~~**Phase 11 — Postgres/Docker foundation** (D9)~~ ✅ **shipped 2026-06-25.**
  2. ~~**Phase 12 — Identity & resumable sessions** (D14)~~ ✅ **shipped 2026-06-25.**
     Returning-user "welcome back", resume an interrupted interview, DB-level FKs/indexes.
  3. ~~**Phase 13 — Plans, gating & invite codes** (D11)~~ ✅ **shipped 2026-06-25.**
     Free level-check → plan gate; mocked checkout; admin-minted invite-code credit; per-call entitlement.
  4. **Phase 14 — Admin-managed versioned prompts + guardrails** (D12, D13) ⬅ recommended next.
  5. **Phase 15 — Dynamic company skill packs** (D10).
  6. **Phase 16 — Accent-aware voice** (D15).
  > Rationale for ordering: 11 unblocks all storage; 12/13 make hosted usable + monetizable;
  > 14 hardens correctness/safety; 15/16 are high-value features that ride on the above.
  > Owner may reorder — if you want a flashy feature first (e.g. dynamic company packs),
  > say so and the agent will resequence.

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

### Phase 3 — Accounts & hosted mode ✅ (2026-06-24)
- [x] User accounts (email magic-link; no passwords), sessions, per-user data isolation
- [x] Same codebase runs in `local` mode (today's behavior) or `hosted` mode (multi-user)
- [x] Provider keys per user, encrypted at rest (AES-256-GCM); host-key pool deferred to Phase 8/9
- `SENIORBRO_MODE=local|hosted` (`server/src/mode.ts`). Local = today's single implicit
  owner, no auth. Hosted = magic-link sessions (`server/src/auth.ts`), `sb_session` cookie.
- Per-user provider config moved from `config.json` into the `users` row, api key
  encrypted at rest (`server/src/crypto.ts`, key from `SENIORBRO_SECRET` or a 0600 keyfile).
  Legacy `config.json` auto-imported into the local owner on first boot.
- Isolation: `user_id` on profiles (+ additive migration/back-fill); every route resolves
  the user and guards by-id resources with `ownProfile`/`ownInterview` (404 cross-user).
- CLI subscription providers (claude-cli/codex-cli) are rejected in hosted mode (D8).
- Magic-link delivery is dependency-free: logged + optional `SENIORBRO_MAGICLINK_WEBHOOK`;
  in non-prod the link is returned to the client so dev/staging can sign in.
- **Gate: owner reviews before Phase 4. Deploy to 95.38.235.93 is now unblocked**
  (run with `SENIORBRO_MODE=hosted` + `SENIORBRO_SECRET`), though the R13 admin/metering
  bundle (Phases 8/9) is the owner's stated must-have before charging anyone.
- Deferred: host-key pool for subscribers (belongs with Phase 8/9 admin key management).

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

### Phase 8 — Billing & host tokens  ⭐ part of the hosted-deploy priority bundle (R13)
- [x] **Usage metering**: capture tokens in/out per request from each provider
      response, price per model (admin-maintained `models` table), store per user (D4).
      `usage_events` ledger; `runModel()` in routes records every call (cost from price).
- [x] **Per-user limits**: token quota per user; enforced server-side before each
      host-key call (402 when exhausted). BYOK calls are recorded but never blocked.
      (Soft warnings + per-period reset still TODO — current quota is a lifetime cap.)
- [x] User-facing usage readout: `GET /api/usage` (tokens in/out, cost, vs quota).
      A richer day/model history dashboard is still TODO.
- [ ] Subscription plans + quota tiers; Stripe checkout; crypto checkout via a
      processor (e.g. Coinbase Commerce); invoices.
- [ ] Owner margin/analytics report (revenue vs. token cost per user/model).
- Shipped 2026-06-25 as the metering half of the R13 vertical slice (see Phase 9).

### Phase 9 — Admin panel  ⭐ hosted-deploy priority bundle (R13) — first thing after Phase 3
The owner's explicit "first of all, when deployed on a host" requirements. Everything
here must be **configurable from the admin UI with no redeploy** ("configurable as fuck").
- [x] Admin auth + RBAC (local owner is admin; hosted admins via `SENIORBRO_ADMIN_EMAILS`).
      `requireAdmin` guard on every `/admin/*` route. (Full audit log still TODO.)
- [x] **Model & API-key management**: admin registers providers + models, stores the
      API key for each (encrypted at rest), sets enabled/default + per-Mtok price.
      Add/rotate/remove = admin-UI action, takes effect live (no redeploy). `models` table,
      `GET/POST/PATCH/DELETE /api/admin/models`, web `Admin.tsx`.
- [x] **User-facing model picker driven by admin config**: users pick only from
      admin-enabled models (`GET /api/models`, `POST /api/models/select`); Setup shows
      "Use a provided model". No model/provider hardcoded in the client.
- [x] Usage & limits console: per-user token burn + cost, set/adjust quotas
      (`GET /api/admin/users`, `POST /api/admin/users/:id/quota`). (Suspend-user still TODO.)
- [ ] Manage skill packs (CRUD + publish) and feature flags / per-provider kill switches.
- [ ] Agent console (D5): admin types intent → agent proposes change as a diff/PR →
      admin approves → deploy. Never live self-modification in prod.
- **R13 vertical slice shipped 2026-06-25** (accounts → admin model+key → user picks →
  metered & quota-checked). Gate: owner reviews. Remaining: billing/crypto (Phase 8),
  skill-pack admin + kill switches + agent console (above), audit log, suspend, quota periods.

> **Sequencing note for next agents:** R13 (admin keys + user-selectable options +
> metering/limits) spans Phase 3 (accounts/isolation, prerequisite), Phase 8 (metering
> & limits), and Phase 9 (admin UI + model/key config). When the owner says "do the
> admin panel," build the thin vertical slice across all three: accounts → admin
> registers a model+key → user picks from enabled models → each call is metered and
> quota-checked. Ship that slice before the fancier billing/crypto/agent-console parts.

### Phase 10 — Content & skills at scale
> **Superseded by Phase 15** (the company-pack generator moved there with D10). Keep the
> remaining cross-cutting items here.
- [ ] ~~Skill-pack generator~~ → see **Phase 15**.
- [ ] Authoring skills/docs so ANY model/agent can extend data safely (schemas + validation + examples)
- [ ] Role packs (frontend, data, PM, …) and non-tech interview support

---

## Phases 11–16 — owner re-planning 2026-06-25 (D9–D15)

### Phase 11 — Postgres/Docker datastore foundation (D9) ✅ (2026-06-25)
Replaced `node:sqlite` with PostgreSQL run via Docker; one DB for local-dev + hosted.
- [x] `docker compose` with Postgres 16 + a named volume; `.env.example` for `DATABASE_URL`;
      Make targets (`db-up`/`db-down`/`db-reset`/`db-generate`/`db-migrate`).
- [x] Data-access + migration layer = **Drizzle ORM** (`server/src/schema.ts`,
      `drizzle.config.ts`, generated `server/drizzle/`). Schema covers all 9 tables.
- [x] Ported every `server/src/db.ts` query to Drizzle behind the **same function names**
      (now async). Rippled `await` through auth/admin/routes/index; encryption-at-rest kept.
- [x] One-time import script `scripts/import-sqlite.mjs` (legacy `~/.senior-bro/data.db` →
      Postgres, ids preserved, ON CONFLICT DO NOTHING, sequences bumped). Ran it on owner's data.
- [x] `make check` + CI boot Postgres (compose locally; a `postgres:16` service in CI).
      e2e isolates a `senior_bro_test` DB via `e2e/prepare.mjs` (runs before Playwright,
      since the webServer boots before globalSetup).
- [x] Local-mode story (Q7): single Postgres for both; the implicit owner is a seeded
      account (id 1). `node:sqlite` retired.
- **Gate: owner reviews before Phase 12.** Superseded the zero-deps rule for the server.
- Known follow-up: `cost_usd` is stored as `real` (float) → minor precision drift; revisit
  with `numeric` if/when real billing lands (billing is token-denominated anyway, D11/Q3).

### Phase 12 — Identity & resumable sessions (D14) ✅ (2026-06-25)
- [x] Returning-user recognition: durable 30-day `sb_session` cookie (already remember-me by
      `maxAge`); a "Welcome back" greeting on the dashboard for users with prior sessions; clean
      re-auth when expired (expired session → `authed:false` → login view, no stale state).
- [x] Detect an **in-progress interview** and offer **Resume** (server transcript is the source
      of truth); resume reloads the exact transcript/phase, voice or text, without re-opening the
      conversation or re-speaking history. A prominent "interview in progress" banner + resumable
      rows in History; **Discard** drops a stale active interview (`DELETE /api/interviews/:id`).
- [x] "Your sessions" list: the dashboard History table lists past (finished) + in-progress
      interviews per user; clicking a finished one opens its report, an active one resumes it.
- [x] Robust per-user data partitioning: real **foreign keys + lookup indexes** added at the DB
      (`server/src/schema.ts`, migration `0001`) — child rows cascade from their parent, optional
      links (`usage_events.model_id`, `weaknesses.source_interview_id`, `users.model_id`) null out.
      Route-level ownership guards (`ownProfile`/`ownInterview`) reviewed; all reads stay user-scoped.
- **Gate: owner reviews before Phase 13 (plans, gating & invite codes).**

### Phase 13 — Plans, gating & invite codes (D11) ✅ (2026-06-25)
- [x] Plan model: `users.plan` ∈ `free-intro` (default) / `host` (paid) / `byok` (free) /
      `local` (the implicit local owner). Hosted-only gating; local mode stays unrestricted.
- [x] **Free level-check**: a free-intro hosted user with no key/model still runs calibration —
      `resolveCall` falls back to the admin **default model**, capped by `FREE_INTRO_TOKEN_BUDGET`
      (30k). Interviews are blocked until a plan is chosen.
- [x] Entitlement check server-side before any paid call — `enforceEntitlement(user, call, kind)`
      folds in the old quota: free-intro→calibration-only under budget; host→needs remaining token
      credit (402); BYOK/local→free. Friendly paywall copy surfaced in the web UI.
- [x] **Mocked payment**: `POST /api/plan/checkout` grants a token-credit pack (100k/500k/1M) and
      flips the user to `host`. Pluggable for real Stripe/crypto later (Phase 8).
- [x] **Invite codes**: `invite_codes` table; admin `GET/POST /api/admin/invites` +
      `/revoke`; `POST /api/plan/redeem` is single-use, not-expired, not-revoked → grants credit
      (→ host). Credit (= `token_quota`) is decremented by metered `tokens_used`. Admin console
      section (mint/list/revoke) in `Admin.tsx`.
- [x] User billing/usage page: `GET /api/usage` returns plan + `credit_left` + `tokens_used`; the
      web **Plan page** (topbar 💳) shows it and handles checkout/redeem/model-pick/BYOK.
- Verified: `make check` + `make e2e` (local) green; hosted gating proven end-to-end by
  `scripts/verify-ph13.mjs` (free check → 402 paywall → redeem → select model → metered interview).
- **Gate: owner reviews before Phase 14 (admin-managed versioned prompts + guardrails).**

### Phase 14 — Admin-managed versioned prompts + guardrails (D12, D13)
- [ ] Move prompts from `server/src/prompts.ts` constants into a DB table:
      `prompt_key` → many **versions** (body, author, created_at, active flag).
- [ ] Admin UI: edit a prompt → saves a new version; diff vs. previous; set active; rollback.
- [ ] Code ships the **seed/default version**; DB override wins when present.
- [ ] **Guardrail frame**: a fixed, non-editable wrapper around every interview prompt that
      pins the model to the interview task and treats candidate text as untrusted content
      (resists "ignore previous instructions", topic/role changes). Admin bodies live inside it.
- [ ] Red-team test set (jailbreak attempts) run against the guardrail in CI.

### Phase 15 — Dynamic company skill packs (D10)
- [ ] On unknown company: model **web-searches** company + domain + role interview process
      (source per Q4) and drafts a structured pack.
- [ ] Store generated packs in DB (cache + reuse across users); migrate the 4 static
      `skills/*.md` in as seeds; keep the markdown+frontmatter shape.
- [ ] Admin review queue: approve / edit / publish / refresh a generated pack; staleness TTL.
- [ ] Interview setup uses the stored pack (generate-on-miss, then cache).

### Phase 16 — Accent-aware voice (D15 / D17)
- [x] Stop auto-sending raw STT. Add an **editable transcript** the user confirms before send
      (universal fallback). Shipped 2026-06-25: in voice mode the mic dictates into an editable
      composer; the user reviews/edits, then Sends (`web/src/pages/Interview.tsx`).
- [ ] Where the provider supports it, send **audio directly to the model** (accent help) instead
      of/in addition to STT. **Provider-gated (Q6/D17):** Claude can't take audio; target OpenAI
      (`gpt-4o-audio` / realtime) or Gemini. Behind a capability seam; needs owner go-ahead on
      which plan carries it.
- [ ] Capability detection: pick audio-native vs. editable-transcript per configured model.

### Phase 17 — UX, fuzzy targets, multi-profile & evidence-gating (R21–R24, owner 2026-06-25)
- [ ] **R21 Back navigation:** every screen (Setup, Profile, Calibration, Plan, …) has an obvious
      Back so users never get stuck; consistent placement.
- [ ] **R22 Fuzzy/tiered target:** when the company is unknown, let the user pick a **Tier** (e.g.
      Tier 1 = FAANG-bar, Tier 2 = strong scale-up, Tier 3 = general) instead of an exact name;
      the pack/interview calibrates to that tier. Builds on Phase 15 company packs (D10).
- [ ] **R23 Evidence-gated knowledge:** never accept a self-reported skill as true until the user
      has answered questions demonstrating it; level/strengths reflect *shown* ability. Ties into
      calibration (R6) and weakness detection (R7).
- [ ] **R24 Multiple profiles per user:** keep several profiles (different stack/seniority) and
      switch between them. The DB already stores many profiles per user (`profiles.user_id`); the
      app currently surfaces only the latest — add a picker + "new profile" without losing history.

---

## Working agreement recap

1. One phase at a time; owner reviews at every gate.
2. Verification gate before any commit: `make check` (typecheck + build + smoke + lint).
   Run `make e2e` when a UI flow changed. From Phase 11, `make check` also needs Postgres up.
3. Mark checkboxes here, log milestones in `memory/`, keep `CLAUDE.md` architecture section current.
