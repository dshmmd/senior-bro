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
hosted uses API keys / host tokens (Phase 8).

### Real-machine smoke test (2026-06-24) — found + fixed a blocking bug
Owner reported CLI subscription mode "couldn't work." Reproduced on the real box:
the spawn/auth was fine (exit 0, real subscription), but `claude -p` is **Claude
Code** (a coding agent) and `--append-system-prompt` only *appends* to its persona —
so it replied as "Claude Code" ("I'm not a human interviewer… what do you want to
build?") and even saw the repo it ran in. **Fixes in `providers.ts`:**
- claude-cli: `--append-system-prompt` → **`--system-prompt`** (fully replaces the
  coding persona) + **`--tools ""`** (no tools) + run in a **neutral cwd** (`os.tmpdir()`).
- codex-cli: same neutral-cwd, add **`-s read-only`** sandbox, and read the clean final
  message from **`-o <file>`** (codex stdout interleaves "codex"/"tokens used" framing
  and echoes the reply, so raw-stdout streaming was garbage); model via `-c model=…`.
- `runCli()` gained a `cwd` arg.
Verified end-to-end through the real `chat()` with live credentials: both providers
now greet + ask a warmup question in character. claude streams; codex emits once.
NOTE: `claude` lives at `/opt/homebrew/bin/claude` — if the app is launched with a
PATH that excludes Homebrew, `spawn('claude')` ENOENTs ("Could not launch claude").

## 2. "continue" rebuilds full context

- `CLAUDE.md` now opens with a **▶ START HERE** protocol (read ROADMAP → memory →
  `make check` → pick phase by owner-directed build order → verify/commit/gate).
- Added `.claude/commands/continue.md` so `/continue` runs the same protocol.
- Verification gate references updated to `make check` / `make e2e`.

## Verified

`make check` + `make e2e` green. Setup screenshot confirms the subscription-first
provider picker. Mock provider still backs CI (no network/subscription needed there).
