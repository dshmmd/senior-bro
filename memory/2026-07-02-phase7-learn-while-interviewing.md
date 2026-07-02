# Phase 7 — Learn-while-interviewing

**Shipped 2026-07-02.** Turns the interview from a pass/fail exam into a coaching loop.

## What landed

- **Teaching mode** — `teachingBlock()` in `server/src/prompts.ts`, code-injected into
  `renderInterviewSystem` + `renderHrSystem` (appended before `wrapGuardrail`, so it's inside the
  guardrail frame and applies on every admin prompt version — same pattern as the R23 evidence block
  and the D2 user-model block). When the candidate is stuck / asks to be taught, the interviewer gives
  a short socratic micro-lesson (intuition + one guiding question), then re-asks an adapted, easier
  version before moving on. Not observable over HTTP without a live model → asserted **structurally**
  in `server/test/guardrail.test.mjs` (present + inside the frame, technical + HR).
- **One-tap teach escape hatch** — the interview steering chip changed from "💡 Explain that" to
  **🎓 Teach me this** (`web/src/pages/Interview.tsx` `STEER_CHIPS`): sends an explicit teach request
  that trips teaching mode and logs a `preference` event.
- **Post-interview study plan** — `POST /api/study-plan` (prompt `study.plan`, feature `study.plan`),
  plan-gated exactly like interviews (`requireCall(c, 'interview', { feature: 'study.plan' })`).
  Builds `{ overview, items:[{topic, focus, practice, weakness_id}] }` from open weaknesses + recent
  reports. Weaknesses are rendered as `- [id N] title: detail` so the model can tag each item with the
  weakness it addresses; the **📚 Study plan** page (`web/src/pages/StudyPlan.tsx`, Dashboard card,
  shown once the user has a finished interview) launches a coaching drill for any item with a
  `weakness_id` via `onDrill → interview{kind:coaching, weaknessId}`.

## Gotchas

- Mock provider (`providers.ts`) branch keys on `system.includes('study plan')` and regexes the first
  `[id N]` out of the prompt to echo a real `weakness_id` — that's what lets `verify-ph7.mjs` prove
  drill linkage offline. (Mock keys off the **system** string, so the route's system prompt must
  contain "study plan".)
- Study plan reuses the existing weakness → coaching-drill path (Dashboard "Drill this"); no new
  interview machinery.

## Verification / status

`scripts/verify-ph7.mjs`: gating (free-intro 402), plan overview + items, ≥1 item linked to a **real**
open weakness id, cross-user 404. Guardrail unit test covers teaching mode. `make check` + `make e2e`
green.

**Phase 7 done.** Last item in the owner-authorized 5/7/4 track: **Phase 4 leftover — D3 capability
tiers** (BYOK output parity: probe the model once, store fast/standard/deep, select prompt variants +
token budgets). See [[senior-bro-project]].
