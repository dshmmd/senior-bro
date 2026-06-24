---
description: Resume Senior Bro development with full context from the roadmap and memory
---

You are resuming work on **Senior Bro**, a phased product build. Rebuild full
context, then continue, following the project's working agreement.

1. Read `ROADMAP.md` end-to-end (vision, decisions D1–D8, open questions, phase
   checklist, and the "Build order (owner-directed)" note).
2. Read `memory/INDEX.md` and the most recent `memory/*.md` milestone entry.
3. Run `make check` to confirm the working tree is green.
4. Determine the next work: follow the owner-directed build order if present,
   else the lowest unfinished phase. State which phase you're starting and a
   short plan (use the task list for multi-step work).
5. Build it. Tick `[x]` in `ROADMAP.md` as items land, add a `memory/` entry per
   milestone, and keep `CLAUDE.md` current. Verify with `make check` (+ `make e2e`
   for UI flows) before any commit; only commit/push when complete and green.
6. Each phase ends at an **owner-review gate** — finish the phase, push, then stop
   and summarize what changed and what's next.

$ARGUMENTS
