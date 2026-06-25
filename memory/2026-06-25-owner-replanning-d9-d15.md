# 2026-06-25 — Owner re-planning (D9–D15, Phases 11–16)

Docs-only update (no code yet). The owner set new near-term direction after the R13
slice landed. Captured as decisions D9–D15 in ROADMAP and requirements R14–R20 in
CLAUDE.md, with new Phases 11–16 and a recommended build order. See
[[2026-06-25-r13-admin-metering-slice]] for what shipped just before this.

## What changed (owner's words → decisions)
- "A few hardcoded companies is useless" → **D10 / R14 / Phase 15**: generate company packs
  on demand via web search, store + cache in DB, admin review. Static `skills/*.md` = seed.
- "Recognize the user each time; leave a session and continue later" → **D14 / R15 / Phase 12**:
  durable identity + **resumable interviews** (server transcript is source of truth).
- "All data stored per-user; reliable long-term design" + "use Docker for a robust enterprise
  system" → **D9 / R16 / Phase 11**: move `node:sqlite` → **PostgreSQL in Docker**, typed
  migrations (Drizzle recommended). **This supersedes the zero-deps rule** (CLAUDE.md rule 4).
- "Admin should manage/improve system prompts, best practices" → **D12 / R17 / Phase 14**:
  prompts move to DB, **versioned with history + rollback**, admin-editable; code ships seed.
- "Plans: host-models (paid) / own key (free) / local CLI (free); free short level-check first;
  then pay (mocked) or use admin invite-codes with credit" → **D11 / R18 / Phase 13**. Builds
  on the Phase 8 metering/quota already shipped.
- "Users must not steer context away from interview" → **D13 / R19 / Phase 14**: fixed
  **guardrail frame** around prompts; candidate input treated as untrusted content; red-team
  tests in CI.
- "Voice is raw STT, not editable; prefer model hears the voice for accent, or let user edit
  before sending" → **D15 / R20 / Phase 16**: audio-to-model where supported, else editable
  transcript before send.

## Recommended build order (owner to confirm at this gate)
11 (Postgres/Docker) → 12 (identity + resume) → 13 (plans + invite codes) →
14 (versioned prompts + guardrails) → 15 (dynamic company packs) → 16 (accent voice).
Rationale: 11 unblocks all new tables; 12/13 make hosted usable + monetizable; 14 hardens
safety; 15/16 are features riding on top. Owner may reorder.

## Open questions raised (need owner input, ROADMAP Q3–Q7)
- Q3 Plan A pricing unit (per-hour / per-Mtok+margin / flat). Q4 web-search source for D10.
- Q5 confirm Drizzle+Postgres vs raw pg vs Prisma. Q6 audio-capable model for D15.
- Q7 retire `node:sqlite` entirely (single Postgres for local+hosted)?

## Note for the next agent
`/continue` should start **Phase 11 (Postgres/Docker)** unless the owner reorders. Phase 11
is invasive (DB rewrite behind the same `db.ts` function signatures) and changes `make check`
to require a running Postgres — read the Phase 11 checklist before touching code, and confirm
Q5/Q7 with the owner first if still unanswered.
