// Interviews (transcripts, reports, resume/discard D14) and weaknesses (R7).
import { desc, eq } from 'drizzle-orm'
import * as t from '../schema.js'
import { db, future } from './client.js'

export interface InterviewRow {
  id: number
  profile_id: number
  mode: 'voice' | 'text'
  kind: 'full' | 'coaching'
  domain: 'technical' | 'hr'
  status: 'active' | 'finished'
  transcript: TranscriptEntry[]
  report: InterviewReport | null
  created_at: string
  finished_at: string | null
}

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  content: string
}

export interface InterviewReport {
  overall_score: number
  level_estimate: string
  dimensions: { name: string; score: number; comment: string }[]
  strengths: string[]
  weaknesses: { title: string; detail: string; fix: string }[]
  advice: string
}

export interface Weakness {
  id: number
  profile_id: number
  title: string
  detail: string
  fix: string
  status: 'open' | 'improving' | 'resolved'
  source_interview_id: number | null
  created_at: string
}

// ── interviews ───────────────────────────────────────────────────────

type InterviewDbRow = typeof t.interviews.$inferSelect

function toInterview(r: InterviewDbRow): InterviewRow {
  return {
    id: r.id,
    profile_id: r.profileId,
    mode: r.mode as 'voice' | 'text',
    kind: r.kind as 'full' | 'coaching',
    domain: r.domain as 'technical' | 'hr',
    status: r.status as 'active' | 'finished',
    transcript: JSON.parse(r.transcript) as TranscriptEntry[],
    report: r.report ? (JSON.parse(r.report) as InterviewReport) : null,
    created_at: r.createdAt,
    finished_at: r.finishedAt,
  }
}

export async function createInterview(
  profileId: number,
  mode: string,
  kind: string,
  domain = 'technical',
): Promise<InterviewRow> {
  const [row] = await db.insert(t.interviews).values({ profileId, mode, kind, domain }).returning()
  return toInterview(row!)
}

export async function getInterview(id: number): Promise<InterviewRow | null> {
  const [row] = await db.select().from(t.interviews).where(eq(t.interviews.id, id))
  return row ? toInterview(row) : null
}

export async function listInterviews(): Promise<InterviewRow[]> {
  const rows = await db.select().from(t.interviews).orderBy(desc(t.interviews.id))
  return rows.map(toInterview)
}

export async function listInterviewsForUser(userId: number): Promise<InterviewRow[]> {
  const rows = await db
    .select({ i: t.interviews })
    .from(t.interviews)
    .innerJoin(t.profiles, eq(t.profiles.id, t.interviews.profileId))
    .where(eq(t.profiles.userId, userId))
    .orderBy(desc(t.interviews.id))
  return rows.map((r) => toInterview(r.i))
}

export async function saveTranscript(id: number, transcript: TranscriptEntry[]): Promise<void> {
  await db
    .update(t.interviews)
    .set({ transcript: JSON.stringify(transcript) })
    .where(eq(t.interviews.id, id))
}

export async function finishInterview(id: number, report: InterviewReport): Promise<void> {
  await db
    .update(t.interviews)
    .set({ status: 'finished', report: JSON.stringify(report), finishedAt: future(0) })
    .where(eq(t.interviews.id, id))
}

/** Discard an interview outright (used to drop an abandoned, in-progress one). */
export async function deleteInterview(id: number): Promise<void> {
  await db.delete(t.interviews).where(eq(t.interviews.id, id))
}

// ── weaknesses ───────────────────────────────────────────────────────

type WeaknessRow = typeof t.weaknesses.$inferSelect

function toWeakness(r: WeaknessRow): Weakness {
  return {
    id: r.id,
    profile_id: r.profileId,
    title: r.title,
    detail: r.detail,
    fix: r.fix,
    status: r.status as 'open' | 'improving' | 'resolved',
    source_interview_id: r.sourceInterviewId,
    created_at: r.createdAt,
  }
}

export async function addWeakness(
  profileId: number,
  w: { title: string; detail: string; fix: string },
  sourceInterviewId: number | null,
): Promise<void> {
  await db
    .insert(t.weaknesses)
    .values({ profileId, title: w.title, detail: w.detail, fix: w.fix, sourceInterviewId })
}

export async function listWeaknesses(profileId: number): Promise<Weakness[]> {
  const rows = await db
    .select()
    .from(t.weaknesses)
    .where(eq(t.weaknesses.profileId, profileId))
    .orderBy(desc(t.weaknesses.id))
  return rows.map(toWeakness)
}

export async function getWeakness(id: number): Promise<Weakness | null> {
  const [row] = await db.select().from(t.weaknesses).where(eq(t.weaknesses.id, id))
  return row ? toWeakness(row) : null
}

export async function setWeaknessStatus(id: number, status: string): Promise<void> {
  await db.update(t.weaknesses).set({ status }).where(eq(t.weaknesses.id, id))
}
