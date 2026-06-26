# 2026-06-27 — Phase 4: Personalization engine ("it knows me") — core

Owner picked Phase 4 next (all owner-directed phases 11–17 were already done). Shipped the
personalization core; deferred capability tiers (D3).

## What shipped

- **Event log** (`user_events`, migration 0007) — per **profile** (consistent with weaknesses/
  claims/progress, which all resolve the active profile). Kinds: `profile_created`, `calibration`,
  `interview_started`, `interview_finished`, `preference`. `db.recordEvent` / `db.listEvents`.
- **Distilled "user model"** (`user_models`, 1:1 per profile, PK = profile_id) — `db.getUserModel` /
  `setUserModel(edited)` / `clearUserModel`. Re-distilled in `finishInterview` via
  `distillUserModel()` from prior model + last 40 events + the fresh report. New **versioned prompt**
  `personalization.distill` (PROMPT_SEEDS, admin-editable). Distill is **best-effort** — wrapped in
  `.catch` so it never blocks returning the report.
- **Injection** — `userModelBlock()` appended in `renderInterviewSystem` + `renderCoachingSystem` as a
  **code-level block** (not a placeholder), so it applies on every prompt version — same pattern as the
  R23 evidence block. New optional `userModel` arg on both renderers (defaults null → back-compat,
  guardrail tests untouched).
- **One-tap steering chips** (Interview composer) — harder / ease up / more system design / more
  behavioral / explain. Each sends a request the interviewer honors now AND records a `preference`
  event via `messageSchema.preference` (optional field on the existing message route — one round-trip).
- **"What we know about you" page** (`web/src/pages/Memory.tsx`, topbar 🧠 you, gated on a calibrated
  profile) — reads the model + recent activity, **correct** by hand (→ `edited`, folded into next
  distill since prior body is fed back), or **delete** (D6). `GET/PUT/DELETE /api/me/model`, active
  profile. Client: `api.getMyModel/saveMyModel/clearMyModel`, `UserModelInfo`/`UserEvent` types.
- Mock provider: added a `learner profile` branch so dev/e2e produce a realistic distilled model.

## Deferred (flagged at gate)
- **D3 capability tiers** (BYOK output parity across a $5 Haiku vs Opus key) — distinct concern from
  personalization; its own slice. Phase 4 checkbox left unchecked.

## Verification
`make check` + `make e2e` green. `scripts/verify-ph4.mjs` proves the full chain on the mock provider:
events → distill → preference chip → read/correct/delete. (Not in `make check`; run manually like
`verify-ph13.mjs`.)

## Gotchas
- `/me/model` and all personalization resolve the **active** profile (R24) — a new profile starts with
  an empty model + its own event stream.
- Distillation reuses the `finishInterview` resolved `call` (metered/gated). Free-intro users never
  reach finish (interviews are paywalled), so no free-tier distill cost.

Next = owner's call: Phase 5 (resume/opportunity), Phase 7 (learn-while-interviewing), finish Phase 4
(D3 capability tiers), or new direction.
