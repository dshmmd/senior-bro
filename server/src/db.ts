import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { DATA_DIR, ensureDataDir } from './config.js'

export interface Profile {
  id: number
  role: string
  company: string | null
  skill_pack: string | null
  technologies: string[]
  years_experience: number
  notes: string | null
  level: string | null
  level_summary: string | null
  created_at: string
}

export interface InterviewRow {
  id: number
  profile_id: number
  mode: 'voice' | 'text'
  kind: 'full' | 'coaching'
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

let db: DatabaseSync

export function initDb(): void {
  ensureDataDir()
  db = new DatabaseSync(path.join(DATA_DIR, 'data.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      company TEXT,
      skill_pack TEXT,
      technologies TEXT NOT NULL DEFAULT '[]',
      years_experience INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      level TEXT,
      level_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS calibrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id),
      questions TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id),
      mode TEXT NOT NULL DEFAULT 'text',
      kind TEXT NOT NULL DEFAULT 'full',
      status TEXT NOT NULL DEFAULT 'active',
      transcript TEXT NOT NULL DEFAULT '[]',
      report TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS weaknesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id),
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      fix TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      source_interview_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToProfile(r: Record<string, unknown>): Profile {
  return { ...(r as object), technologies: JSON.parse(r.technologies as string) as string[] } as Profile
}

export function createProfile(p: {
  role: string
  company: string | null
  skill_pack: string | null
  technologies: string[]
  years_experience: number
  notes: string | null
}): Profile {
  const stmt = db.prepare(
    `INSERT INTO profiles (role, company, skill_pack, technologies, years_experience, notes)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
  )
  const row = stmt.get(
    p.role,
    p.company,
    p.skill_pack,
    JSON.stringify(p.technologies),
    p.years_experience,
    p.notes,
  ) as Record<string, unknown>
  return rowToProfile(row)
}

export function latestProfile(): Profile | null {
  const row = db.prepare('SELECT * FROM profiles ORDER BY id DESC LIMIT 1').get() as
    | Record<string, unknown>
    | undefined
  return row ? rowToProfile(row) : null
}

export function getProfile(id: number): Profile | null {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToProfile(row) : null
}

export function setProfileLevel(id: number, level: string, summary: string): void {
  db.prepare('UPDATE profiles SET level = ?, level_summary = ? WHERE id = ?').run(level, summary, id)
}

export function createCalibration(profileId: number, questions: unknown): number {
  const row = db
    .prepare('INSERT INTO calibrations (profile_id, questions) VALUES (?, ?) RETURNING id')
    .get(profileId, JSON.stringify(questions)) as { id: number }
  return row.id
}

export function getCalibration(id: number): { id: number; profile_id: number; questions: unknown } | null {
  const row = db.prepare('SELECT * FROM calibrations WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return null
  return {
    id: row.id as number,
    profile_id: row.profile_id as number,
    questions: JSON.parse(row.questions as string),
  }
}

export function saveCalibrationResult(id: number, result: unknown): void {
  db.prepare('UPDATE calibrations SET result = ? WHERE id = ?').run(JSON.stringify(result), id)
}

function rowToInterview(r: Record<string, unknown>): InterviewRow {
  return {
    ...(r as object),
    transcript: JSON.parse(r.transcript as string) as TranscriptEntry[],
    report: r.report ? (JSON.parse(r.report as string) as InterviewReport) : null,
  } as InterviewRow
}

export function createInterview(profileId: number, mode: string, kind: string): InterviewRow {
  const row = db
    .prepare('INSERT INTO interviews (profile_id, mode, kind) VALUES (?, ?, ?) RETURNING *')
    .get(profileId, mode, kind) as Record<string, unknown>
  return rowToInterview(row)
}

export function getInterview(id: number): InterviewRow | null {
  const row = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToInterview(row) : null
}

export function listInterviews(): InterviewRow[] {
  const rows = db.prepare('SELECT * FROM interviews ORDER BY id DESC').all() as Record<string, unknown>[]
  return rows.map(rowToInterview)
}

export function saveTranscript(id: number, transcript: TranscriptEntry[]): void {
  db.prepare('UPDATE interviews SET transcript = ? WHERE id = ?').run(JSON.stringify(transcript), id)
}

export function finishInterview(id: number, report: InterviewReport): void {
  db.prepare(
    `UPDATE interviews SET status = 'finished', report = ?, finished_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(report), id)
}

export function addWeakness(
  profileId: number,
  w: { title: string; detail: string; fix: string },
  sourceInterviewId: number | null,
): void {
  db.prepare(
    'INSERT INTO weaknesses (profile_id, title, detail, fix, source_interview_id) VALUES (?, ?, ?, ?, ?)',
  ).run(profileId, w.title, w.detail, w.fix, sourceInterviewId)
}

export function listWeaknesses(profileId: number): Weakness[] {
  return db
    .prepare('SELECT * FROM weaknesses WHERE profile_id = ? ORDER BY id DESC')
    .all(profileId) as unknown as Weakness[]
}

export function getWeakness(id: number): Weakness | null {
  return (
    (db.prepare('SELECT * FROM weaknesses WHERE id = ?').get(id) as unknown as Weakness | undefined) ?? null
  )
}

export function setWeaknessStatus(id: number, status: string): void {
  db.prepare('UPDATE weaknesses SET status = ? WHERE id = ?').run(status, id)
}
