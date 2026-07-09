// Résumé & opportunity pipeline (Phase 5) + post-interview study plan (Phase 7).
// These are value-adds that build on interview history, so they're plan-gated exactly like
// interviews (free-intro users must pick a plan first; BYOK/local are free). Each is routed to
// its own feature model (R35) and metered (R25).
import type { Hono } from 'hono'
import { z } from 'zod'
import * as db from '../db.js'
import { extractJson } from '../providers.js'
import { renderOpportunityDiscover, renderResumeImprove, renderStudyPlan } from '../prompts.js'
import { requireCall } from '../services/entitlement.js'
import { runModel } from '../services/model-runner.js'
import { generatePack } from '../services/pack-generator.js'
import { ownProfile, parseBody } from './shared.js'

const opportunitySchema = z.object({
  profile_id: z.number().int().positive(),
  location: z.string().trim().max(120).optional(),
})
const targetSchema = z.object({
  profile_id: z.number().int().positive(),
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120).optional(),
})
const resumeReviewSchema = z.object({ profile_id: z.number().int().positive() })
const studyPlanSchema = z.object({ profile_id: z.number().int().positive() })

/** The profile's latest finished-interview reports (newest-first, capped). */
async function recentReports(userId: number, profileId: number): Promise<db.InterviewReport[]> {
  const interviews = await db.listInterviewsForUser(userId)
  return interviews
    .filter((i) => i.profile_id === profileId && i.report !== null)
    .slice(0, 5)
    .map((i) => i.report!)
}

export function registerCareerRoutes(api: Hono): void {
  // "Your interviews show more than your résumé says" — suggestions grounded in demonstrated skills.
  api.post('/resume/review', async (c) => {
    const { user, call } = await requireCall(c, 'interview', { feature: 'resume.improve' })
    const { profile_id } = await parseBody(c, resumeReviewSchema)
    const profile = await ownProfile(user.id, profile_id)
    const [claims, weaknesses, reports] = await Promise.all([
      db.listClaims(profile.id),
      db.listWeaknesses(profile.id),
      recentReports(user.id, profile.id),
    ])
    const body = await db.activePromptBody('resume.improve')
    const raw = await runModel(
      user,
      call,
      'You are a résumé coach and respond with strict JSON.',
      [{ role: 'user', content: renderResumeImprove(body, profile, claims, weaknesses, reports) }],
      1500,
    )
    return c.json(
      extractJson<{
        summary: string
        suggestions: { area: string; insight: string; suggested_bullet: string }[]
      }>(raw),
    )
  })

  // Post-interview study plan (Phase 7): prioritized topics from the profile's gaps, each optionally
  // linked to a weakness so the UI can launch a coaching drill straight from a plan item.
  api.post('/study-plan', async (c) => {
    const { user, call } = await requireCall(c, 'interview', { feature: 'study.plan' })
    const { profile_id } = await parseBody(c, studyPlanSchema)
    const profile = await ownProfile(user.id, profile_id)
    const [weaknesses, reports] = await Promise.all([
      db.listWeaknesses(profile.id),
      recentReports(user.id, profile.id),
    ])
    const body = await db.activePromptBody('study.plan')
    const raw = await runModel(
      user,
      call,
      'You build an interview-prep study plan and respond with strict JSON.',
      [{ role: 'user', content: renderStudyPlan(body, profile, weaknesses, reports) }],
      1500,
    )
    return c.json(
      extractJson<{
        overview: string
        items: { topic: string; focus: string; practice: string; weakness_id: number | null }[]
      }>(raw),
    )
  })

  // Discover live openings matched to the profile (web-search-augmented on Anthropic).
  api.post('/opportunities', async (c) => {
    const { user, call } = await requireCall(c, 'interview', { feature: 'opportunity.discover' })
    const { profile_id, location } = await parseBody(c, opportunitySchema)
    const profile = await ownProfile(user.id, profile_id)
    const body = await db.activePromptBody('opportunity.discover')
    const webSearch = call.cfg.provider === 'anthropic'
    const raw = await runModel(
      user,
      call,
      'You are a job-search assistant and respond with strict JSON.',
      [{ role: 'user', content: renderOpportunityDiscover(body, profile, location ?? '') }],
      1800,
      undefined,
      { webSearch },
    )
    const parsed = extractJson<{
      opportunities: {
        title: string
        company: string
        location: string
        match_score: number
        why: string
        url: string | null
      }[]
    }>(raw)
    const opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : []
    return c.json({ opportunities, searched: webSearch })
  })

  // Target-company mode: adopt an opening as this profile's target — ensure its company pack and
  // point the profile at it, so the next interview is tuned to that company/role.
  api.post('/opportunities/target', async (c) => {
    const { user, call } = await requireCall(c, 'interview', { feature: 'company.pack' })
    const { profile_id, company, role } = await parseBody(c, targetSchema)
    const profile = await ownProfile(user.id, profile_id)
    const targetRole = role ?? profile.role
    const slug = db.packSlug(company)
    const existing = await db.getPackBySlug(slug)
    const pack =
      existing?.status === 'published' ? existing : await generatePack(user, call, company, targetRole)
    await db.updateProfile(profile.id, {
      role: targetRole,
      company,
      skill_pack: slug,
      technologies: profile.technologies,
      years_experience: profile.years_experience,
      notes: profile.notes ?? null,
    })
    await db.recordEvent(profile.id, 'target_set', `${company} · ${targetRole}`)
    return c.json({ pack_id: pack.id, company: pack.company, generated: existing?.status !== 'published' })
  })
}
