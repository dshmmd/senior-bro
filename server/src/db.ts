import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import {
  DATA_DIR,
  DEFAULT_MODELS,
  ensureDataDir,
  isCliProvider,
  loadConfig,
  type AppConfig,
  type Provider,
} from './config.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import { LOCAL_USER_ID } from './mode.js'

export interface User {
  id: number
  email: string | null
  role: 'user' | 'admin'
  created_at: string
}

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
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      provider TEXT,
      model TEXT,
      api_key_enc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS magic_links (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
  migrate()
}

/** Additive, idempotent migrations for databases created before accounts existed. */
function migrate(): void {
  const cols = (db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('user_id')) {
    db.exec('ALTER TABLE profiles ADD COLUMN user_id INTEGER')
  }

  // Seed the implicit local owner (also the bootstrap admin). Stable id so local
  // mode never has to authenticate.
  db.prepare(`INSERT OR IGNORE INTO users (id, email, role) VALUES (?, 'local@senior-bro', 'admin')`).run(
    LOCAL_USER_ID,
  )

  // Back-fill any pre-accounts profiles onto the local owner.
  db.prepare('UPDATE profiles SET user_id = ? WHERE user_id IS NULL').run(LOCAL_USER_ID)

  // One-time import of the legacy ~/.senior-bro/config.json into the local user
  // (only if that user has no provider configured yet).
  const localCfg = db.prepare('SELECT provider FROM users WHERE id = ?').get(LOCAL_USER_ID) as
    | { provider: string | null }
    | undefined
  if (localCfg && !localCfg.provider) {
    const legacy = loadConfig()
    if (legacy) setUserConfig(LOCAL_USER_ID, legacy)
  }
}

function rowToProfile(r: Record<string, unknown>): Profile {
  return { ...(r as object), technologies: JSON.parse(r.technologies as string) as string[] } as Profile
}

export function createProfile(
  userId: number,
  p: {
    role: string
    company: string | null
    skill_pack: string | null
    technologies: string[]
    years_experience: number
    notes: string | null
  },
): Profile {
  const stmt = db.prepare(
    `INSERT INTO profiles (user_id, role, company, skill_pack, technologies, years_experience, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
  const row = stmt.get(
    userId,
    p.role,
    p.company,
    p.skill_pack,
    JSON.stringify(p.technologies),
    p.years_experience,
    p.notes,
  ) as Record<string, unknown>
  return rowToProfile(row)
}

export function latestProfile(userId: number): Profile | null {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) as
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

export function listInterviewsForUser(userId: number): InterviewRow[] {
  const rows = db
    .prepare(
      `SELECT i.* FROM interviews i JOIN profiles p ON p.id = i.profile_id
       WHERE p.user_id = ? ORDER BY i.id DESC`,
    )
    .all(userId) as Record<string, unknown>[]
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

// ── users, sessions, magic links (hosted accounts) ───────────────────

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: r.id as number,
    email: r.email as string | null,
    role: r.role as 'user' | 'admin',
    created_at: r.created_at as string,
  }
}

export function getUser(id: number): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToUser(row) : null
}

/** Find a user by email, creating one on first sight (magic-link signup). */
export function upsertUserByEmail(email: string): User {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | Record<string, unknown>
    | undefined
  if (existing) return rowToUser(existing)
  const row = db
    .prepare(`INSERT INTO users (email, role) VALUES (?, 'user') RETURNING *`)
    .get(email) as Record<string, unknown>
  return rowToUser(row)
}

export function createMagicLink(email: string, token: string, ttlMinutes: number): void {
  db.prepare(`INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, datetime('now', ?))`).run(
    token,
    email,
    `+${ttlMinutes} minutes`,
  )
}

/** Consume a magic link: returns the email if the token is valid & unused, else null. */
export function consumeMagicLink(token: string): string | null {
  const row = db
    .prepare(`SELECT email FROM magic_links WHERE token = ? AND used = 0 AND expires_at > datetime('now')`)
    .get(token) as { email: string } | undefined
  if (!row) return null
  db.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').run(token)
  return row.email
}

export function createSession(userId: number, token: string, ttlDays: number): void {
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(
    token,
    userId,
    `+${ttlDays} days`,
  )
}

export function userForSession(token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as Record<string, unknown> | undefined
  return row ? rowToUser(row) : null
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

// ── per-user provider config (api key encrypted at rest) ─────────────

export function getUserConfig(userId: number): AppConfig | null {
  const row = db.prepare('SELECT provider, model, api_key_enc FROM users WHERE id = ?').get(userId) as
    | { provider: string | null; model: string | null; api_key_enc: string | null }
    | undefined
  if (!row?.provider) return null
  const provider = row.provider as Provider
  const apiKey = row.api_key_enc ? decryptSecret(row.api_key_enc) : ''
  // Mirror legacy loadConfig semantics: API-key providers need a key to be "configured".
  if (!isCliProvider(provider) && !apiKey) return null
  return { provider, apiKey, model: row.model ?? DEFAULT_MODELS[provider] }
}

export function setUserConfig(userId: number, cfg: AppConfig): void {
  db.prepare('UPDATE users SET provider = ?, model = ?, api_key_enc = ? WHERE id = ?').run(
    cfg.provider,
    cfg.model,
    cfg.apiKey ? encryptSecret(cfg.apiKey) : null,
    userId,
  )
}
