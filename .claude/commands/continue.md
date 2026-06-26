---
description: Resume Senior Bro development with full context from the roadmap and memory
---

You are resuming work on **Senior Bro**, a phased product build. Rebuild full
context, then continue, following the project's working agreement.

1. Read `ROADMAP.md` end-to-end (vision, decisions D1–D17, open questions, the phase
   checklist (Phases 0–17), and the "Build order (owner-directed)" note). **Status as of
   2026-06-26: all owner-directed phases 11–17 are shipped** (Postgres/Drizzle, identity +
   resumable sessions, plans/gating/invites, admin-versioned prompts + guardrail, dynamic
   company packs, accent voice, and Phase 17 R21–R24). The lowest *unfinished* roadmap work
   is now **Phase 4 (personalization), Phase 5 (resume/opportunity pipeline), or Phase 7
   (learn-while-interviewing)** — unless the owner has added newer items (see `CLAUDE.md`
   requirements `R25+`, registered via `/add-feature`).
2. Read `memory/INDEX.md` and the most recent `memory/*.md` milestone entry.
3. Run `make check` to confirm the working tree is green. **This needs Docker running** —
   server data lives in PostgreSQL via `docker compose` (the `make` targets run `db-up`
   first). If Docker isn't running, start it (or run `make db-up`) before `make check`.
4. Determine the next work: honor any owner-directed item first (newest `R#` / a roadmap
   note); otherwise take the lowest unfinished phase. State which phase/feature you're
   starting and a short plan (use the task list for multi-step work). If nothing is queued,
   ask the owner for direction rather than inventing scope.
5. Build it. Tick `[x]` in `ROADMAP.md` as items land, add a `memory/` entry per
   milestone, and keep `CLAUDE.md` current. Verify with `make check` (+ `make e2e`
   for UI flows) before any commit; only commit/push when complete and green.
6. Each phase ends at an **owner-review gate** — finish the phase, push, then stop
   and summarize what changed and what's next.

> Companion commands: `/add-feature <idea>` registers a new feature against the requirement
> list; `/report-bug <symptom>` diagnoses + fixes a bug and adds a regression test.

$ARGUMENTS
