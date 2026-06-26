# 2026-06-26 — R23: Evidence-gated knowledge (Phase 17 — final item)

A self-reported skill is no longer taken as fact: it's a **claim** that stays `unverified` until an
interview actually demonstrates it. The profile/level reflect *shown* ability, not self-report.
Closes Phase 17 (R21 ✅ R22 ✅ R23 ✅ R24 ✅).

## What shipped
- **`skill_claims` table** (migration `0006_exotic_phalanx.sql`): per-profile, unique on
  (profile, skill); `status` ∈ `unverified` | `demonstrated` | `weak`; `evidence`,
  `source_interview_id`, timestamps. (13 tables now.)
- **db.ts:** `seedClaims(profileId, skills)` (idempotent insert, called from `createProfile` for the
  profile's technologies), `listClaims`, `applySkillEvidence(profileId, interviewId, evidence[])`
  — flips claims by verdict; a `weak` verdict can't downgrade an already-`demonstrated` claim
  (`ne(status,'demonstrated')` guard); `not_shown` leaves it unverified.
- **prompts.ts (code-level, version-proof — like the guardrail, NOT in the editable body):**
  - `claimsBlock(claims)` appended to the interview system prompt: tells the interviewer to treat
    claimed skills as unverified and probe them (and not re-grill already-demonstrated ones).
  - `evidenceInstruction(claims)` appended to the evaluation prompt: asks for a `skill_evidence`
    array `[{skill, verdict: demonstrated|weak|not_shown, note}]`, judged strictly from the transcript.
  - `renderInterviewSystem` / `renderEvaluation` gained an optional `claims` param (defaults `[]`).
- **routes.ts:** `systemFor` passes the profile's claims into the interview prompt; `finish` passes
  them into the evaluation and calls `applySkillEvidence(report.skill_evidence)`. `/profile` now
  returns `skill_claims`.
- **web:** Dashboard "Your skills — shown vs. claimed" card — badges: ✓ shown (demonstrated) /
  needs work (weak) / claimed — unproven (unverified), with the evidence note on hover. `api.ts`
  `SkillClaim` type + `Profile.skill_claims`.
- **mock provider:** the eval branch parses the appended "claimed these skills: …" list and emits
  `skill_evidence` (first skill → weak, rest → demonstrated) so the cycle is testable offline.

## Decisions / gotchas
- Behavioral framing kept **in code, not the admin-editable prompt body** — otherwise changing the
  seed wouldn't reach already-seeded DB prompt versions (the Phase 14 versioning tension). Same
  pattern as the guardrail.
- Claims seed from `profile.technologies` only (the structured self-report). `notes` free-text isn't
  parsed into claims — out of scope.
- Calibration still keys off role/level; evidence-gating lives in the full interview + evaluation
  (where there's a transcript to judge). Noted, not a gap.
- Verify-script gotcha: `profileSchema` rejects explicit `null` for optional `company/skill_pack`
  (zod `.optional()` ≠ nullable) — omit the field instead.

## Verified
- `make check` (incl. guardrail unit test — `renderInterviewSystem` claims param defaults safely)
  + `make e2e` green. Live (test DB + mock): new profile seeds Go/PostgreSQL as `unverified`;
  after one interview+finish the eval's `skill_evidence` flips Go→weak, PostgreSQL→demonstrated with
  notes; `/profile` reflects it.

## Next
- **All owner-directed phases (11–17) are done.** Next is owner's call: ROADMAP Phase 4
  (personalization / user-model doc), Phase 5 (resume + job pipeline), Phase 7 (learn-while-
  interviewing), or new direction.
