import { fileURLToPath } from 'node:url'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { DEFAULT_MODELS, isCliProvider, loadConfig, type AppConfig, type Provider } from './config.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import { LOCAL_USER_ID } from './mode.js'
import * as t from './schema.js'

// ── public row shapes (snake_case — unchanged so routes/web don't move) ──

export interface User {
  id: number
  email: string | null
  role: 'user' | 'admin'
  model_id: number | null
  token_quota: number | null
  created_at: string
}

export interface ModelOption {
  id: number
  label: string
  provider: string
  model: string
  enabled: boolean
  is_default: boolean
  price_in: number // USD per 1M input tokens
  price_out: number // USD per 1M output tokens
  has_key: boolean
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

export interface UsageSummary {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  events: number
}

// ── connection + migrations ──────────────────────────────────────────

let pool: Pool
let db: NodePgDatabase<typeof t>

const DEFAULT_DB_URL = 'postgres://senior:senior@localhost:5433/senior_bro'

/** Connect, apply pending migrations, seed the local owner + legacy config. */
export async function initDb(): Promise<void> {
  pool = new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DB_URL })
  db = drizzle(pool, { schema: t })
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
  await migrate(db, { migrationsFolder })
  await seed()
}

async function seed(): Promise<void> {
  // Stable local owner (also the bootstrap admin); explicit id so local mode never auths.
  await db
    .insert(t.users)
    .values({ id: LOCAL_USER_ID, email: 'local@senior-bro', role: 'admin' })
    .onConflictDoNothing()
  // Inserting an explicit id leaves the serial sequence behind — advance it past max(id).
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))`,
  )
  // Back-fill any pre-accounts profiles onto the local owner (no-op on a fresh DB).
  await db
    .update(t.profiles)
    .set({ userId: LOCAL_USER_ID })
    .where(sql`${t.profiles.userId} IS NULL`)
  // One-time import of the legacy ~/.senior-bro/config.json into the local user.
  const local = await getUser(LOCAL_USER_ID)
  if (local && (await getUserConfig(LOCAL_USER_ID)) === null) {
    const legacy = loadConfig()
    if (legacy) await setUserConfig(LOCAL_USER_ID, legacy)
  }
}

/** ISO-ish timestamp `ms` from now, as a plain (no-TZ) string for timestamp columns. */
function future(ms: number): string {
  return new Date(Date.now() + ms).toISOString().replace('T', ' ').replace('Z', '')
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

export async function getProfile(id: number): Promise<Profile | null> {
  const [row] = await db.select().from(t.profiles).where(eq(t.profiles.id, id))
  return row ? toProfile(row) : null
}

export async function setProfileLevel(id: number, level: string, summary: string): Promise<void> {
  await db.update(t.profiles).set({ level, levelSummary: summary }).where(eq(t.profiles.id, id))
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

// ── interviews ───────────────────────────────────────────────────────

type InterviewDbRow = typeof t.interviews.$inferSelect

function toInterview(r: InterviewDbRow): InterviewRow {
  return {
    id: r.id,
    profile_id: r.profileId,
    mode: r.mode as 'voice' | 'text',
    kind: r.kind as 'full' | 'coaching',
    status: r.status as 'active' | 'finished',
    transcript: JSON.parse(r.transcript) as TranscriptEntry[],
    report: r.report ? (JSON.parse(r.report) as InterviewReport) : null,
    created_at: r.createdAt,
    finished_at: r.finishedAt,
  }
}

export async function createInterview(profileId: number, mode: string, kind: string): Promise<InterviewRow> {
  const [row] = await db.insert(t.interviews).values({ profileId, mode, kind }).returning()
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

// ── users, sessions, magic links ─────────────────────────────────────

type UserRow = typeof t.users.$inferSelect

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    role: r.role as 'user' | 'admin',
    model_id: r.modelId,
    token_quota: r.tokenQuota,
    created_at: r.createdAt,
  }
}

export async function getUser(id: number): Promise<User | null> {
  const [row] = await db.select().from(t.users).where(eq(t.users.id, id))
  return row ? toUser(row) : null
}

export async function upsertUserByEmail(email: string): Promise<User> {
  const [existing] = await db.select().from(t.users).where(eq(t.users.email, email))
  if (existing) return toUser(existing)
  const [row] = await db.insert(t.users).values({ email, role: 'user' }).returning()
  return toUser(row!)
}

export async function createMagicLink(email: string, token: string, ttlMinutes: number): Promise<void> {
  await db.insert(t.magicLinks).values({ token, email, expiresAt: future(ttlMinutes * 60_000) })
}

export async function consumeMagicLink(token: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(t.magicLinks)
    .where(
      and(
        eq(t.magicLinks.token, token),
        eq(t.magicLinks.used, false),
        gt(t.magicLinks.expiresAt, sql`now()`),
      ),
    )
  if (!row) return null
  await db.update(t.magicLinks).set({ used: true }).where(eq(t.magicLinks.token, token))
  return row.email
}

export async function createSession(userId: number, token: string, ttlDays: number): Promise<void> {
  await db.insert(t.sessions).values({ token, userId, expiresAt: future(ttlDays * 86_400_000) })
}

export async function userForSession(token: string): Promise<User | null> {
  const [row] = await db
    .select({ u: t.users })
    .from(t.sessions)
    .innerJoin(t.users, eq(t.users.id, t.sessions.userId))
    .where(and(eq(t.sessions.token, token), gt(t.sessions.expiresAt, sql`now()`)))
  return row ? toUser(row.u) : null
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(t.sessions).where(eq(t.sessions.token, token))
}

export async function setUserRole(userId: number, role: 'user' | 'admin'): Promise<void> {
  await db.update(t.users).set({ role }).where(eq(t.users.id, userId))
}

export async function setUserModelChoice(userId: number, modelId: number): Promise<void> {
  // Selecting a curated model clears the personal BYOK key (host key is used instead).
  await db
    .update(t.users)
    .set({ modelId, provider: null, model: null, apiKeyEnc: null })
    .where(eq(t.users.id, userId))
}

export async function setUserQuota(userId: number, quota: number | null): Promise<void> {
  await db.update(t.users).set({ tokenQuota: quota }).where(eq(t.users.id, userId))
}

export async function listUsers(): Promise<User[]> {
  const rows = await db.select().from(t.users).orderBy(t.users.id)
  return rows.map(toUser)
}

// ── per-user provider config (api key encrypted at rest) ─────────────

export async function getUserConfig(userId: number): Promise<AppConfig | null> {
  const [row] = await db
    .select({ provider: t.users.provider, model: t.users.model, key: t.users.apiKeyEnc })
    .from(t.users)
    .where(eq(t.users.id, userId))
  if (!row?.provider) return null
  const provider = row.provider as Provider
  const apiKey = row.key ? decryptSecret(row.key) : ''
  if (!isCliProvider(provider) && !apiKey) return null
  return { provider, apiKey, model: row.model ?? DEFAULT_MODELS[provider] }
}

export async function setUserConfig(userId: number, cfg: AppConfig): Promise<void> {
  // Choosing a personal provider/key clears any admin-curated model selection.
  await db
    .update(t.users)
    .set({
      provider: cfg.provider,
      model: cfg.model,
      apiKeyEnc: cfg.apiKey ? encryptSecret(cfg.apiKey) : null,
      modelId: null,
    })
    .where(eq(t.users.id, userId))
}

// ── model catalog (admin-curated providers + keys) ───────────────────

type ModelRow = typeof t.models.$inferSelect

function toModel(r: ModelRow): ModelOption {
  return {
    id: r.id,
    label: r.label,
    provider: r.provider,
    model: r.model,
    enabled: r.enabled,
    is_default: r.isDefault,
    price_in: r.priceIn,
    price_out: r.priceOut,
    has_key: Boolean(r.apiKeyEnc),
  }
}

export async function listModels(enabledOnly = false): Promise<ModelOption[]> {
  const base = db.select().from(t.models)
  const rows = await (enabledOnly ? base.where(eq(t.models.enabled, true)) : base).orderBy(
    desc(t.models.isDefault),
    t.models.id,
  )
  return rows.map(toModel)
}

export async function getModel(id: number): Promise<ModelOption | null> {
  const [row] = await db.select().from(t.models).where(eq(t.models.id, id))
  return row ? toModel(row) : null
}

/** Resolve a catalog model into a usable AppConfig (decrypts the host key). */
export async function modelConfig(id: number): Promise<{ cfg: AppConfig; option: ModelOption } | null> {
  const [row] = await db.select().from(t.models).where(eq(t.models.id, id))
  if (!row) return null
  const option = toModel(row)
  const apiKey = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : ''
  return { option, cfg: { provider: option.provider as Provider, apiKey, model: option.model } }
}

export async function createModel(m: {
  label: string
  provider: string
  model: string
  apiKey: string
  enabled: boolean
  is_default: boolean
  price_in: number
  price_out: number
}): Promise<ModelOption> {
  if (m.is_default) await db.update(t.models).set({ isDefault: false })
  const [row] = await db
    .insert(t.models)
    .values({
      label: m.label,
      provider: m.provider,
      model: m.model,
      apiKeyEnc: m.apiKey ? encryptSecret(m.apiKey) : null,
      enabled: m.enabled,
      isDefault: m.is_default,
      priceIn: m.price_in,
      priceOut: m.price_out,
    })
    .returning()
  return toModel(row!)
}

export async function updateModel(
  id: number,
  patch: Partial<{
    label: string
    enabled: boolean
    is_default: boolean
    price_in: number
    price_out: number
    apiKey: string // '' leaves the existing key untouched
  }>,
): Promise<ModelOption | null> {
  const [current] = await db.select().from(t.models).where(eq(t.models.id, id))
  if (!current) return null
  if (patch.is_default) await db.update(t.models).set({ isDefault: false })
  await db
    .update(t.models)
    .set({
      label: patch.label ?? current.label,
      enabled: patch.enabled ?? current.enabled,
      isDefault: patch.is_default ?? current.isDefault,
      priceIn: patch.price_in ?? current.priceIn,
      priceOut: patch.price_out ?? current.priceOut,
      apiKeyEnc: patch.apiKey ? encryptSecret(patch.apiKey) : current.apiKeyEnc,
    })
    .where(eq(t.models.id, id))
  return getModel(id)
}

export async function deleteModel(id: number): Promise<void> {
  await db.delete(t.models).where(eq(t.models.id, id))
  await db.update(t.users).set({ modelId: null }).where(eq(t.users.modelId, id))
}

// ── usage metering & quotas ──────────────────────────────────────────

export async function recordUsage(e: {
  userId: number
  modelId: number | null
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}): Promise<void> {
  await db.insert(t.usageEvents).values({
    userId: e.userId,
    modelId: e.modelId,
    provider: e.provider,
    model: e.model,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    costUsd: e.costUsd,
  })
}

// Aggregates are cast in SQL (::int / ::float8) so node-postgres returns real JS
// numbers — without the cast, SUM/COUNT come back as bigint strings.
/** Total tokens (in+out) a user has consumed — the figure quotas are checked against. */
export async function tokensUsed(userId: number): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`COALESCE(SUM(${t.usageEvents.inputTokens} + ${t.usageEvents.outputTokens}), 0)::int`,
    })
    .from(t.usageEvents)
    .where(eq(t.usageEvents.userId, userId))
  return row?.n ?? 0
}

export async function usageSummary(userId: number): Promise<UsageSummary> {
  const [row] = await db
    .select({
      input_tokens: sql<number>`COALESCE(SUM(${t.usageEvents.inputTokens}), 0)::int`,
      output_tokens: sql<number>`COALESCE(SUM(${t.usageEvents.outputTokens}), 0)::int`,
      total_tokens: sql<number>`COALESCE(SUM(${t.usageEvents.inputTokens} + ${t.usageEvents.outputTokens}), 0)::int`,
      cost_usd: sql<number>`COALESCE(SUM(${t.usageEvents.costUsd}), 0)::float8`,
      events: sql<number>`COUNT(*)::int`,
    })
    .from(t.usageEvents)
    .where(eq(t.usageEvents.userId, userId))
  return {
    input_tokens: row?.input_tokens ?? 0,
    output_tokens: row?.output_tokens ?? 0,
    total_tokens: row?.total_tokens ?? 0,
    cost_usd: row?.cost_usd ?? 0,
    events: row?.events ?? 0,
  }
}
