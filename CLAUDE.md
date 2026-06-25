# Senior Bro — AI Interview Coach

Hosted-first AI interview platform (still runs locally for dev). The user tells us
the job + company they want, we research that company, calibrate their level with a
free short interview, then run a realistic voice-or-text interview tuned to them,
detect weaknesses, and coach them until they're ready. Powered by **our host models
(paid)**, the user's **own API key (free)**, or their **Claude/ChatGPT subscription
via the local CLI (free, local only)** — see plans in ROADMAP D11.

> **2026-06-25 owner re-planning in flight (D9–D15, Phases 11–16).** Several rules
> below are superseded — durable Postgres store on Docker (**D9 ✅ Phase 11 shipped** —
> `node:sqlite` retired), dynamic company-pack generation (D10, supersedes "one company =
> one file"), admin-managed versioned prompts (D12, prompts leave `prompts.ts`). Read
> ROADMAP Phases 11–16 before new work. **Phases 12 & 13 ✅ shipped** (12: resumable interviews +
> returning-user "welcome back" + DB-level FKs/indexes; 13: plans/gating + free level-check +
> mocked checkout + invite-code credit). **Phase 16 voice** (R20) shipped (editable transcript;
> native audio deferred). **Phase 17 partial:** R21 (Back nav) + R24 (multi-profile) ✅; **remaining
> R22 (fuzzy/tiered target) + R23 (evidence-gated knowledge)**. **Next up = Phase 14 (versioned
> prompts + guardrails), or finish Phase 17 R22/R23.**

## ▶ START HERE — when the owner says "continue"

Do this, in order, before writing any code. It rebuilds full context in ~1 min:

1. Read **`ROADMAP.md`** top-to-bottom — it has the vision, the decisions
   (D1–D15), open questions, the phase checklist (Phases 0–16), and the owner-directed
   build order. Phases 11–16 are the current owner-directed scope.
2. Read **`memory/INDEX.md`** and the newest `memory/*.md` entry — what's done, why,
   and the gotchas.
3. Run **`make check`** to confirm the tree is green before changing anything.
   **Requires Docker running** — data is in PostgreSQL via `docker compose`; the `make`
   targets auto-run `db-up`. If Docker is down, start it (or `make db-up`) first.
4. Pick the work: honor the "Build order (owner-directed)" note in ROADMAP if
   present; otherwise take the lowest unfinished phase. Each phase ends at an
   **owner-review gate** — finish the phase, verify, push, then stop and summarize.
5. As you finish items: tick `[x]` in ROADMAP, add a `memory/` entry, keep this
   file's architecture section current. Verify with `make check` (+ `make e2e` for
   UI flows) before every commit. Only commit/push when the work is complete & green.

Current status is always the bottom-most ✅ phase in `ROADMAP.md`.

## How to work in this repo (agent rules)

0. **`ROADMAP.md` is the live product plan.** Read it + `memory/INDEX.md` first;
   continue the lowest unfinished phase unless the owner says otherwise.
0a. **Reporting style (owner, 2026-06-25):** the owner wants **results and important
   notes/questions only — not a technical play-by-play**. Lead with the outcome; surface
   blockers, decisions, and questions. Put durable decisions/findings in `ROADMAP.md` /
   `CLAUDE.md` so every agent sees them, rather than only in chat.
1. Read `memory/INDEX.md` before starting any task — it records what is done and why.
2. When a plan item below is completed, mark it `[x]` here AND append a short
   entry to `memory/` (one file per milestone, linked from `memory/INDEX.md`).
3. Verification gate before any commit: `make check` (lint + typecheck + build + smoke).
   Run `make e2e` too when a UI flow changed. **`make check` needs Docker/Postgres up**
   (the `make` targets run `db-up` first; `make db-up` starts the container).
4. One language everywhere: TypeScript. Server data lives in **PostgreSQL (Docker)** via
   **Drizzle ORM** (`server/src/schema.ts` + generated `server/drizzle/` migrations); db
   queries are async. Deps that buy real robustness are fine (D9 retired the zero-deps rule
   for the server); still avoid gratuitous ones. The web app keeps its tiny-bundle discipline (D1).
5. User-facing strings live in the React components. ~~Prompts live in `prompts.ts`~~
   **Being superseded by D12:** prompts move into the DB (admin-editable, versioned); code
   ships the seed/default version. Until Phase 14 lands, `server/src/prompts.ts` is still
   the source of truth.
