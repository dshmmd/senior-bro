# Senior Bro — AI Interview Coach

Local-first, bring-your-own-key AI interview platform. The user tells us the job
they want, we calibrate their level, run a realistic voice-or-text interview,
detect weaknesses, and coach them until they're ready.

## How to work in this repo (agent rules)

1. Read `memory/INDEX.md` before starting any task — it records what is done and why.
2. When a plan item below is completed, mark it `[x]` here AND append a short
   entry to `memory/` (one file per milestone, linked from `memory/INDEX.md`).
3. Verification gate before any commit: `npm run typecheck && npm run build`.
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

## Architecture

```
senior-bro (npm workspace monorepo)
├── server/   Hono + node:sqlite. Serves API + built web app. Port 4747.
│   ├── src/index.ts      entry: static serving + API mounting
│   ├── src/db.ts         sqlite schema & queries (~/.senior-bro/data.db)
│   ├── src/config.ts     provider+key config (~/.senior-bro/config.json)
│   ├── src/providers.ts  LLM abstraction: anthropic | openai via fetch
│   ├── src/prompts.ts    ALL system prompts & evaluation rubrics
│   ├── src/skills.ts     loads skills/*.md company packs
│   └── src/routes.ts     REST API
├── web/      React + Vite SPA
│   ├── src/voice.ts      Web Speech API wrapper (STT + TTS)
│   ├── src/api.ts        typed client for server API
│   └── src/pages/        Setup → Profile → Calibration → Interview → Report → Dashboard
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
