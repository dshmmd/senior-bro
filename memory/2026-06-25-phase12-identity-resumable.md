# 2026-06-25 — Phase 12: Identity & resumable sessions (D14)

Returning-user recognition + resume an interrupted interview exactly where it
stopped, with DB-level per-user partitioning hardening. Builds on the Postgres
foundation ([[2026-06-25-phase11-postgres-drizzle]]). Satisfies R15.

## What shipped
- **Resumable interviews.** The server transcript was already the source of truth
  (every turn persisted via `saveTranscript`). The `Interview` web component now
  takes an optional `resumeId`: when set it calls `GET /api/interviews/:id` and
  reloads the transcript instead of `POST /interviews` (no re-open, no re-speaking
  history in voice mode). The phase is implicit in the transcript — the system-prompt
  state machine re-derives it — so no extra state needed.
- **Resume entry points (web).** Dashboard surfaces the most recent `status:'active'`
  interview as a prominent "⏸️ interview in progress" banner (Resume / Discard), and
  History rows for active interviews are clickable to resume (finished ones still open
  the report). `App.tsx` interview view gained `resumeId?: number`.
- **Discard.** `DELETE /api/interviews/:id` (guarded by `ownInterview`, 409 on a
  finished one) → `db.deleteInterview`. Lets a user clear a stale active interview so
  the resume banner doesn't linger forever.
- **Welcome back.** Dashboard heading is "Welcome back" when the user has prior
  interviews (`history.length > 0`), else "Ready when you are"; shows the signed-in
  email. Durable session was already there: 30-day `sb_session` cookie with `maxAge`
  (remember-me); expiry → `health.authed:false` → login view (clean re-auth).
- **Per-user partitioning hardening.** Added real **foreign keys + lookup indexes** in
  `server/src/schema.ts` (migration `server/drizzle/0001_blue_lester.sql`):
  - cascade: `sessions.user_id`, `profiles.user_id`, `calibrations.profile_id`,
    `interviews.profile_id`, `weaknesses.profile_id`, `usage_events.user_id` → parent.
  - set null: `users.model_id`, `usage_events.model_id` → `models.id`;
    `weaknesses.source_interview_id` → `interviews.id` (historical/optional links must
    not block deleting a model or discarding an interview).
  - indexes on every FK lookup column.

## Gotchas / decisions
- **Forward refs in schema:** `users.model_id` references `models` which is declared
  later in the file — used Drizzle's thunk form `.references(() => models.id, …)` so
  forward references resolve; no table reordering needed.
- **`onDelete` choice matters for existing flows:** `usage_events.model_id` had to be
  `set null` (not cascade/restrict) or `db.deleteModel` would be blocked by historical
  usage rows. `deleteInterview` works because `weaknesses.source_interview_id` is
  `set null` (and active interviews have no sourced weaknesses anyway).
- **Boot migration is safe on existing data:** `migrate()` applied `0001` cleanly
  against the owner's local DB (ids preserved + back-filled in Phase 11 → no orphans).
  Verified by `make check` booting the smoke server against the real local DB.
- **e2e shares one wiped DB across tests, run serially** → proved resume *inside* the
  happy-path flow rather than a second test: answer one turn → Quit → assert the
  "interview in progress" banner → Resume → assert the prior answer + follow-up question
  are restored → finish. Deterministic because the server replays the full transcript to
  the mock provider on every turn regardless of resume.

## Verified
- `make check` green (lint + typecheck + build + smoke on PG; migration 0001 applied on boot).
- `make e2e` green (happy path now includes quit → resume → finish).

## Next
- **Phase 13 — Plans, gating & invite codes (D11):** free level-check → plan choice;
  mocked payment; admin-minted token-credit invite codes; entitlement check before paid calls.