6. ~~Company knowledge = one `skills/*.md` file per company~~ **SUPERSEDED by D10:** company
   packs are **generated on demand** (web search → draft → stored in DB → admin review) and
   cached/reused. The 4 `skills/*.md` are the initial seed. Never hardcode company specifics
   in code.

## Requirements (from the product owner)

- [x] R1: User states the job position they're applying for
- [x] R2: Full interview powered by the user's own AI token (BYOK)
- [x] R3: Voice talking (speech-to-text + text-to-speech)
- [x] R4: Text chat mode as an equal alternative to voice
- [x] R5: Onboarding asks company / technology / skill details
- [x] R6: Calibration quiz to grade the user's level before interviewing
- [x] R7: Weakness detection + targeted coaching to fix weaknesses
- [x] R8: Multiple question kinds (behavioral, technical, system design, coding, situational)
- [x] R9: Company interview sources converted into "skill packs" for personalized interviews
- [x] R10: Installable by non-technical people (brew/npx), paste token, pick provider
- [x] R11: Provider choice: Claude (primary) and OpenAI
- [x] R12: Use a subscription (Claude Pro/ChatGPT) via local CLI — no API key (D8)
- [x] R13: **Admin panel for a hosted deploy** — admin manages API keys per model;
  users pick from admin-curated options; usage metering + per-user token limits.
  Vertical slice shipped 2026-06-25 (`server/src/admin.ts`, `models`/`usage_events`
  tables, `/api/admin/*` + `/api/models` + `/api/usage`, web `Admin.tsx`). Adding/
  removing a model, swapping its key, or changing a quota are live admin-UI actions
  (no redeploy). Remaining (ROADMAP Ph 8/9): billing/checkout, audit log, suspend,
  quota periods, skill-pack admin, agent console.

### Re-planning 2026-06-25 — next requirements (ROADMAP Phases 11–16, D9–D15)
- [ ] R14: **Dynamic company packs** — research an unknown company on demand (web search →
  domain + role interview process), store + cache + reuse; admin review. (D10 · Phase 15)
- [x] R15: **Returning users + resumable sessions** — recognized every visit; leave an
  interview and resume it later exactly where it stopped. (D14 · Phase 12 ✅ 2026-06-25)
- [ ] R16: **Durable per-user datastore for the long term** — PostgreSQL in Docker, typed
  migrations, strict per-user partitioning. (D9 · Phase 11)
- [ ] R17: **Admin-managed, versioned system prompts** — edit/improve in the admin UI with
  version history + rollback; guardrail frame stays fixed. (D12 · Phase 14)
- [x] R18: **Plans & gating** — free short level-check, then choose a plan: host-models (paid,
  mocked payment) / BYO key (free) / local CLI (free); **admin-minted invite codes** carry
  credit. (D11 · Phase 13 ✅ 2026-06-25)
- [ ] R19: **Prompt guardrails** — users can't steer the model off the interview task
  (prompt-injection / jailbreak resistance). (D13 · Phase 14)
