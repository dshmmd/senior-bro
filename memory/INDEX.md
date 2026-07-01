# Memory Index

One entry per completed milestone. Read this before working on the repo.

- [2026-06-11 — v0.1 foundation shipped](2026-06-11-v0.1-foundation.md) — full
  working app: server, web, voice, calibration, interviews, evaluation,
  weaknesses, coaching, 4 skill packs. All plan items P1–P8 done.
- [2026-06-11 — Phase 1: landing page](2026-06-11-phase1-landing.md) — ROADMAP.md
  created (persistent product plan); cursor-aware 3D landing (custom canvas particle
  engine), responsive pass, Makefile. Owner approved.
- [2026-06-13 — Phase 2: production hardening](2026-06-13-phase2-hardening.md) —
  SSE streaming replies + sentence-by-sentence TTS, mock provider, zod validation,
  rate limit, structured logs, ErrorBoundary/offline UX, strict ESLint+Prettier,
  GitHub Actions CI, Playwright E2E. Owner approved (CI green).
- [2026-06-24 — Phase 6: gamification](2026-06-24-phase6-gamification.md) —
  constellation skill map (canvas), `GET /api/progress`, medals/streak/heatmap/level
  trail. Built out of order at owner request. Owner decided dual+hosted-first
  (deploy target 95.38.235.93, gated on Phase 3).
- [2026-06-24 — Subscription auth + continuity](2026-06-24-subscription-auth-and-continuity.md) —
  `claude-cli`/`codex-cli` providers so a Pro/ChatGPT subscription powers the app
  with no API credits (local only; D8). CLAUDE.md "▶ START HERE" + `/continue`
  command so any session resumes with full context.
- [2026-06-24 — Phase 3: accounts & hosted mode](2026-06-24-phase3-accounts-hosted.md) —
  `SENIORBRO_MODE=local|hosted`; magic-link accounts + sessions, per-user data isolation
  (`user_id` migration), per-user provider config encrypted at rest (AES-256-GCM). Local
  mode unchanged. Unblocks deploy to 95.38.235.93; R13 admin/metering (Ph 8/9) still pending.
- [2026-06-25 — R13 admin + metering slice](2026-06-25-r13-admin-metering-slice.md) —
  Phase 9 admin (model/key catalog, user quotas, usage console) + Phase 8 metering
  (`chat()` returns token usage; `usage_events`; per-call cost; 402 over quota). Admin
  curates models, users pick one (host key) or BYOK. R13 functional end-to-end.
- [2026-06-25 — Owner re-planning D9–D15](2026-06-25-owner-replanning-d9-d15.md) —
  docs-only. New scope: Postgres/Docker store (supersedes node:sqlite + zero-deps rule),
  dynamic company packs, plans + invite codes, admin-versioned prompts + guardrails,
  resumable sessions, accent voice. Phases 11–16; recommended next = **Phase 11 (Postgres)**.
- [2026-06-25 — Phase 11: Postgres + Drizzle](2026-06-25-phase11-postgres-drizzle.md) —
  retired node:sqlite for **PostgreSQL (Docker) via Drizzle ORM**; async db layer behind the
  same function names; docker-compose + Make/CI/e2e wired to Postgres; sqlite→pg import script.
  make check + e2e + hosted curl all green on PG. Next = **Phase 12 (identity & resume)**.
- [2026-06-25 — Phase 12: Identity & resumable sessions](2026-06-25-phase12-identity-resumable.md) —
  resume an interrupted interview from the server transcript (`resumeId` in `Interview`, Dashboard
  resume banner + `DELETE /api/interviews/:id` discard); "Welcome back" greeting; DB-level FKs +
  indexes (migration 0001) for per-user partitioning. R15 done. Next = **Phase 13 (plans & invite codes)**.
- [2026-06-25 — Phase 13: Plans, gating & invite codes](2026-06-25-phase13-plans-gating-invites.md) —
  `users.plan` + `invite_codes` (migration 0002); hosted gating via `enforceEntitlement` (free-intro
  level-check on the default model under a 30k budget → interviews paywalled until a plan); mocked
  checkout + single-use invite redeem grant token credit; web `Plan.tsx` (topbar 💳) + admin invites.
  Local mode unrestricted. R18 done. Hosted verified by `scripts/verify-ph13.mjs`. Next = **Phase 14 (versioned prompts + guardrails)**.
