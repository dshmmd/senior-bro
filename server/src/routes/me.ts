// Active-profile-scoped reads/actions: weaknesses, gamification progress (D7/R34),
// and the personalization "what we know about you" model (D2/D6).
import type { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import * as db from '../db.js'
import { computeProgress } from '../progress.js'
import { DOMAINS } from '../domains.js'
import { ownProfile, parseBody } from './shared.js'

const userModelSchema = z.object({ summary: z.string().trim().min(1).max(8000) })
const weaknessStatusSchema = z.object({ status: z.enum(['open', 'improving', 'resolved']) })

export function registerMeRoutes(api: Hono): void {
  // ── weaknesses ──────────────────────────────────────────────────────

  api.get('/weaknesses', async (c) => {
    const user = await requireUser(c)
    const profile = await db.activeProfile(user.id)
    return c.json(profile ? await db.listWeaknesses(profile.id) : [])
  })

  api.post('/weaknesses/:id/status', async (c) => {
    const user = await requireUser(c)
    const { status } = await parseBody(c, weaknessStatusSchema)
    const weakness = await db.getWeakness(Number(c.req.param('id')))
    if (!weakness) throw new HttpError(404, 'weakness not found')
    await ownProfile(user.id, weakness.profile_id)
    await db.setWeaknessStatus(weakness.id, status)
    return c.json({ ok: true })
  })

  // ── progress (gamification) ─────────────────────────────────────────

  // Per-domain constellations (R34 / D22): each interview domain gets its own progress map, and a
  // domain is only returned once it has a *finished* interview — so a technical-only user never sees
  // an empty HR constellation (and vice versa). Weaknesses stay profile-wide (shown in each domain).
  api.get('/progress', async (c) => {
    const user = await requireUser(c)
    const profile = await db.activeProfile(user.id)
    if (!profile) return c.json({ domains: [] })
    const all = (await db.listInterviewsForUser(user.id)).filter((i) => i.profile_id === profile.id)
    const weaknesses = await db.listWeaknesses(profile.id)
    const domains = DOMAINS.flatMap((d) => {
      const forDomain = all.filter((i) => i.domain === d.key)
      if (forDomain.every((i) => i.report === null)) return [] // no evidence yet → stays hidden
      return [{ domain: d.key, label: d.label, progress: computeProgress(profile, forDomain, weaknesses) }]
    })
    return c.json({ domains })
  })

  // ── personalization: "what we know about you" (D2 / D6 / Phase 4) ────

  /** The active profile's distilled user model + recent activity — read/correct/delete here (D6). */
  api.get('/me/model', async (c) => {
    const user = await requireUser(c)
    const profile = await db.activeProfile(user.id)
    if (!profile) return c.json(null)
    const [model, events] = await Promise.all([db.getUserModel(profile.id), db.listEvents(profile.id, 50)])
    return c.json({
      profile: { id: profile.id, role: profile.role, company: profile.company, level: profile.level },
      summary: model?.summary ?? '',
      edited: model?.edited ?? false,
      updated_at: model?.updated_at ?? null,
      events,
    })
  })

  /** Correct the model by hand (D6). Marked `edited`; the next distillation folds the correction in. */
  api.put('/me/model', async (c) => {
    const user = await requireUser(c)
    const profile = await db.activeProfile(user.id)
    if (!profile) throw new HttpError(404, 'no active profile')
    const { summary } = await parseBody(c, userModelSchema)
    await db.setUserModel(profile.id, summary, true)
    return c.json({ ok: true })
  })

  /** Forget what we know (D6). */
  api.delete('/me/model', async (c) => {
    const user = await requireUser(c)
    const profile = await db.activeProfile(user.id)
    if (!profile) throw new HttpError(404, 'no active profile')
    await db.clearUserModel(profile.id)
    return c.json({ ok: true })
  })
}
