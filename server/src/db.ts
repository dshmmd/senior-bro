import { fileURLToPath } from 'node:url'
import { and, desc, eq, gt, ne, sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { DEFAULT_MODELS, isCliProvider, loadConfig, type AppConfig, type Provider } from './config.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import { LOCAL_USER_ID } from './mode.js'
import { PROMPT_SEEDS, seedBody, type PromptKey } from './prompts.js'
import { loadSeedPacks, TIER_SEED_PACKS } from './skills.js'
import * as t from './schema.js'

// ── public row shapes (snake_case — unchanged so routes/web don't move) ──

export interface User {
  id: number
  email: string | null
  role: 'user' | 'admin'
  plan: PlanKind
  model_id: number | null
  token_quota: number | null
  active_profile_id: number | null
  created_at: string
}

/** Entitlement plan (D11). 'local' = the implicit local owner (always entitled). */
export type PlanKind = 'free-intro' | 'host' | 'byok' | 'local'

export interface InviteCode {
  code: string
  token_credit: number
  note: string | null
  revoked: boolean
  redeemed_by: number | null
  redeemed_at: string | null
  expires_at: string | null
  created_at: string
}

export interface ModelOption {
  id: number
  label: string
  provider: string
  model: string
  base_url: string | null // OpenAI-compatible custom endpoint (D19, Arvan)
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
  first_impression_at: string | null
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
    .values({ id: LOCAL_USER_ID, email: 'local@senior-bro', role: 'admin', plan: 'local' })
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
  await seedPrompts()
  await seedPacks()
}

/**
 * Seed the built-in packs into the DB once: the static `skills/*.md` companies (`source: 'seed'`)
 * and the tiered targets (`source: 'tier'`, stable `tier-N` slugs — R22). Both keyed by slug so
 * boot is idempotent and admins can edit/delete seeds without them reappearing on the next start.
 */
async function seedPacks(): Promise<void> {
  const existing = await db.select({ slug: t.companyPacks.slug }).from(t.companyPacks)
  const have = new Set(existing.map((r) => r.slug))
  const rows = [
    ...loadSeedPacks()
      .filter((p) => !have.has(packSlug(p.company)))
      .map((p) => ({
        slug: packSlug(p.company),
        company: p.company,
        roles: JSON.stringify(p.roles),
        summary: p.summary,
        body: p.body,
        status: 'published',
        source: 'seed',
      })),
    ...TIER_SEED_PACKS.filter((p) => !have.has(p.slug)).map((p) => ({
      slug: p.slug,
      company: p.company,
      roles: JSON.stringify(p.roles),
      summary: p.summary,
      body: p.body,
      status: 'published',
      source: 'tier',
    })),
  ]
  if (rows.length === 0) return
  await db.insert(t.companyPacks).values(rows)
}

/** Seed the default (version 1, author 'seed') body for any prompt key not yet in the DB (D12). */
async function seedPrompts(): Promise<void> {
  const existing = await db.selectDistinct({ key: t.prompts.promptKey }).from(t.prompts)
  const have = new Set(existing.map((r) => r.key))
  const missing = PROMPT_SEEDS.filter((s) => !have.has(s.key))
  if (missing.length === 0) return
  await db
    .insert(t.prompts)
    .values(
      missing.map((s) => ({ promptKey: s.key, version: 1, body: s.body, author: 'seed', active: true })),
    )
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

// ── users, sessions, magic links ─────────────────────────────────────

type UserRow = typeof t.users.$inferSelect

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    role: r.role as 'user' | 'admin',
    plan: r.plan as PlanKind,
    model_id: r.modelId,
    token_quota: r.tokenQuota,
    active_profile_id: r.activeProfileId,
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

export async function setUserPlan(userId: number, plan: PlanKind): Promise<void> {
  await db.update(t.users).set({ plan }).where(eq(t.users.id, userId))
}

/**
 * Grant token credit (D11). Adds to the existing allowance and flips the user to the
 * paid 'host' plan — used by mocked checkout and invite-code redemption.
 */
export async function grantCredit(userId: number, tokens: number): Promise<void> {
  await db
    .update(t.users)
    .set({ tokenQuota: sql`COALESCE(${t.users.tokenQuota}, 0) + ${tokens}`, plan: 'host' })
    .where(eq(t.users.id, userId))
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
    base_url: r.baseUrl,
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

/** The enabled default model — powers the free level-check for free-intro users (D11). */
export async function defaultModel(): Promise<ModelOption | null> {
  const [row] = await db
    .select()
    .from(t.models)
    .where(and(eq(t.models.enabled, true), eq(t.models.isDefault, true)))
    .limit(1)
  return row ? toModel(row) : null
}

// ── per-feature model routing (R35 / D23) ───────────────────────────

/** The model_id an admin assigned to a feature, if any and still enabled; else null (→ default). */
export async function assignedFeatureModel(featureKey: string): Promise<number | null> {
  const [row] = await db
    .select({ modelId: t.featureModels.modelId })
    .from(t.featureModels)
    .where(eq(t.featureModels.featureKey, featureKey))
  if (row?.modelId == null) return null
  const model = await getModel(row.modelId)
  return model?.enabled ? model.id : null
}

/** Every feature's current assignment (raw model_id, including disabled/missing) for the admin UI. */
export async function listFeatureModels(): Promise<Record<string, number | null>> {
  const rows = await db.select().from(t.featureModels)
  const map: Record<string, number | null> = {}
  for (const r of rows) map[r.featureKey] = r.modelId
  return map
}

/** Assign (or clear, with null) the model that powers a feature. Upserts on the feature key. */
export async function setFeatureModel(featureKey: string, modelId: number | null): Promise<void> {
  await db
    .insert(t.featureModels)
    .values({ featureKey, modelId, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: t.featureModels.featureKey,
      set: { modelId, updatedAt: new Date().toISOString() },
    })
}

/** Resolve a catalog model into a usable AppConfig (decrypts the host key). */
export async function modelConfig(id: number): Promise<{ cfg: AppConfig; option: ModelOption } | null> {
  const [row] = await db.select().from(t.models).where(eq(t.models.id, id))
  if (!row) return null
  const option = toModel(row)
  const apiKey = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : ''
  return {
    option,
    cfg: {
      provider: option.provider as Provider,
      apiKey,
      model: option.model,
      baseUrl: option.base_url ?? undefined,
    },
  }
}

export async function createModel(m: {
  label: string
  provider: string
  model: string
  base_url?: string | null
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
      baseUrl: m.base_url ?? null,
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
    base_url: string | null
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
      baseUrl: patch.base_url !== undefined ? patch.base_url : current.baseUrl,
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

// ── invite codes (admin-minted token credit) ─────────────────────────

type InviteRow = typeof t.inviteCodes.$inferSelect

function toInvite(r: InviteRow): InviteCode {
  return {
    code: r.code,
    token_credit: r.tokenCredit,
    note: r.note,
    revoked: r.revoked,
    redeemed_by: r.redeemedBy,
    redeemed_at: r.redeemedAt,
    expires_at: r.expiresAt,
    created_at: r.createdAt,
  }
}

export async function createInviteCode(c: {
  code: string
  tokenCredit: number
  note: string | null
  expiresInDays: number | null
}): Promise<InviteCode> {
  const [row] = await db
    .insert(t.inviteCodes)
    .values({
      code: c.code,
      tokenCredit: c.tokenCredit,
      note: c.note,
      expiresAt: c.expiresInDays !== null ? future(c.expiresInDays * 86_400_000) : null,
    })
    .returning()
  return toInvite(row!)
}

export async function listInviteCodes(): Promise<InviteCode[]> {
  const rows = await db.select().from(t.inviteCodes).orderBy(desc(t.inviteCodes.createdAt))
  return rows.map(toInvite)
}

/** Revoke an unused code (a redeemed one keeps its record). */
export async function revokeInviteCode(code: string): Promise<void> {
  await db.update(t.inviteCodes).set({ revoked: true }).where(eq(t.inviteCodes.code, code))
}

/**
 * Redeem a code for a user: single-use, not revoked, not expired. Atomically marks it
 * redeemed (guards a double-spend) then grants its credit. Returns the granted tokens,
 * or null if the code can't be redeemed.
 */
export async function redeemInviteCode(code: string, userId: number): Promise<number | null> {
  const result = await db
    .update(t.inviteCodes)
    .set({ redeemedBy: userId, redeemedAt: future(0) })
    .where(
      and(
        eq(t.inviteCodes.code, code),
        eq(t.inviteCodes.revoked, false),
        sql`${t.inviteCodes.redeemedBy} IS NULL`,
        sql`(${t.inviteCodes.expiresAt} IS NULL OR ${t.inviteCodes.expiresAt} > now())`,
      ),
    )
    .returning({ credit: t.inviteCodes.tokenCredit })
  const granted = result[0]?.credit
  if (granted === undefined) return null
  await grantCredit(userId, granted)
  return granted
}

// ── admin-managed, versioned prompts (D12 / Phase 14) ────────────────

export interface PromptVersion {
  id: number
  prompt_key: string
  version: number
  body: string
  author: string
  active: boolean
  created_at: string
}

type PromptRow = typeof t.prompts.$inferSelect

function toPromptVersion(r: PromptRow): PromptVersion {
  return {
    id: r.id,
    prompt_key: r.promptKey,
    version: r.version,
    body: r.body,
    author: r.author,
    active: r.active,
    created_at: r.createdAt,
  }
}

/**
 * The active body for a prompt key — what rendering uses. Falls back to the code seed
 * if (defensively) no active row exists, so a model call never runs prompt-less.
 */
export async function activePromptBody(key: PromptKey): Promise<string> {
  const [row] = await db
    .select({ body: t.prompts.body })
    .from(t.prompts)
    .where(and(eq(t.prompts.promptKey, key), eq(t.prompts.active, true)))
    .limit(1)
  return row?.body ?? seedBody(key)
}

/** All saved versions of a prompt key, newest first. */
export async function listPromptVersions(key: string): Promise<PromptVersion[]> {
  const rows = await db
    .select()
    .from(t.prompts)
    .where(eq(t.prompts.promptKey, key))
    .orderBy(desc(t.prompts.version))
  return rows.map(toPromptVersion)
}

/**
 * Save an edited body as a brand-new version and make it active (deactivating the rest).
 * Version number = current max + 1. Returns the created version.
 */
export async function createPromptVersion(key: string, body: string, author: string): Promise<PromptVersion> {
  const [{ max } = { max: 0 }] = await db
    .select({ max: sql<number>`COALESCE(MAX(${t.prompts.version}), 0)::int` })
    .from(t.prompts)
    .where(eq(t.prompts.promptKey, key))
  await db.update(t.prompts).set({ active: false }).where(eq(t.prompts.promptKey, key))
  const [row] = await db
    .insert(t.prompts)
    .values({ promptKey: key, version: max + 1, body, author, active: true })
    .returning()
  return toPromptVersion(row!)
}

/** Roll back / forward: make an existing version active (deactivating the others). */
export async function activatePromptVersion(key: string, version: number): Promise<boolean> {
  const [exists] = await db
    .select({ id: t.prompts.id })
    .from(t.prompts)
    .where(and(eq(t.prompts.promptKey, key), eq(t.prompts.version, version)))
    .limit(1)
  if (!exists) return false
  await db.update(t.prompts).set({ active: false }).where(eq(t.prompts.promptKey, key))
  await db
    .update(t.prompts)
    .set({ active: true })
    .where(and(eq(t.prompts.promptKey, key), eq(t.prompts.version, version)))
  return true
}

// ── dynamic company packs (D10 / Phase 15) ───────────────────────────

export type PackStatus = 'published' | 'draft' | 'archived'
export type PackSource = 'seed' | 'generated' | 'tier'

export interface CompanyPack {
  id: number
  slug: string
  company: string
  roles: string[]
  summary: string
  body: string
  status: PackStatus
  source: PackSource
  model: string | null
  searched: boolean
  created_by: number | null
  created_at: string
  updated_at: string
}

type PackRow = typeof t.companyPacks.$inferSelect

function toPack(r: PackRow): CompanyPack {
  return {
    id: r.id,
    slug: r.slug,
    company: r.company,
    roles: JSON.parse(r.roles) as string[],
    summary: r.summary,
    body: r.body,
    status: r.status as PackStatus,
    source: r.source as PackSource,
    model: r.model,
    searched: r.searched,
    created_by: r.createdBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

/** Normalize a company name to a stable cache key: lowercased, alnum-collapsed. */
export function packSlug(company: string): string {
  return (
    company
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|co|gmbh|plc)\b/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company'
  )
}

/** Published packs only — what onboarding offers and interviews attach. */
export async function listPublishedPacks(): Promise<CompanyPack[]> {
  const rows = await db
    .select()
    .from(t.companyPacks)
    .where(eq(t.companyPacks.status, 'published'))
    .orderBy(t.companyPacks.company)
  return rows.map(toPack)
}

/** Every pack (any status), newest first — the admin review queue. */
export async function listAllPacks(): Promise<CompanyPack[]> {
  const rows = await db.select().from(t.companyPacks).orderBy(desc(t.companyPacks.id))
  return rows.map(toPack)
}

export async function getPack(id: number): Promise<CompanyPack | null> {
  const [row] = await db.select().from(t.companyPacks).where(eq(t.companyPacks.id, id))
  return row ? toPack(row) : null
}

export async function getPackBySlug(slug: string): Promise<CompanyPack | null> {
  const [row] = await db.select().from(t.companyPacks).where(eq(t.companyPacks.slug, slug))
  return row ? toPack(row) : null
}

/** A published pack by id OR slug — used to attach a pack to an interview. */
export async function resolvePublishedPack(idOrSlug: string): Promise<CompanyPack | null> {
  const asId = Number(idOrSlug)
  const pack = Number.isInteger(asId) && asId > 0 ? await getPack(asId) : await getPackBySlug(idOrSlug)
  return pack?.status === 'published' ? pack : null
}

export async function createPack(p: {
  company: string
  roles: string[]
  summary: string
  body: string
  slug?: string
  status?: PackStatus
  source?: PackSource
  model?: string | null
  searched?: boolean
  createdBy?: number | null
}): Promise<CompanyPack> {
  const slug = p.slug ?? packSlug(p.company)
  const [row] = await db
    .insert(t.companyPacks)
    .values({
      slug,
      company: p.company,
      roles: JSON.stringify(p.roles),
      summary: p.summary,
      body: p.body,
      status: p.status ?? 'published',
      source: p.source ?? 'generated',
      model: p.model ?? null,
      searched: p.searched ?? false,
      createdBy: p.createdBy ?? null,
    })
    .onConflictDoNothing({ target: t.companyPacks.slug })
    .returning()
  // Lost a concurrent race for this slug → return the row the other writer created.
  if (!row) return (await getPackBySlug(slug))!
  return toPack(row)
}

export async function updatePack(
  id: number,
  patch: Partial<{
    company: string
    roles: string[]
    summary: string
    body: string
    status: PackStatus
    model: string | null
    searched: boolean
  }>,
): Promise<CompanyPack | null> {
  const [current] = await db.select().from(t.companyPacks).where(eq(t.companyPacks.id, id))
  if (!current) return null
  await db
    .update(t.companyPacks)
    .set({
      company: patch.company ?? current.company,
      // Re-derive the slug if the company name changed (keeps the cache key in sync).
      slug: patch.company ? packSlug(patch.company) : current.slug,
      roles: patch.roles ? JSON.stringify(patch.roles) : current.roles,
      summary: patch.summary ?? current.summary,
      body: patch.body ?? current.body,
      status: patch.status ?? current.status,
      model: patch.model !== undefined ? patch.model : current.model,
      searched: patch.searched ?? current.searched,
      updatedAt: future(0),
    })
    .where(eq(t.companyPacks.id, id))
  return getPack(id)
}

export async function deletePack(id: number): Promise<void> {
  await db.delete(t.companyPacks).where(eq(t.companyPacks.id, id))
}
