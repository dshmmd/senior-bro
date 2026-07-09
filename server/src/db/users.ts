// Users, sessions, magic links, per-user provider config (key encrypted at rest),
// plan/quota/credit mutations.
import { and, eq, gt, sql } from 'drizzle-orm'
import { DEFAULT_MODELS, isCliProvider, type AppConfig, type Provider } from '../config.js'
import { decryptSecret, encryptSecret } from '../crypto.js'
import * as t from '../schema.js'
import { db, future } from './client.js'

export interface User {
  id: number
  email: string | null
  role: 'user' | 'admin'
  plan: PlanKind
  model_id: number | null
  token_quota: number | null
  active_profile_id: number | null
  capability_tier: string | null
  created_at: string
}

/** Entitlement plan (D11). 'local' = the implicit local owner (always entitled). */
export type PlanKind = 'free-intro' | 'host' | 'byok' | 'local'

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
    capability_tier: r.capabilityTier,
    created_at: r.createdAt,
  }
}

/** Store a BYOK user's probed capability tier (D3). */
export async function setUserCapabilityTier(userId: number, tier: string): Promise<void> {
  await db.update(t.users).set({ capabilityTier: tier }).where(eq(t.users.id, userId))
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
