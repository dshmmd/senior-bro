// Dynamic company packs (D10 / Phase 15): slug-keyed cache of generated/seeded
// interview playbooks + the admin review queue.
import { desc, eq } from 'drizzle-orm'
import * as t from '../schema.js'
import { db, future } from './client.js'

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
