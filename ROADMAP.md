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
| D18 | **Versioned natural-language records + lazy per-user LLM migration** (2026-06-27, answers R27): store gathered NL data as **structured records with natural-language values + a `schema_version`** (Postgres **JSONB**, one datastore per D9). On a schema change, migrate **lazily and per-user on first touch after the release** — prefer deterministic/mechanical transforms; call **our host API** (never the user's models/keys) only for genuine *semantic* reshapes, with a dedicated migration prompt; idempotent, backgroundable. **Chosen over RAG**, which is a *retrieval* technique, not a storage/migration strategy (you'd still have to store + migrate the underlying data); Elastic/vector DB deferred to a future retrieval feature. | Owner's worry is a cheap path off today's schema without bulk re-encoding everything through a model. Lazy per-user migration means only active users' data moves, once, on demand; JSONB keeps schema flexibility without a second datastore; most migrations need no model at all |
| D20 | **Accent-aware voice upgrade = server-side STT via an OpenAI-compatible gateway (AvalAI)** (2026-06-27, refines D17): when we move beyond browser Web Speech STT, prefer a **dedicated transcription endpoint** (AvalAI `POST /v1/audio/transcriptions`, Whisper / `gpt-4o-transcribe`) — audio → text on our server → editable transcript → *any* chat model. **Model-agnostic & robust:** independent of which model/gateway runs the interview, so it sidesteps the "does this gateway forward audio to this model" question. **AvalAI** is OpenAI-compatible (`https://api.avalai.ir/v1`, standard `Bearer` auth, standard endpoints) → its chat side drops into the D19 configurable-base-URL seam (even simpler than Arvan: no per-model gateway token, no `apikey` scheme). **Native audio-in** (multimodal `input_audio` to gpt-4o-audio / Gemini, incl. Gemini-on-Arvan) stays **deferred** and **gated on a live per-gateway passthrough test** — our provider currently sends text-only content, and gateways often proxy text only. | Owner is evaluating AvalAI/Arvan for audio; server-side STT gives the accent win without coupling to a specific model's multimodal support or a gateway's audio passthrough, and reuses the metering/provider seam we already built |
| D19 | **ArvanCloud AIaaS is an OpenAI-compatible host provider** (2026-06-27, answers the Arvan-usage question for R25/R26): integrate Arvan via the existing `openai` provider path with a **per-model configurable base URL** (currently hard-coded to `api.openai.com`). OpenAI-compatible chat completions return a `usage` object (`prompt_tokens`/`completion_tokens`), which our provider already parses — **including on streamed calls** (`stream_options.include_usage`, already set). So with Arvan's **per-MTok input/output prices** in the `models` table, `runModelFull` already computes `cost = inTok/1e6·priceIn + outTok/1e6·priceOut` — **usage + cost are automatic; the only code gap is the configurable base URL.** Caveat: confirm Arvan returns `usage` on streamed responses; if not, fall back to the char-estimate. | Reuses the whole metering/quota stack with one small change; avoids a bespoke provider; keeps cost accounting exact for a per-MTok-priced provider |
| D21 | **Free tier = one shared "first impression" credit, 3 per verified user** (2026-07-02, redefines D11/R18's "free level-check for everyone"): resume-check, company/target-knowledge lookup-or-generation, first-knowledge-build (user-model bootstrap), and calibration all draw from **one shared lifetime counter of 3** per email-verified user. Touching any one of them — even partially, even if the user doesn't finish it — burns 1 of the 3; it's not 1-free-use-per-action-type. After 3, those actions require a plan (host pay-as-you-go credit / BYOK / local CLI), same gate full interviews & weakness-drilling already sit behind (unchanged). | Owner: these are all "first impression" actions on the same free budget, not independent unlimited freebies — caps host-token spend on exploration while still letting a curious user meaningfully try the product before paying |
| D22 | **Interview "domain" is a first-class, extensible dimension** (2026-07-02, answers the technical+HR ask; renamed from an earlier "kind" wording because `interviews.kind` already means `full`/`coaching` in the schema — this is a **separate** column): interviews carry a domain (starts with `technical`, `hr`); each domain has its own versioned system prompt key (rides the D12 prompt-versioning infra, e.g. `interview.technical.system` / `interview.hr.system`) and its own gamification constellation (extends D7/Phase 6). Adding a new domain later is a registry entry, not a code branch rewrite. A domain's constellation/dashboard section stays hidden until the user has evidence for it — no empty HR constellation for a user with zero HR interviews, and vice versa. | Owner wants HR interviews alongside technical, with room to add more kinds later without rearchitecting; per-domain prompts + per-domain constellations keep kinds independent so shipping a new one never risks the others |
| D23 | **Admin assigns a model per feature/purpose, not one global default** (2026-07-02, answers "which model should power which action"): extend the admin model catalog (R13/Phase 9) with a **feature-key → model** mapping (mirrors the D12 `prompt_key` pattern) — e.g. `resume.parse`, `knowledge.first`, `calibration`, `company.pack`, `interview.technical`, `interview.hr`, `personalization.distill` — each resolves to an explicitly-assigned model or falls back to the single global default (today's `models.is_default`) when unset, so existing behavior needs zero admin action to keep working. | Owner wants cheap/fast models on cheap actions (resume parse, calibration) and stronger models where quality matters (interviews); one global default can't express that |

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
  only works on an OpenAI/Gemini path, never on Claude. **OWNER DECISION (2026-06-25): ship
  accent-aware voice via the editable transcript only for now; native audio-in is deferred** (no
  OpenAI/Gemini audio path yet). Revisit if/when an audio provider becomes a priority. See D17.
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
  4. ~~**Phase 14 — Admin-managed versioned prompts + guardrails** (D12, D13)~~ ✅ **shipped 2026-06-26.**
  5. ~~**Phase 15 — Dynamic company skill packs** (D10)~~ ✅ **shipped 2026-06-26.**
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

### Phase 4 — Personalization engine ("it knows me") — core shipped 2026-06-27
- [x] Event log: lifecycle + steering actions appended per profile (`user_events`, migration 0007):
      profile_created / calibration / interview_started / interview_finished / preference.
- [x] User-model document distilled by LLM after each session; injected into all prompts (D2).
      `user_models` (1:1 per profile); re-distilled in `finishInterview` from prior model + recent
      events + the fresh report (`personalization.distill` versioned prompt). Injected as a code-level
      block in `renderInterviewSystem`/`renderCoachingSystem` (applies on every prompt version, like the
      R23 evidence block). Best-effort — a distill failure never blocks finishing the interview.
- [x] Interactive micro-prompts — one-tap steering chips in the interview composer (harder / ease up /
      more system design / more behavioral / explain). Each sends a request the interviewer honors now
      AND records a `preference` event the distiller learns from (`messageSchema.preference`).
- [x] "What we know about you" page (`web/src/pages/Memory.tsx`, topbar 🧠 you) — read the distilled
      model + recent activity, **correct** it by hand (marked `edited`; folded back into the next
      distill), or **delete** it (D6). `GET/PUT/DELETE /api/me/model`, resolves the active profile.
- [ ] **Capability tiers for BYOK consistency (D3)** — DEFERRED: distinct from personalization (it's
      about output parity across a $5 Haiku key vs an Opus key). Worth its own slice; flagged at the gate.
- Verified: `make check` + `make e2e` green; `scripts/verify-ph4.mjs` proves events→distill→inject→
  chips→read/correct/delete end-to-end on the mock provider.
- **Gate: owner reviews before next phase** (Phase 5 resume/opportunity, Phase 7 learn-while-interviewing,
  or finish Phase 4 with capability tiers).

### Phase 5 — Resume & opportunity pipeline
> **R31 (owner 2026-07-02, Phase 23) specifies the first bullet below**: CV upload + LLM extraction
> becomes the *default* onboarding path (manual Q&A is the fallback/edit path), not just an added option.
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
- **Follow-up (owner 2026-07-02, D21/R32):** the free-intro rule changes from "unlimited free
  calibration" to a **shared 3-per-user "first impression" credit** covering resume-check,
  company/knowledge lookup-or-generation, first-knowledge-build, and calibration — touching any one
  (even partially) burns 1 of 3. Needs a new per-user counter + an `enforceEntitlement` update. Full
  interviews/coaching stay paid-host-credit / BYOK / local-CLI, unchanged. Tracked in **Phase 23**.

### Phase 14 — Admin-managed versioned prompts + guardrails (D12, D13) ✅ (2026-06-26)
- [x] Moved prompts from `server/src/prompts.ts` constants into a DB table (`prompts`,
      migration `0004`): `prompt_key` → many **versions** (body, author, active flag). The
      bodies are now **templates** with `{{PLACEHOLDER}}` tokens; code injects the dynamic,
      non-editable data (profile, skill pack, weaknesses, reply-style, transcript).
- [x] Admin UI (`Admin.tsx` "System prompts"): pick a prompt → edit body → **Save as new
      version** (auto-activates); **version history** with one-click **roll back to vN**.
      `GET/POST /api/admin/prompts[/:key][/activate]`. Placeholder hints shown in the editor.
- [x] Code ships the **seed/default version** (`PROMPT_SEEDS`, author 'seed', v1); seeded on
      boot for any missing key. `db.activePromptBody(key)` returns the active body (DB wins,
      seed is the defensive fallback so a model call never runs prompt-less).
- [x] **Guardrail frame** (D13): a fixed, non-editable wrapper (`wrapGuardrail`) around the
      interview + coaching system prompts — four immutable governance rules that pin the model
      to the interview task and treat candidate text as data, never instructions (resists
      "ignore previous instructions", role swaps, prompt-leak, topic changes). Admin bodies sit
      *inside* the frame; calibration/grade/evaluation seeds also carry an untrusted-input note.
      Template fill is single-pass (candidate-authored profile text can't inject placeholders).
- [x] Red-team test set (`server/test/guardrail.test.mjs`, `npm run test:guardrail`) — jailbreak
      strings proven structurally enclosed by the frame; wired into `make check` + CI.
- **Gate: owner reviews before Phase 15 (dynamic company packs).**
- Note: tests are *structural* (no live model) — they guard the construction seam an attacker
  targets; live-model red-teaming needs a real provider and is out of CI scope.

### Phase 15 — Dynamic company skill packs (D10) ✅ (2026-06-26)
- [x] On unknown company: the model drafts a structured pack. **Web search (D16) is wired via
      Anthropic's hosted `web_search` tool** when the generating call is on an Anthropic key
      (`providers.ts` `ChatOptions.webSearch`; `searched` provenance flag); other providers draft
      from model knowledge. The generation prompt is a **versioned prompt** (`company.pack`, Phase 14).
- [x] Packs stored in DB (`company_packs`, migration `0005`), **cached + reused across users**
      (slug-normalized so "Stripe"/"stripe Inc" hit one row); the 4 static `skills/*.md` seeded in
      on boot as `source: 'seed'` (markdown body kept). `skills.ts` is now seed-only.
- [x] Admin review queue (`Admin.tsx` "Company packs", `/api/admin/packs*`): edit body, publish/
      unpublish, **regenerate** (re-draft, search-augmented), delete; **staleness** badge at >90d.
- [x] Interview setup uses the stored pack — **generate-on-miss** (`POST /api/packs/ensure`) wired
      into ProfileSetup ("…name your target company — we'll research it"), then cached; interviews
      resolve the published pack by id/slug.
- **Product call (owner, flag at gate):** packs auto-generate on miss and are **used immediately**
      (best UX/scale); the admin queue is *post-hoc* quality control, not an approval gate. Free-intro
      users may generate a pack during onboarding (counts against the free budget; cost amortizes since
      packs are shared). Generation capped at 1500 tokens.
- **Gate: owner reviews before Phase 16 / Phase 17 R22–R23.**

### Phase 16 — Accent-aware voice (D15 / D17)
- [x] Stop auto-sending raw STT. Add an **editable transcript** the user confirms before send
      (universal fallback). Shipped 2026-06-25: in voice mode the mic dictates into an editable
      composer; the user reviews/edits, then Sends (`web/src/pages/Interview.tsx`).
- [ ] ~~Send **audio directly to the model**~~ **DEFERRED (owner, 2026-06-25):** native audio-in is
      provider-gated (Claude can't take audio; only OpenAI `gpt-4o-audio`/realtime + Gemini). Owner
      chose editable-transcript-only for now — revisit when an audio provider becomes a priority.
- [ ] ~~Capability detection: audio-native vs. editable-transcript per model~~ — deferred with the above.
- **Phase 16 closed for now** (editable transcript shipped; native audio deferred per owner).

### Phase 17 — UX, fuzzy targets, multi-profile & evidence-gating (R21–R24, owner 2026-06-25)
- [x] **R21 Back navigation** ✅ (2026-06-25): shared "← Back" rendered in the app shell for
      setup/plan/profile/calibration, gated on the user having a calibrated profile (so it never
      dead-ends during first-run onboarding). One place in `App.tsx`, no per-page edits.
- [x] **R22 Fuzzy/tiered target** ✅ (2026-06-26): when the company is unknown, the user picks a
      **Tier** (Tier 1 = FAANG-bar / Tier 2 = high-growth scale-up / Tier 3 = established-general)
      instead of an exact name. Tiers are seeded as company packs (`source: 'tier'`, stable
      `tier-N` slugs, `TIER_SEED_PACKS` in `skills.ts`) so they ride the Phase 15 pack pipeline —
      picking a tier attaches its playbook to the profile and calibrates the interview to that bar.
      ProfileSetup shows tier cards under a free-text company box; `/api/skills` now returns `source`
      so the UI splits tiers from companies. Builds on Phase 15 company packs (D10).
- [x] **R23 Evidence-gated knowledge** ✅ (2026-06-26): self-reported skills become `skill_claims`
      (migration 0006) that start **`unverified`** and only flip to **`demonstrated`** / **`weak`**
      when an interview's evaluation finds evidence. The interviewer is told (in code, version-proof
      like the guardrail) to treat claimed skills as unverified and probe them; the evaluator returns
      a `skill_evidence` verdict per claimed skill that `finishInterview` applies (a demonstrated skill
      never downgrades on a later session). Dashboard shows a "shown vs. claimed" readout; `/profile`
      returns `skill_claims`. Ties into calibration (R6) and weakness detection (R7).
- **Phase 17 complete** (R21 ✅, R22 ✅, R23 ✅, R24 ✅). **Gate: owner reviews.**
- [x] **R24 Multiple profiles per user** ✅ (2026-06-25): `users.active_profile_id` (migration 0003,
      `: AnyPgColumn` annotation to break the users↔profiles circular-FK type cycle); `GET /api/profiles`
      + `POST /api/profiles/:id/select`; profile/weaknesses/progress resolve the **active** profile
      (falls back to latest when unset); creating a profile makes it active; Dashboard switcher pills +
      New. Existing single-profile users unaffected.

---

## Phases 18–22 — owner additions 2026-06-27 (R25–R29)

> Theme: make **ArvanCloud** the production host (provider + k8s + metrics), tighten money-critical
> metering, sharpen the admin UX, and future-proof the NL data. **Recommended order:** 18 → 19 → 20,
> then 21 (deploy) → 22 (metrics) once the owner provides the kubeconfig. 18 & 19 ride the existing
> models/metering/prompt stack and unlock real (Arvan-billed) usage; 20 is independent and can slot
> anywhere; 21/22 are explicitly "later / after that" per the owner.

### Phase 18 — ArvanCloud host provider + complete metering (R25, D19) — shipped 2026-06-27
- [x] Per-model **configurable base URL + auth scheme**: refactored the `openai` path into a shared
      `chatOpenAICompatible` fn; added an **`arvan`** provider (endpoint = the per-model gateway URL up
      to `/v1` + `/chat/completions`; `Authorization: apikey <key>`; body uses `max_tokens`). `models`
      gains a `base_url` column (migration 0008), threaded through `modelConfig`→`AppConfig.baseUrl`.
      Admin "Add model" exposes provider `arvan` + a gateway-URL field; validate-key reuses the path.
- [x] **Metering correctness + safety net** (R25): usage is read from `prompt_tokens`/`completion_tokens`
      (Arvan also returns a misleading Anthropic-style `output_tokens: 0` — ignored). If a host call
      reports zero usage, fall back to a char-estimate so **no host token is ever recorded as 0**. Every
      host call already routes through `runModel`/`recordUsage` (interview, calibration, evaluation,
      **company-pack generation**, **post-interview distillation**). Locked by `server/test/metering.test.mjs`
      (uses the real Arvan `usage` sample) + `scripts/verify-arvan.mjs` (stub server proves endpoint/auth/body/usage).
- [x] Streamed usage: we set `stream_options.include_usage`; if a gateway omits it, the zero-usage
      fallback covers cost. (Live confirmation that Arvan returns streamed `usage` is an owner-side check.)
- [ ] Admin-visible **per-event** usage audit (who/when/model/in-out/cost) — folds into the Phase 19
      dashboard (today the admin sees per-user aggregates via `/api/admin/users`).
- **Gate: owner reviews.** Owner action: add an Arvan model in Admin (gateway URL + apikey + per-MTok prices).

### Phase 19 — Admin dashboard upgrade (R26)
- [ ] Model+price management tuned for Arvan: base URL, per-MTok input/output price, enable/default,
      live key rotation — minimal-friction add/edit (extends the R13 admin model catalog).
- [ ] System-prompt version UX: list versions with **diff/compare**, preview the rendered frame, one-tap
      **activate/rollback** (extends R17). Make prompt iteration genuinely easy for a non-engineer admin.

### Phase 20 — Future-proof NL datastore + lazy migration (R27, D18)
- [ ] Add a `schema_version` to NL-bearing records; move free-form bodies toward **JSONB** structured-NL.
- [ ] A **lazy migrator**: on a user's first interaction after a release, transform their stale-version
      records to the new shape — deterministic transforms first, **our-API** semantic reshape only when
      needed (dedicated migration prompt; never the user's key); idempotent + backgroundable.
- [ ] (Deferred sub-track) RAG/retrieval over company/user knowledge — a *separate* feature, not the
      migration mechanism (D18).

### Phase 21 — Deploy to ArvanCloud Kubernetes (R28)
- [ ] Containerize server (+ built web) and provide k8s manifests/Helm: managed Postgres, secrets
      (`SENIORBRO_SECRET`, host keys), ingress + TLS, health/readiness probes. Deploy via owner's kubeconfig.
- **Gate:** owner provides the kubeconfig before this starts.

### Phase 22 — Observability: Prometheus + Grafana on Arvan (R29)
- [ ] `/metrics` endpoint (app + runtime + usage: token burn, cost, latency, errors, active users).
- [ ] Prometheus + Grafana in the cluster; ship starter dashboards + alerts. Follows Phase 21.

---

## Phases 23–24 — owner additions 2026-07-02 (R31–R34)

> Theme: CV-first onboarding, a capped shared free tier, and multiple interview kinds (technical + HR,
> extensible) with their own prompts and gamification. **Recommended order:** 23 first — it touches
> onboarding and the free-tier gate everything else sits behind — then 24, which is net-new and
> independent but reads better once onboarding is CV-first.

### Phase 23 — CV-first onboarding + shared free-tier credit (R31, R32, R35, R36, D21, D23)
- [ ] R31: CV upload (PDF/text) → LLM extraction into profile fields (job target, company/tier,
      technologies, seniority signals); manual Q&A becomes the fallback/edit path, not the default.
      No format/provider constraint from the owner — accept PDF at minimum; which model parses it is
      an R35 per-feature routing choice, not hardcoded.
- [x] **R32: Shared 3-per-user "first impression" free tier** ✅ (2026-07-02). Redefines Phase 13's
      unconditional 30k-token free level-check (D21): a `free-intro` user now gets `FREE_IMPRESSION_LIMIT`
      (3) free first impressions, one per **profile/position** they onboard. Implementation ties the
      credit to the profile: `profiles.first_impression_at` (migration 0009) is set the first time a
      free onboarding action (calibration today; resume/company-knowledge fold in with R31) runs on that
      profile. Already-set profiles stay free forever (re-checking a position never re-burns);
      `firstImpressionCount(user) >= 3` → 402. `enforceEntitlement` now takes the profile id and
      consumes/checks the slot (ownership verified first so a credit can't be spent on another user's
      profile). Full interviews stay plan-gated. `/api/usage` reports `first_impressions_used/limit`;
      Plan page shows "N/3 used". Locked by `scripts/verify-ph23.mjs` (16 assertions, hosted mock).
- [x] **R36: `DELETE /api/profiles/:id`** ✅ (2026-07-02). Deletes a profile/position; children
      (interviews, weaknesses, skill-claims, events, calibrations, user-model) cascade at the DB via
      `profile_id`; `users.active_profile_id` nulls out so `activeProfile()` falls back to the latest.
      Dashboard shows a per-profile delete (✕) with a confirm; deleting frees a first-impression slot
      (R32). Cross-user delete is a 404 (isolation intact — proven in `verify-ph23.mjs`).
- [ ] R35: Per-feature model routing (D23) — groundwork, not a hard blocker (falls back to today's
      single global default if the admin assigns nothing per-feature).
- **Sub-gate (2026-07-02):** R32 + R36 shipped & verified — the free-tier business-model change (the
  owner's stated conflict-resolution priority) + delete. Remaining Phase 23 work: R35 then R31 (CV).
- **Gate:** owner reviews the free-tier UX (how "2 of 3 first impressions left" is communicated, and
  the delete-position confirmation copy) before it ships.

### Phase 24 — Interview kinds: technical + HR, extensible (R33, R34, D22)
- [ ] R33: a domain field on interviews (`technical` seed, `hr` new) — **a new column**, not the
      existing `interviews.kind` (already `full`/`coaching`, unrelated — don't overload it). User
      picks a domain when starting; each domain gets its own versioned system prompt key (rides D12)
      — adding a domain later is a registry entry, not a rewrite.
- [ ] **HR prompt structure** (owner 2026-07-02) — three question pools composed per session, not
      exhaustively asked from each (keeps the interview from ballooning in length):
      1. **Fixed core** — present in every HR interview (opening rapport-building, closing/wrap-up).
      2. **General pool** — universal HR topics (conflict resolution, teamwork, motivation, etc.) —
         a **random subset** sampled each session.
      3. **Company-specific pool** — culture/values questions sourced from the target's company pack
         — **deterministic, not random** (drawn when the profile has a company pack; skipped otherwise).
- [ ] R7 (weakness detection) and R23 (evidence-gated skill claims) **apply to HR exactly as they do
      to technical** (owner 2026-07-02: "should be applied like in tech it did") — same mechanism,
      HR-flavored content, no separate scoring axes.
- [ ] R34: Per-domain gamification constellation (extends D7/Phase 6); a domain's constellation/
      dashboard section is hidden until the user has evidence for it (no empty HR constellation for a
      technical-only user, and vice versa).
- **Gate:** owner reviews the actual HR general-question pool + company-specific tie-in before ship.

---

## Working agreement recap

1. One phase at a time; owner reviews at every gate.
2. Verification gate before any commit: `make check` (typecheck + build + smoke + lint).
   Run `make e2e` when a UI flow changed. From Phase 11, `make check` also needs Postgres up.
3. Mark checkboxes here, log milestones in `memory/`, keep `CLAUDE.md` architecture section current.
