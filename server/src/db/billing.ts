// Usage metering (D4/R25) and admin-minted invite codes (D11).
import { and, desc, eq, sql } from 'drizzle-orm'
import * as t from '../schema.js'
import { db, future } from './client.js'
import { grantCredit } from './users.js'

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

export interface UsageSummary {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  events: number
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