- 2026-06-25 — Voice editable transcript (R20, commit `3283d9f`) — voice no longer auto-sends raw
  STT; the mic dictates into an editable box the user confirms before sending. Native audio deferred
  by owner (Claude can't take audio; only OpenAI/Gemini). See ROADMAP D17/Q6.
- [2026-06-25 — R24: Multiple profiles per user](2026-06-25-r24-multiple-profiles.md) —
  `users.active_profile_id` (migration 0003, `AnyPgColumn` to break the circular-FK type cycle);
  `/api/profiles` + `/select`; active-profile resolution; Dashboard switcher. Includes the
  feat/test→main fast-forward reconciliation note. R24 done. Next = **Phase 14, or Phase 17 R21–R23**.
- [2026-06-26 — Phase 14: Versioned prompts + guardrails](2026-06-26-phase14-versioned-prompts-guardrails.md) —
  prompts moved into the DB (`prompts` table, migration 0004), admin-editable + versioned with
  rollback (`Admin.tsx` "System prompts", `/api/admin/prompts*`, `db.activePromptBody`); seed bodies
  are `{{PLACEHOLDER}}` templates; fixed `wrapGuardrail` frame around interview/coaching (anti-jailbreak);
  red-team CI test. R17 + R19 done. Next = **Phase 15 (dynamic company packs), or Phase 17 R22/R23**.
- [2026-06-26 — R23: Evidence-gated knowledge](2026-06-26-r23-evidence-gated-knowledge.md) —
  self-reported skills become `skill_claims` (migration 0006) that start `unverified` and flip to
  `demonstrated`/`weak` only when an interview's `skill_evidence` shows it; interviewer probes claims
  (code-level frame); Dashboard "shown vs. claimed". **Closes Phase 17.** All owner phases 11–17 done.
- [2026-06-26 — R22: Tiered target](2026-06-26-r22-tiered-target.md) —
  pick a **Tier** (1/2/3 = FAANG-bar/scale-up/general) when the company is unknown; tiers seeded as
  `source:'tier'` company packs (`TIER_SEED_PACKS`, stable `tier-N` slugs) reusing the Phase 15
  pipeline; ProfileSetup tier cards; `/api/skills` returns `source`. No migration. R22 done.
  Next = **R23 (evidence-gated knowledge)** to close Phase 17.
- [2026-06-27 — Phase 18: Arvan host provider + metering](2026-06-27-phase18-arvan-provider.md) —
  `arvan` OpenAI-compatible provider (per-model gateway base URL in path + `apikey` auth + `max_tokens`);
  `models.base_url` (migration 0008); shared `chatOpenAICompatible`. Metering reads prompt/completion
  tokens (ignores Arvan's `output_tokens:0`) with a zero-usage→char-estimate fallback (R25). Tests:
  `metering.test.mjs` + `scripts/verify-arvan.mjs`. Owner: add an Arvan model in Admin. (R25/D19)
- [2026-06-27 — Phase 4: Personalization core](2026-06-27-phase4-personalization.md) —
  per-profile event log (`user_events`) + LLM-distilled "user model" (`user_models`, migration 0007)
  re-distilled after each interview (`personalization.distill` prompt) and injected into interview/
  coaching prompts as a code-level block; one-tap steering chips record `preference` events; "what we
  know about you" page (`Memory.tsx`, 🧠 you) read/correct/delete (`/api/me/model`). D3 capability tiers
  deferred. `scripts/verify-ph4.mjs` green. **All owner phases + Phase 4 core done.**
- [2026-06-26 — Phase 15: Dynamic company packs](2026-06-26-phase15-dynamic-company-packs.md) —
  company packs moved into the DB (`company_packs`, migration 0005); generate-on-miss
  (`POST /api/packs/ensure` → model draft, Anthropic `web_search` D16) cached + reused (slug-keyed);
  4 `skills/*.md` now seed-only (`loadSeedPacks`); admin "Company packs" review queue (edit/publish/
  regenerate/delete + staleness); `company.pack` versioned prompt. R14 done. Packs auto-use; admin = post-hoc QC.
  Next = **Phase 16 (voice, ~closed) or Phase 17 R22/R23**.
- [2026-07-02 — Phase 23 (partial): first-impression free tier + delete profile](2026-07-02-phase23-first-impression-free-tier.md) —
  **R32** redefines the free tier: 3 shared "first impressions" per user, tied to profiles via
  `profiles.first_impression_at` (migration 0009); `enforceEntitlement(profileId)` consumes/checks the
  slot (ownership verified first); re-checking a position never re-burns; `/api/usage` +
  Plan page report N/3. **R36** `DELETE /api/profiles/:id` (cascades, frees a slot, 404 cross-user) +
  Dashboard ✕. Verified by `scripts/verify-ph23.mjs` (16 assertions). **Remaining Phase 23:** R35
  (per-feature model routing) then R31 (CV onboarding).
- [2026-07-02 — R35: per-feature model routing (D23)](2026-07-02-r35-per-feature-model-routing.md) —
  admin assigns a model per *feature* (`feature_models` migration 0010 + `server/src/features.ts`
  registry); `resolveCall(user, feature?)` routes platform-funded calls (host + free-intro), **BYOK
  never routed**, unassigned → global default. Admin "Feature model routing" UI + `GET/PUT
  /api/admin/feature-models`. Verified by `scripts/verify-ph35.mjs` (routing proven via metering cost).
  **Remaining Phase 23:** R31 (CV onboarding — routes CV parse through the new `resume.parse` feature).