- [x] R20: **Accent-aware voice** — editable transcript the user confirms before sending (no more
  auto-sent raw STT). Shipped 2026-06-25 (voice dictates into an editable box; user reviews/edits,
  then sends). Native audio-in (model hears the voice) **deferred by owner 2026-06-25** —
  provider-gated (Claude can't take audio; only OpenAI gpt-4o-audio/realtime + Gemini). (D15/D17 · Phase 16)

### Owner additions 2026-06-25 (R21–R24)
- [x] R21: **Back navigation** — shared "← Back" in the app shell on settings/onboarding screens
  (setup/plan/profile/calibration), shown once the user has a calibrated profile so it's never a
  dead end. Shipped 2026-06-25 (`web/src/App.tsx`). (Phase 17)
- [ ] R22: **Fuzzy / tiered target** — if the user doesn't know the exact company, let them pick a
  **Tier 1 / Tier 2 / …** (FAANG-tier, top-startup, mid, etc.) so setting a target is easy; the
  generated pack targets that tier's bar. Extends company packs (D10 · R14 · Phase 15/17).
- [ ] R23: **Evidence-gated knowledge** — don't accept a skill/claim from the user as true until
  they've actually answered questions demonstrating it; the profile/level reflects *shown*
  ability, not self-report. (Phase 17, ties into calibration R6 + weaknesses R7)
- [x] R24: **Multiple profiles per user** — keep several profiles (different stack/seniority) and
  switch between them. Shipped 2026-06-25: `users.active_profile_id` (migration 0003), `/api/profiles`
  + `/api/profiles/:id/select`, profile/weaknesses/progress read the *active* profile, Dashboard
  switcher pills + New. (Phase 17)

## Architecture

```
senior-bro (npm workspace monorepo)
├── server/   Hono + PostgreSQL (Drizzle ORM, Docker). Serves API + built web app. Port 4747.
│   ├── src/index.ts      entry: static serving + API mounting
│   ├── src/mode.ts       SENIORBRO_MODE=local|hosted (local = single implicit owner)
│   ├── src/schema.ts     Drizzle table definitions (10 tables, FKs+indexes); migrations in server/drizzle/
│   ├── src/db.ts         async Drizzle queries (DATABASE_URL); migrate+seed on boot; users/
│   │                     sessions/magic_links + per-user config + isolation + models + usage_events
│   │                     + plans/credit (users.plan, token_quota) + invite_codes (D11)
│   ├── src/config.ts     AppConfig type + legacy config.json reader (migrated into db)
│   ├── src/crypto.ts     AES-256-GCM secret encryption (api keys at rest), random tokens
│   ├── src/auth.ts       hosted magic-link sessions, requireUser/currentUser, sb_session cookie
│   ├── src/admin.ts      requireAdmin guard (local owner + SENIORBRO_ADMIN_EMAILS)
│   ├── src/mailer.ts     dependency-free magic-link delivery (log + optional webhook)
│   ├── src/http.ts       shared HttpError
│   ├── src/providers.ts  LLM abstraction: anthropic | openai | claude-cli | codex-cli | mock
│   │                     (chat() returns text + token usage for metering)
│   ├── src/prompts.ts    ALL system prompts & evaluation rubrics
│   ├── src/skills.ts     loads skills/*.md company packs
│   └── src/routes.ts     REST API (per-user; /auth/* in hosted mode)
├── web/      React + Vite SPA
│   ├── src/voice.ts      Web Speech API wrapper (STT + TTS)
│   ├── src/api.ts        typed client for server API (cookie-authed)
│   └── src/pages/        Login(hosted) → Profile → Calibration(free level-check) → Plan(hosted gate) →
│                         Setup → Interview → Report → Dashboard; Plan = plans/mock-checkout/invite redeem;
│                         Admin(hosted, role=admin): model/key mgmt, user quotas, usage, invite codes
├── skills/   company interview packs (markdown + frontmatter)
└── memory/   milestone log (INDEX.md + one file per milestone)
```

Key flows:
- **Calibration**: LLM generates 5 questions from profile → grades answers → level (junior/mid/senior/staff).
- **Interview**: phased state machine in the system prompt (warmup → behavioral →
  technical → deep-dive → wrap). Model returns plain conversational text; a separate
  evaluation call at the end returns strict JSON (scores, weaknesses, advice).
- **Weaknesses**: stored per-user, injected into the next interview's system prompt,
  and drillable in Coaching mode.

## Plan

- [x] P1: Monorepo scaffold (workspaces, tsconfig, scripts, CI-able verification)
- [x] P2: Server core: config, db, provider abstraction
- [x] P3: Skill packs: format + 4 seed companies (Google, Amazon, Meta, generic-startup)
- [x] P4: API: profile, calibration, interview lifecycle, evaluation, coaching, history
- [x] P5: Web app: setup wizard, profile, calibration, interview room (voice+text), report, dashboard
- [x] P6: Voice layer: push-to-talk STT, auto-TTS of interviewer replies, barge-in stop
- [x] P7: Docs: README run guide, brew/npx distribution story
- [x] P8: Verify end-to-end (typecheck, build, boot server, smoke API) and push to GitHub

## Commands

```bash
npm install            # install everything (workspaces)
make db-up             # start Postgres in Docker (required before dev/start/check)
make dev               # Postgres + server :4747 + vite :5173 with proxy
npm run build          # build web → web/dist, typecheck server
npm run typecheck      # tsc --noEmit in both workspaces
make check             # full gate: lint + typecheck + build + smoke (boots Postgres)
make start             # production: serve built app on http://localhost:4747
make db-generate       # generate a Drizzle migration after editing server/src/schema.ts
node scripts/import-sqlite.mjs  # one-time: legacy ~/.senior-bro/data.db → Postgres
```

> Server data lives in Postgres (`DATABASE_URL`, default `…@localhost:5433/senior_bro`).
> Copy `.env.example` → `.env` for local dev. `make db-reset` wipes the data volume.
