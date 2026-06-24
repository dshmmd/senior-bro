# 2026-06-24 — Subscription auth (CLI providers) + session continuity

Two owner asks handled before continuing the roadmap.

## 1. Use a subscription instead of an API key (D8)

The owner (and most users) have a $20 Claude/ChatGPT subscription but no API
credits. Added two providers that bill the **subscription** via the local CLI:

- `claude-cli` → `claude -p --output-format text --append-system-prompt <sys> [--model m]`,
  conversation piped on stdin.
- `codex-cli` → `codex exec --skip-git-repo-check [--model m]`, system+conversation on stdin.
- `server/src/providers.ts`: `runCli()` spawns the CLI, streams stdout to `onDelta`,
  and **strips `ANTHROPIC_*` / `OPENAI_*` env vars** so the CLI uses its logged-in
  subscription auth (not an injected API key/proxy).
- `server/src/config.ts`: `CLI_PROVIDERS` / `isCliProvider`; `apiKey` now optional
  (empty for CLI), `model:''` means "subscription default" (omit `--model`).
- `routes.ts` configSchema: `.refine()` requires apiKey only for non-CLI providers.
- Setup UI (`web/src/pages/Setup.tsx`): the two "no key" subscription cards lead;
  API keys are the fallback. CLI path shows a "sign in to the CLI first" note.

**Boundaries:** local mode only — the CLI runs on the user's own machine. The
hosted tier must NOT proxy a customer's subscription (ToS + can't share logins);
hosted uses API keys / host tokens (Phase 8). Couldn't do a live CLI round-trip in
the dev sandbox (it injects `ANTHROPIC_BASE_URL`), so the providers are written but
need a real-machine smoke test: pick "Claude subscription", expect a real interview.

## 2. "continue" rebuilds full context

- `CLAUDE.md` now opens with a **▶ START HERE** protocol (read ROADMAP → memory →
  `make check` → pick phase by owner-directed build order → verify/commit/gate).
- Added `.claude/commands/continue.md` so `/continue` runs the same protocol.
- Verification gate references updated to `make check` / `make e2e`.

## Verified

`make check` + `make e2e` green. Setup screenshot confirms the subscription-first
provider picker. Mock provider still backs CI (no network/subscription needed there).
