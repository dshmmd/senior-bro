---
description: Register a new feature request — compare it against what's already delivered, then add it to the project's requirement/roadmap lists in the house style
---

The owner is proposing a new feature for **Senior Bro**. Your job is to **triage and
register** it correctly — NOT to start building unless the owner explicitly says "build it
now". Follow the project's working agreement (`CLAUDE.md` → "How to work in this repo").

## 1. Rebuild the "what already exists" picture (read, don't guess)

These three are the canonical ledger of delivered + planned work:

- `CLAUDE.md` → **"## Requirements (from the product owner)"** — the `R1…Rn` checklist
  (`[x]` shipped, `[ ]` pending) is the master feature list.
- `ROADMAP.md` → the **Phases 0–17 checklist**, the **Decisions table (D1–D17)**, and the
  **"Build order (owner-directed)"** note.
- `memory/INDEX.md` + the newest `memory/*.md` — what actually shipped and why.

## 2. Compare the request against them

Classify the requested feature as exactly one of:

- **Already delivered** → cite the `R#` / phase / file that covers it and stop. Don't
  duplicate. If the owner wants it *changed*, treat that as a new item (next step).
- **Partially covered / a follow-up** → name the existing item it extends, and add the
  delta as a sub-item or a new requirement that references it.
- **Net-new** → register it (next step).

If the request is ambiguous or could collide with a Decision (D1–D17), ask one crisp
clarifying question before writing anything.

## 3. Register it in the house style (the actual deliverable of this command)

Add the feature where the project keeps such things, matching existing entries exactly:

- **`CLAUDE.md` requirements list:** append `- [ ] R<next-number>: **Short title** — one
  or two sentences of scope. (D-ref if a decision applies · Phase <n> if it fits a phase)`.
  Use the next unused R-number (current max is **R24**, so start at **R25**).
- **`ROADMAP.md`:** if it's phase-sized, add a new `### Phase <n> — <name>` section (or a
  checkbox under the most relevant existing phase) with `- [ ]` items. If it implies a
  durable architectural choice, add a row to the **Decisions table** (next `D<n>`) with a
  one-line rationale, the way D1–D17 are written.
- Keep wording terse and outcome-focused — match the voice of the surrounding entries.

Do **not** invent scope the owner didn't ask for; capture their intent, sized to a phase
gate. Leave the new item **unchecked** (`[ ]`) — it's pending, not done.

## 4. Close out

- Briefly tell the owner: the classification, where you registered it (file + R#/phase),
  and the recommended sequencing relative to existing unfinished work.
- Do **not** run `make check`/commit just for doc edits unless the owner asks — but if you
  *did* write code, the normal gate applies (`make check`, `make e2e` for UI, commit only
  when green).
- The new item will be picked up by `/continue` in a later session.

The requested feature:

$ARGUMENTS
