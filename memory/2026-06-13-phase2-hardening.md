# 2026-06-13 — Phase 2: production hardening

## Shipped

- **SSE streaming**: `chat()` in `server/src/providers.ts` now takes an optional
  `onDelta`; `/interviews` (opener) and `/interviews/:id/messages` stream via
  Hono `streamSSE` when the client sends `Accept: text/event-stream`
  (events: `delta` / `done` / `error`, JSON-encoded data). Non-stream JSON path kept.
  Client: `ssePost()` in `web/src/api.ts` parses the stream; `Interview.tsx`
  renders a live `partial` bubble with caret. Voice mode speaks
  **sentence-by-sentence while streaming** via the `Speaker` class in
  `web/src/voice.ts` (buffers deltas, flushes complete sentences to TTS,
  strips `[INTERVIEW_COMPLETE]`).
- **Mock provider** (`provider: 'mock'`): deterministic canned replies keyed off
  the system prompt (calibration JSON / grading JSON / evaluation JSON / 3
  interview questions then wrap). Used by E2E; never shown in the Setup UI.
- **Validation & hardening**: zod schemas on every POST body (routes.ts,
  `parseBody` helper → 400 with first issue); per-IP sliding-window rate limit
  (120 req/min) + JSON-line request logs in `index.ts`.
- **SPA resilience**: ErrorBoundary in `main.tsx`, offline banner in `App.tsx`
  (`useSyncExternalStore` on online/offline events).
- **Lint stack**: ESLint flat config (`eslint.config.js`) with typescript-eslint
  `strictTypeChecked` + `stylisticTypeChecked` + react-hooks + prettier; type-aware
  via `projectService`. Pragmatic opt-outs: no-non-null-assertion off,
  restrict-template-expressions allowNumber, no-confusing-void-expression off.
  `playwright.config.ts`, `e2e/**`, `*.mjs` lint without type info.
- **CI**: `.github/workflows/ci.yml` — npm ci → lint → format:check → typecheck
  → build → smoke → playwright (chromium) on push/PR to main; report artifact on failure.
- **E2E**: `e2e/happy-path.spec.ts` runs the full journey (landing → profile →
  calibration ×5 → streamed text interview ×3 turns → report). Fully isolated:
  `HOME=.e2e-home` (global-setup writes mock config.json there), port 4749.
- **Dep hygiene**: vite upgraded to v8 (audit: 0 vulnerabilities).

## Gotchas for future agents

- **Sends during streaming are dropped by design** (`send()` returns while
  busy). E2E must wait for the Send button to be enabled before clicking — text
  assertions are NOT enough because partial text matches during streaming.
- SSE `data:` payloads are JSON-encoded strings (newline-safe); client must
  `JSON.parse` each event's data.
- `make check` = lint + typecheck + build + smoke. E2E is separate (`make e2e`).
- Mock provider branches on system-prompt substrings ('calibration questions',
  'grade interview calibration', 'evaluate mock interviews') — keep those
  phrases stable in routes.ts or update providers.ts.
