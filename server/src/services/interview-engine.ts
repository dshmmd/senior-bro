// Interview orchestration internals — extracted from routes.ts (RF-3).
// Builds the per-turn system prompt (domain/kind/tier aware) and re-distills the
// personalization user-model after a finished interview (D2 / Phase 4).
import * as db from '../db.js'
import { HttpError } from '../http.js'
import { TIERS, type Tier } from '../capability.js'
import { domainDef, sampleHrTopics } from '../domains.js'
import { renderCoachingSystem, renderDistill, renderHrSystem, renderInterviewSystem } from '../prompts.js'
import type { ResolvedCall } from './entitlement.js'
import { runModel } from './model-runner.js'

/** Build the system prompt for an interview turn (kind/domain routed, tier-adjusted, D3). */
export async function systemFor(
  interview: db.InterviewRow,
  tier: Tier,
  weaknessId?: number,
): Promise<string> {
  // Per-tier prompt guidance (D3): compensate a small model / invite depth from a strong one.
  const guidance = TIERS[tier].guidance
  const profile = await db.getProfile(interview.profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')
  if (interview.kind === 'coaching') {
    const [weaknesses, userModel] = await Promise.all([
      db.listWeaknesses(profile.id),
      db.getUserModel(profile.id),
    ])
    const target = weaknessId
      ? await db.getWeakness(weaknessId)
      : weaknesses.find((w) => w.status !== 'resolved')
    if (!target) throw new HttpError(400, 'no open weakness to coach on')
    const body = await db.activePromptBody('coaching.system')
    return renderCoachingSystem(body, profile, target, interview.mode, userModel?.summary ?? null, guidance)
  }
  const pack = profile.skill_pack ? await db.resolvePublishedPack(profile.skill_pack) : null
  const dom = domainDef(interview.domain)
  const [weaknesses, claims, userModel, body] = await Promise.all([
    db.listWeaknesses(profile.id),
    db.listClaims(profile.id),
    db.getUserModel(profile.id),
    db.activePromptBody(dom.promptKey),
  ])
  if (dom.key === 'hr') {
    // General-topic pool sampled deterministically per interview (stable across turns + resume);
    // the company pack becomes the deterministic company-values pool. R7/R23 apply as in technical.
    return renderHrSystem(
      body,
      profile,
      pack,
      weaknesses,
      interview.mode,
      sampleHrTopics(interview.id),
      claims,
      userModel?.summary ?? null,
      guidance,
    )
  }
  return renderInterviewSystem(
    body,
    profile,
    pack,
    weaknesses,
    interview.mode,
    claims,
    userModel?.summary ?? null,
    guidance,
  )
}

export const stripToken = (text: string) => text.replace('[INTERVIEW_COMPLETE]', '').trim()

/**
 * Re-distill a profile's "what we know about you" model after an interview (D2 / Phase 4).
 * Reads the prior model + recent events + the fresh report, asks the model for an updated body,
 * and stores it (as an LLM distillation → `edited: false`, folding in any earlier user correction
 * since the prior body is fed back in). Capped small; the caller treats failure as non-fatal.
 */
export async function distillUserModel(
  user: db.User,
  call: ResolvedCall,
  profile: db.Profile,
  report: db.InterviewReport,
): Promise<void> {
  const [prior, events] = await Promise.all([db.getUserModel(profile.id), db.listEvents(profile.id, 40)])
  const body = await db.activePromptBody('personalization.distill')
  const content = renderDistill(body, profile, prior?.summary ?? null, events, report)
  const summary = await runModel(
    user,
    call,
    'You maintain a concise learner profile and respond with only the updated profile text.',
    [{ role: 'user', content }],
    700,
  )
  const trimmed = summary.trim()
  if (trimmed) await db.setUserModel(profile.id, trimmed, false)
}
