# 🎙️ Senior Bro — AI Interview Coach

Practice real job interviews with an AI interviewer — **by voice or text** — get a
hiring-committee-style evaluation, and drill your weaknesses until they're gone.

Local-first and **bring-your-own-key**: your API key and all interview data stay on
your machine (`~/.senior-bro/`). The only network traffic is directly to the AI
provider you choose (Claude or OpenAI).

## What it does

1. **Tell it the job** — role, company, technologies, experience.
2. **Level check** — a 5-question calibration quiz grades you junior → staff so
   interviews match your real level.
3. **Mock interview** — voice (speak out loud, the interviewer talks back) or text.
   Phased like the real thing: warmup → behavioral → technical → system design → wrap.
4. **Company playbooks** — pick Google, Amazon, Meta, or startup style and the
   interviewer adopts that company's real interview patterns (Leadership Principles,
   GCA, time-pressure coding…). Add a company by dropping one markdown file in `skills/`.
5. **Report + weakness tracking** — scored evaluation across 5 dimensions, with
   specific weaknesses saved to your profile.
6. **Coaching drills** — one-click focused sessions that attack a single weakness
   until you mark it resolved. Future interviews automatically probe your open weaknesses.

## Powering it — no API credits required

Senior Bro can run on a **subscription you already pay for**, not just an API key:

| Option | What you need | Cost |
| --- | --- | --- |
| **Claude subscription** | The [`claude`](https://docs.claude.com/claude-code) CLI installed and signed in with your **Claude Pro/Max** plan | included in your plan |
| **ChatGPT / Codex** | The `codex` CLI installed and signed in with your **ChatGPT/Codex** plan | included in your plan |
| Claude API key | A key from [console.anthropic.com](https://console.anthropic.com) | pay-as-you-go |
| OpenAI API key | A key from [platform.openai.com](https://platform.openai.com) | pay-as-you-go |

For the subscription options, just run `claude` (or `codex`) in a terminal once,
sign in, then pick that option in setup — Senior Bro drives the CLI in headless
mode, so your interviews bill your subscription with **zero API spend**. This
works in local mode (the CLI runs on your own machine).

## Requirements

- **Node.js ≥ 22.5** (`node --version`)
- **Docker** (the server stores data in PostgreSQL, run via `docker compose`)
- One of the four power options above
- For voice mode: Chrome, Edge, or Safari (uses the built-in Web Speech API — free, no extra key)

## Run it (production mode)

```bash
git clone https://github.com/dshmmd/senior-bro.git
cd senior-bro
npm install
make start          # starts Postgres (Docker), builds, and serves on :4747
```

Open **http://localhost:4747**, pick how to power it (a subscription or an API key), and start interviewing.

## Run it (development mode)

```bash
npm install
make dev            # Postgres + server on :4747 + hot-reloading web app on :5173
```

Open **http://localhost:5173**. (`make dev` runs `make db-up` first; `make db-down` stops Postgres.)

## Other commands

```bash
make check          # full gate: lint + typecheck + build + smoke (boots Postgres)
make db-up          # start Postgres only;  make db-reset wipes its data volume
make db-generate    # regenerate Drizzle migrations after editing server/src/schema.ts
```

`DATABASE_URL` defaults to `postgres://senior:senior@localhost:5433/senior_bro`
(see `.env.example`). To bring older data from `~/.senior-bro/data.db` into Postgres,
run `node scripts/import-sqlite.mjs` once.

## Project layout

```
server/   Hono API + interview engine (PostgreSQL via Drizzle ORM, Docker)
web/      React SPA — voice layer is browser-native Web Speech API
skills/   company interview playbooks (markdown seed packs; dynamic generation is on the roadmap)
memory/   build log for AI agents working on this repo
CLAUDE.md requirements, architecture, and agent working rules
```

## Adding a company playbook

Create `skills/<company>.md`:

```markdown
---
company: Stripe
roles: Backend Engineer, API Engineer
summary: API design taste, writing culture, practical coding.
---

## Interview style
- ...question patterns, signals, culture notes...
```

It appears in the onboarding dropdown immediately — no code changes.

## Distribution (roadmap)

The app is a single Node package with a `senior-bro` bin. Publishing path:
`npm publish` → `npx senior-bro`, then a Homebrew formula
(`brew install senior-bro`) wrapping the npm package for non-technical users.

## Privacy

- API keys: encrypted at rest (AES-256-GCM) in the database, never sent anywhere but your chosen AI provider
- Interviews & reports: PostgreSQL (`docker compose`, on your own machine in local/dev)
- Voice never touches a server — speech-to-text and text-to-speech run inside your browser
