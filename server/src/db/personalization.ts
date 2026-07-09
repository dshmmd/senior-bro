// Personalization (D2 / Phase 4): per-profile event log + distilled user model.
import { desc, eq } from 'drizzle-orm'
import * as t from '../schema.js'
import { db, future } from './client.js'

// ── personalization: event log + distilled user model (D2 / Phase 4) ─

export interface UserEvent {
  id: number
  profile_id: number
  kind: string
  detail: string
  interview_id: number | null
  created_at: string
}

export interface UserModel {
  profile_id: number
  summary: string
  edited: boolean
  updated_at: string
}

/** Append one activity event for a profile — raw material the user-model distiller reads. */
export async function recordEvent(
  profileId: number,
  kind: string,
  detail = '',
  interviewId: number | null = null,
): Promise<void> {
  await db.insert(t.userEvents).values({ profileId, kind, detail, interviewId })
}

/** Recent events for a profile, newest first (capped). */
export async function listEvents(profileId: number, limit = 50): Promise<UserEvent[]> {
  const rows = await db
    .select()
    .from(t.userEvents)
    .where(eq(t.userEvents.profileId, profileId))
    .orderBy(desc(t.userEvents.id))
    .limit(limit)
  return rows.map((r) => ({
    id: r.id,
    profile_id: r.profileId,
    kind: r.kind,
    detail: r.detail,
    interview_id: r.interviewId,
    created_at: r.createdAt,
  }))
}

export async function getUserModel(profileId: number): Promise<UserModel | null> {
  const [row] = await db.select().from(t.userModels).where(eq(t.userModels.profileId, profileId))
  return row
    ? { profile_id: row.profileId, summary: row.summary, edited: row.edited, updated_at: row.updatedAt }
    : null
}

/** Upsert the distilled (or user-corrected) user-model document for a profile. */
export async function setUserModel(profileId: number, summary: string, edited: boolean): Promise<void> {
  await db
    .insert(t.userModels)
    .values({ profileId, summary, edited })
    .onConflictDoUpdate({
      target: t.userModels.profileId,
      set: { summary, edited, updatedAt: future(0) },
    })
}

/** Forget what we know about the candidate (the "delete my model" control, D6). */
export async function clearUserModel(profileId: number): Promise<void> {
  await db.delete(t.userModels).where(eq(t.userModels.profileId, profileId))
}
