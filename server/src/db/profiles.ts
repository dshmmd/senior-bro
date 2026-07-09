// Profiles (multi-profile R24, delete-cascade R36), free-tier first-impression
// accounting (R32/D21), and calibrations.
import { and, desc, eq, sql } from 'drizzle-orm'
import { LOCAL_USER_ID } from '../mode.js'
import * as t from '../schema.js'
import { db } from './client.js'
import { getUser } from './users.js'
import { seedClaims } from './claims.js'

export interface Profile {
  id: number
  user_id: number
  role: string
  company: string | null
  skill_pack: string | null
  technologies: string[]
  years_experience: number
  notes: string | null
  level: string | null
  level_summary: string | null
  first_impression_at: string | null
  created_at: string
}

// ── profiles ─────────────────────────────────────────────────────────

type ProfileRow = typeof t.profiles.$inferSelect

function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    user_id: r.userId ?? LOCAL_USER_ID,
    role: r.role,
    company: r.company,
    skill_pack: r.skillPack,
    technologies: JSON.parse(r.technologies) as string[],
    years_experience: r.yearsExperience,
    notes: r.notes,
    level: r.level,
    level_summary: r.levelSummary,
    first_impression_at: r.firstImpressionAt,
    created_at: r.createdAt,
  }
}

export async function createProfile(
  userId: number,
  p: {
    role: string
    company: string | null
    skill_pack: string | null
    technologies: string[]
    years_experience: number
    notes: string | null
  },
): Promise<Profile> {
  const [row] = await db
    .insert(t.profiles)
    .values({
      userId,
      role: p.role,
      company: p.company,
      skillPack: p.skill_pack,
      technologies: JSON.stringify(p.technologies),
      yearsExperience: p.years_experience,
      notes: p.notes,
    })
    .returning()
  // A freshly created profile becomes the user's active one (R24).
  await db.update(t.users).set({ activeProfileId: row!.id }).where(eq(t.users.id, userId))
  // Evidence-gating (R23): each self-reported technology starts as an *unverified* claim.
  await seedClaims(row!.id, p.technologies)
  return toProfile(row!)
}

export async function latestProfile(userId: number): Promise<Profile | null> {
  const [row] = await db
    .select()
    .from(t.profiles)
    .where(eq(t.profiles.userId, userId))
    .orderBy(desc(t.profiles.id))
    .limit(1)
  return row ? toProfile(row) : null
}

/** All of a user's profiles, newest first (R24 — the "your profiles" switcher). */
export async function listProfiles(userId: number): Promise<Profile[]> {
  const rows = await db
    .select()
    .from(t.profiles)
    .where(eq(t.profiles.userId, userId))
    .orderBy(desc(t.profiles.id))
  return rows.map(toProfile)
}

/** The user's active profile (their explicit choice if valid, else their latest). */
export async function activeProfile(userId: number): Promise<Profile | null> {
  const user = await getUser(userId)
  if (user?.active_profile_id != null) {
    const chosen = await getProfile(user.active_profile_id)
    if (chosen?.user_id === userId) return chosen
  }
  return latestProfile(userId)
}

/** Switch the user's active profile (R24). Caller must verify ownership of `profileId`. */
export async function setActiveProfile(userId: number, profileId: number): Promise<void> {
  await db.update(t.users).set({ activeProfileId: profileId }).where(eq(t.users.id, userId))
}

export async function getProfile(id: number): Promise<Profile | null> {
  const [row] = await db.select().from(t.profiles).where(eq(t.profiles.id, id))
  return row ? toProfile(row) : null
}

export async function setProfileLevel(id: number, level: string, summary: string): Promise<void> {
  await db.update(t.profiles).set({ level, levelSummary: summary }).where(eq(t.profiles.id, id))
}

/**
 * Edit a profile's fields (R31 review/edit + general editing). Caller must own `id`. Any newly
 * added technologies are seeded as unverified skill claims (R23; idempotent so existing ones stay).
 */
export async function updateProfile(
  id: number,
  p: {
    role: string
    company: string | null
    skill_pack: string | null
    technologies: string[]
    years_experience: number
    notes: string | null
  },
): Promise<Profile | null> {
  await db
    .update(t.profiles)
    .set({
      role: p.role,
      company: p.company,
      skillPack: p.skill_pack,
      technologies: JSON.stringify(p.technologies),
      yearsExperience: p.years_experience,
      notes: p.notes,
    })
    .where(eq(t.profiles.id, id))
  await seedClaims(id, p.technologies)
  return getProfile(id)
}

/**
 * Delete a profile and everything under it (R36). Child rows (interviews, weaknesses, skill
 * claims, events, calibrations, user model) cascade at the DB via their `profile_id` FKs; the
 * `users.active_profile_id` FK is `set null` on delete, so `activeProfile()` falls back to the
 * user's latest remaining profile. Caller must have verified ownership of `profileId`.
 */
export async function deleteProfile(profileId: number): Promise<void> {
  await db.delete(t.profiles).where(eq(t.profiles.id, profileId))
}

// ── free-tier "first impression" accounting (R32 / D21) ──────────────

/** How many of the user's profiles have consumed a free "first impression" credit. */
export async function firstImpressionCount(userId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.profiles)
    .where(and(eq(t.profiles.userId, userId), sql`${t.profiles.firstImpressionAt} is not null`))
  return row?.n ?? 0
}

/**
 * Mark a profile as having spent a first-impression credit (idempotent — only sets the timestamp
 * if it's still null, so re-checking the same position never re-burns). Returns true if this call
 * consumed the credit, false if it was already consumed.
 */
export async function consumeFirstImpression(profileId: number): Promise<boolean> {
  const res = await db
    .update(t.profiles)
    .set({ firstImpressionAt: new Date().toISOString() })
    .where(and(eq(t.profiles.id, profileId), sql`${t.profiles.firstImpressionAt} is null`))
    .returning({ id: t.profiles.id })
  return res.length > 0
}

// ── calibrations ─────────────────────────────────────────────────────

export async function createCalibration(profileId: number, questions: unknown): Promise<number> {
  const [row] = await db
    .insert(t.calibrations)
    .values({ profileId, questions: JSON.stringify(questions) })
    .returning({ id: t.calibrations.id })
  return row!.id
}

export async function getCalibration(
  id: number,
): Promise<{ id: number; profile_id: number; questions: unknown } | null> {
  const [row] = await db.select().from(t.calibrations).where(eq(t.calibrations.id, id))
  if (!row) return null
  return { id: row.id, profile_id: row.profileId, questions: JSON.parse(row.questions) }
}

export async function saveCalibrationResult(id: number, result: unknown): Promise<void> {
  await db
    .update(t.calibrations)
    .set({ result: JSON.stringify(result) })
    .where(eq(t.calibrations.id, id))
}
