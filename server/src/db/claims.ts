// Evidence-gated skill claims (R23): self-reported skills start unverified and
// only flip on interview evidence.
import { and, eq, ne, sql } from 'drizzle-orm'
import * as t from '../schema.js'
import { db, future } from './client.js'

// ── skill claims (evidence-gated knowledge, R23) ─────────────────────

export type ClaimStatus = 'unverified' | 'demonstrated' | 'weak'

export interface SkillClaim {
  id: number
  profile_id: number
  skill: string
  status: ClaimStatus
  evidence: string | null
  source_interview_id: number | null
  created_at: string
  updated_at: string
}

type ClaimRow = typeof t.skillClaims.$inferSelect

function toClaim(r: ClaimRow): SkillClaim {
  return {
    id: r.id,
    profile_id: r.profileId,
    skill: r.skill,
    status: r.status as ClaimStatus,
    evidence: r.evidence,
    source_interview_id: r.sourceInterviewId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

/** Record self-reported skills as `unverified` claims (idempotent per profile+skill). */
export async function seedClaims(profileId: number, skills: string[]): Promise<void> {
  const clean = [...new Set(skills.map((s) => s.trim()).filter(Boolean))]
  if (clean.length === 0) return
  await db
    .insert(t.skillClaims)
    .values(clean.map((skill) => ({ profileId, skill })))
    .onConflictDoNothing({ target: [t.skillClaims.profileId, t.skillClaims.skill] })
}

export async function listClaims(profileId: number): Promise<SkillClaim[]> {
  const rows = await db
    .select()
    .from(t.skillClaims)
    .where(eq(t.skillClaims.profileId, profileId))
    .orderBy(t.skillClaims.id)
  return rows.map(toClaim)
}

/**
 * Apply an interview's skill evidence to the profile's claims (R23). A `demonstrated`/`weak`
 * verdict updates the claim's status + evidence; `not_shown` leaves it unverified. Only known
 * claims are touched (the candidate can't verify a skill they never claimed). A `demonstrated`
 * verdict never downgrades to `weak` on a later session — shown ability sticks; a `weak` verdict
 * can still flip a claim that was only `unverified`.
 */
export async function applySkillEvidence(
  profileId: number,
  interviewId: number,
  evidence: { skill: string; verdict: string; note?: string }[],
): Promise<void> {
  for (const e of evidence) {
    const status: ClaimStatus | null =
      e.verdict === 'demonstrated' ? 'demonstrated' : e.verdict === 'weak' ? 'weak' : null
    if (!status) continue
    await db
      .update(t.skillClaims)
      .set({ status, evidence: e.note ?? null, sourceInterviewId: interviewId, updatedAt: future(0) })
      .where(
        and(
          eq(t.skillClaims.profileId, profileId),
          eq(t.skillClaims.skill, e.skill),
          // Don't downgrade an already-demonstrated skill back to weak on a later interview.
          status === 'weak' ? ne(t.skillClaims.status, 'demonstrated') : sql`true`,
        ),
      )
  }
}
