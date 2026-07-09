// Company packs (D10 / Phase 15): the published catalog + generate-on-miss.
import type { Hono } from 'hono'
import { z } from 'zod'
import * as db from '../db.js'
import { requireCall } from '../services/entitlement.js'
import { generatePack } from '../services/pack-generator.js'
import { parseBody } from './shared.js'

const packEnsureSchema = z.object({
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
})

export function registerPackRoutes(api: Hono): void {
  api.get('/skills', async (c) => {
    const packs = await db.listPublishedPacks()
    return c.json(
      packs.map((p) => ({
        id: String(p.id),
        company: p.company,
        roles: p.roles,
        summary: p.summary,
        source: p.source,
      })),
    )
  })

  /**
   * Generate-on-miss (R14): return the published pack for `company`, drafting + caching one if we
   * don't have it yet. Cached packs are reused across all users (the first namer pays the tokens).
   */
  api.post('/packs/ensure', async (c) => {
    const { user, call } = await requireCall(c, 'pack', { feature: 'company.pack' })
    const { company, role } = await parseBody(c, packEnsureSchema)
    const existing = await db.getPackBySlug(db.packSlug(company))
    if (existing?.status === 'published')
      return c.json({ pack_id: existing.id, company: existing.company, generated: false })
    const pack = await generatePack(user, call, company, role)
    return c.json({ pack_id: pack.id, company: pack.company, generated: true, searched: pack.searched })
  })
}
