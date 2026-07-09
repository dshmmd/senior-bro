// Admin-managed, versioned system prompts (D12 / Phase 14).
import { and, desc, eq, sql } from 'drizzle-orm'
import { seedBody, type PromptKey } from '../prompts.js'
import * as t from '../schema.js'
import { db } from './client.js'

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
