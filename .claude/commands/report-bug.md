---
description: Diagnose and fix a reported bug at its root cause, then add a regression test so it can't come back
---

The owner is reporting a bug in **Senior Bro**. Find the real cause, fix it, and lock it
down with a test. Follow the project's working agreement (`CLAUDE.md`). Don't patch the
symptom — fix the root cause.

## 1. Pin down the bug (don't start editing yet)

- Restate the bug in one line: **expected vs. actual**, and how to trigger it (page/route,
  provider, plan/mode — `local` vs `hosted`, which profile).
- If the repro steps are unclear, ask one focused question or make the smallest reasonable
  assumption and state it.
- Confirm the tree is green first so you know the bug — not a dirty tree — is the problem:
  `make check` (needs Docker/Postgres up; `make db-up` if not). For UI bugs, reproduce it
  live with the preview tools or `make e2e`, and read `preview_console_logs` / server logs.

## 2. Locate the root cause (evidence, not guesses)

- Search the responsible layer: `server/src/` (routes/db/providers/prompts/auth), `web/src/`
  (pages/api), `server/src/schema.ts` + `server/drizzle/` for data issues.
- Form a hypothesis, then **prove it** — read the code path end to end, add a temporary log
  or a failing check, and confirm exactly where behaviour diverges before changing anything.
- Watch for the usual suspects here: async DB calls missing `await`; `local` vs `hosted`
  branching (`mode.ts`); per-user isolation guards (`ownProfile`/`ownInterview`); zod
  `.optional()` ≠ nullable; versioned-prompt bodies vs. code-level frames; provider
  differences (`anthropic`/`openai`/`*-cli`/`mock`).

## 3. Fix it

- Make the **minimal** change at the root cause, in the surrounding code's style (match
  naming, comment density, idioms). If a DB shape changes, edit `server/src/schema.ts` and
  run `make db-generate` for a migration — never hand-edit generated SQL.
- If the bug reveals a wrong assumption baked into the docs or a Decision, fix that too.

## 4. Add a regression test (this is required when feasible)

Pick the cheapest test that would have caught the bug and fails before your fix:

- **Server logic / pure functions** → a `node --test` file in `server/test/*.test.mjs`
  (like `guardrail.test.mjs`), imported from `../dist/*.js`; it runs in `make check` via
  `make test`. Prefer deterministic, structural checks (use the `mock` provider — never a
  live model in CI).
- **A user-facing flow** → extend `e2e/happy-path.spec.ts` (Playwright, mock provider).
- **An end-to-end server/HTTP path** that doesn't fit the above → a `scripts/verify-*.mjs`
  booting against the isolated test DB (see `scripts/verify-ph13.mjs`).
- If a regression test genuinely isn't feasible, say so explicitly and explain why.

## 5. Verify, record, commit

- `make check` must pass (+ `make e2e` if a UI flow changed). State the result honestly —
  if something still fails, report it with the output.
- If the bug exposed something durable (a sharp edge, a systemic gap), add a short
  `memory/` note and link it from `memory/INDEX.md`; tick/adjust `ROADMAP.md`/`CLAUDE.md` if
  relevant.
- Commit only when complete and green, with a message describing the root cause and the
  regression test. Push per the project's gate convention. End commit messages with the
  standard `Co-Authored-By` trailer.

The bug report:

$ARGUMENTS
