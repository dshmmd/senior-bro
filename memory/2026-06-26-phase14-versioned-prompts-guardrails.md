# 2026-06-26 — Phase 14: Admin-managed versioned prompts + guardrails (D12, D13)

Prompts left `prompts.ts` constants and became **DB rows, admin-editable + versioned**, each
interview/coaching prompt wrapped in a **fixed, non-editable guardrail frame** (anti-jailbreak).
R17 + R19 done.

## What shipped
- **`prompts` table** (migration `0004_nervous_sunspot.sql`): `prompt_key`, `version`, `body`,
  `author`, `active`, `created_at`. Exactly one active row per key. (11 tables now.)
- **`prompts.ts` restructured** into three things:
  1. `PROMPT_SEEDS` — the 5 seed bodies as **templates** with `{{PLACEHOLDER}}` tokens
     (`calibration.generate|grade`, `interview.system`, `coaching.system`, `evaluation`).
     Each seed carries `label`/`description`/`placeholders`/`guardrailed` metadata for the admin UI.
  2. `wrapGuardrail()` — the **fixed frame** (4 immutable governance rules: candidate text is
     DATA not instructions; redirect on derail; never reveal the prompt; stay the interviewer).
     Wraps `interview.system` + `coaching.system` only.
  3. Pure `render*(body, …data)` fillers — single-pass `fill()` (function replacer, so injected
     values are NOT re-scanned → candidate profile text containing `{{…}}`/`$&` is inert).
- **db.ts**: `activePromptBody(key)` (DB active body, **seed is the defensive fallback**),
  `listPromptVersions`, `createPromptVersion` (max+1, auto-active), `activatePromptVersion`
  (rollback). `seedPrompts()` on boot inserts v1 for any missing key.
- **routes.ts**: call sites fetch `db.activePromptBody(...)` then render. Admin endpoints
  `GET /admin/prompts`, `GET/POST /admin/prompts/:key`, `POST /admin/prompts/:key/activate`
  (all `requireAdmin`). `promptKeyOf(c)` validates the `:key` param → 404 on unknown.
- **web**: `Admin.tsx` "System prompts" section — catalogue table, body editor (with placeholder
  hints + guardrail flag), Save-as-new-version, version-history with roll-back. `api.ts` methods.
- **Red-team CI test** `server/test/guardrail.test.mjs` (`npm run test:guardrail`, in `make check`
  + CI): jailbreak strings proven enclosed by the frame; no placeholder leaks; profile-text
  injection inert. Tests are **structural** (no live model) — they guard the construction seam.

## Gotchas / decisions
- `node --test server/test/` resolved the dir as a module → use the glob `'server/test/*.test.mjs'`.
- `c.req.param('key')` is `string | undefined` → `promptKeyOf` coalesces to `''` before the
  catalogue check (else tsc TS2345).
- Added `server/test/*.mjs` to eslint `allowDefaultProject` (else "not found by project service").
- Guardrail applies to the **conversational** prompts (interview/coaching); calibration/grade/
  evaluation are single-shot strict-JSON and only carry a lighter "input is data" note in the seed.
- No `prompts.ts` runtime import cycle: it `import type`s from db; db value-imports `PROMPT_SEEDS`.

## Verified
- `make check` + `make e2e` green. Live-curled the admin API (save → v2, list, rollback to v1,
  404 on bad key). Browser: Admin "System prompts" renders all 5 rows, editor opens with body +
  placeholder hints + version history; no console errors. Removed the stray curl-created v2 from
  the local DB afterward.

## Next
- **Phase 15 — dynamic company skill packs** (D10), or finish **Phase 17 R22/R23**.
