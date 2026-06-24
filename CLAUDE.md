# Senior Bro — AI Interview Coach

Local-first AI interview platform. The user tells us the job they want, we
calibrate their level, run a realistic voice-or-text interview, detect
weaknesses, and coach them until they're ready. Powered by the user's own API
key **or their existing Claude/ChatGPT subscription** (via the local CLI).

## ▶ START HERE — when the owner says "continue"

Do this, in order, before writing any code. It rebuilds full context in ~1 min:

1. Read **`ROADMAP.md`** top-to-bottom — it has the vision, the decisions
   (D1–D8), open questions, the phase checklist, and the owner-directed build order.
2. Read **`memory/INDEX.md`** and the newest `memory/*.md` entry — what's done, why,
   and the gotchas.
3. Run **`make check`** to confirm the tree is green before changing anything.
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
1. Read `memory/INDEX.md` before starting any task — it records what is done and why.
2. When a plan item below is completed, mark it `[x]` here AND append a short
   entry to `memory/` (one file per milestone, linked from `memory/INDEX.md`).
3. Verification gate before any commit: `make check` (lint + typecheck + build + smoke).
   Run `make e2e` too when a UI flow changed.
4. One language everywhere: TypeScript. No new runtime deps without a strong reason —
   we deliberately use `node:sqlite` and raw `fetch` to keep the install surface tiny.
5. User-facing strings live in the React components; prompts live in `server/src/prompts.ts`.
6. Company interview knowledge lives in `skills/*.md` (frontmatter + markdown).
   Adding a company = adding one file. Never hardcode company specifics in code.

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
- [ ] R13: **Admin panel for a hosted deploy** — admin manages API keys per model;
  users pick from admin-curated options; usage metering + per-user token limits.
  See ROADMAP Phase 9 (admin) + Phase 8 (billing). This is the priority bundle the
  moment we deploy to a host. Highly configurable: adding/removing a model option,
  swapping its key, or changing a user's quota must be admin-UI actions, no redeploy.

## Architecture

```
senior-bro (npm workspace monorepo)
├── server/   Hono + node:sqlite. Serves API + built web app. Port 4747.
│   ├── src/index.ts      entry: static serving + API mounting
│   ├── src/mode.ts       SENIORBRO_MODE=local|hosted (local = single implicit owner)
│   ├── src/db.ts         sqlite schema & queries (~/.senior-bro/data.db); users/sessions/
│   │                     magic_links + per-user provider config + per-user data isolation
│   ├── src/config.ts     AppConfig type + legacy config.json reader (migrated into db)
│   ├── src/crypto.ts     AES-256-GCM secret encryption (api keys at rest), random tokens
│   ├── src/auth.ts       hosted magic-link sessions, requireUser/currentUser, sb_session cookie
│   ├── src/mailer.ts     dependency-free magic-link delivery (log + optional webhook)
│   ├── src/http.ts       shared HttpError
│   ├── src/providers.ts  LLM abstraction: anthropic | openai | claude-cli | codex-cli | mock
│   ├── src/prompts.ts    ALL system prompts & evaluation rubrics
│   ├── src/skills.ts     loads skills/*.md company packs
│   └── src/routes.ts     REST API (per-user; /auth/* in hosted mode)
├── web/      React + Vite SPA
│   ├── src/voice.ts      Web Speech API wrapper (STT + TTS)
│   ├── src/api.ts        typed client for server API (cookie-authed)
│   └── src/pages/        Login(hosted) → Setup → Profile → Calibration → Interview → Report → Dashboard
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
npm run dev            # server :4747 + vite :5173 with proxy
npm run build          # build web → web/dist, typecheck server
npm run typecheck      # tsc --noEmit in both workspaces
npm start              # production: serve built app on http://localhost:4747
```
