// Entitlement + model-call resolution (D11/D21/D23/D3) — extracted from routes.ts (RF-3).
// Pure business logic: which provider/model powers a call, and whether this user's plan
// may make it. HTTP-facing helpers (`requireCall`) live at the bottom.
import type { Context } from 'hono'
import type { AppConfig } from '../config.js'
import { requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import { isHosted } from '../mode.js'
import * as db from '../db.js'
import type { FeatureKey } from '../features.js'
import { domainDef } from '../domains.js'
import { classifyByName, isTier, type Tier } from '../capability.js'

/**
 * Free tier (R32 / D21): a `free-intro` user gets a shared lifetime budget of
 * FREE_IMPRESSION_LIMIT "first impressions" — one per profile/position they onboard.
 * Each first impression covers that profile's free onboarding actions (company-knowledge,
 * first-knowledge build, calibration). Full interviews stay plan-gated. (Redefines the old
 * unconditional 30k-token level-check budget from Phase 13.)
 */
export const FREE_IMPRESSION_LIMIT = 3

/**
 * What a model call is for — gates which plans may make it (D11/D21). The onboarding kinds
 * ('resume' | 'calibration' | 'pack') draw from the free "first impression" budget; 'interview'
 * never does.
 */
export type CallKind = 'resume' | 'calibration' | 'interview' | 'pack'

/** The onboarding call kinds that a free "first impression" credit covers (R32). */
const FIRST_IMPRESSION_KINDS: readonly CallKind[] = ['resume', 'calibration', 'pack']

/**
 * A resolved model call: which provider/key to use, plus the metering metadata
 * (catalog id + per-Mtok prices) so usage can be recorded and quotas enforced.
 * `modelId` is null for BYOK (the user's own key → no host cost, no quota).
 * `freeIntro` = the platform's default model funding a free-intro level-check.
 */
export interface ResolvedCall {
  cfg: AppConfig
  modelId: number | null
  priceIn: number
  priceOut: number
  freeIntro: boolean
  // Capability tier (D3): sizes token budgets + adds per-tier prompt guidance so a cheap key and a
  // premium key get consistent UX. Stored (probed) tier if present, else a name classification.
  tier: Tier
}

/** Resolve a tier from a stored value (falling back to a name-based classification). */
export const resolveTier = (stored: string | null | undefined, model: string): Tier =>
  isTier(stored) ? stored : classifyByName(model)

/** Build a ResolvedCall from a curated model's config (host-funded, metered). */
function hostCall(resolved: { cfg: AppConfig; option: db.ModelOption }, freeIntro: boolean): ResolvedCall {
  return {
    cfg: resolved.cfg,
    modelId: resolved.option.id,
    priceIn: resolved.option.price_in,
    priceOut: resolved.option.price_out,
    freeIntro,
    tier: resolveTier(resolved.option.capability_tier, resolved.cfg.model),
  }
}

/**
 * Resolve which provider/model powers a call (pure — entitlement is separate). Pass `feature`
 * (R35 / D23) to let an admin per-feature assignment override the global model choice for
 * platform-funded calls; BYOK is never routed (the user's own key + cost).
 */
export async function resolveCall(user: db.User, feature?: FeatureKey): Promise<ResolvedCall> {
  const routedId = feature ? await db.assignedFeatureModel(feature) : null

  if (user.model_id !== null) {
    // Host plan: the user's curated model, unless the admin routed this feature elsewhere.
    const routed = routedId ? await db.modelConfig(routedId) : null
    const resolved = routed ?? (await db.modelConfig(user.model_id))
    if (!resolved?.option.enabled)
      throw new HttpError(409, 'your selected model is no longer available — pick another')
    return hostCall(resolved, false)
  }
  const cfg = await db.getUserConfig(user.id)
  if (cfg)
    return {
      cfg,
      modelId: null,
      priceIn: 0,
      priceOut: 0,
      freeIntro: false,
      tier: resolveTier(user.capability_tier, cfg.model),
    }
  // Hosted free-intro user with nothing configured: the per-feature model (or the global default)
  // powers their free onboarding (gated by the first-impression budget, enforced below).
  if (isHosted && user.plan === 'free-intro') {
    const routed = routedId ? await db.modelConfig(routedId) : null
    const resolved =
      routed ??
      (await (async () => {
        const def = await db.defaultModel()
        return def ? await db.modelConfig(def.id) : null
      })())
    if (resolved) return hostCall(resolved, true)
    throw new HttpError(409, 'No model is available yet — the admin needs to add one')
  }
  throw new HttpError(409, 'Not configured: set provider and API key first')
}

/**
 * Entitlement gate (D11/D21), hosted mode only — local mode is always unrestricted.
 * - BYOK/CLI (user's own key): free, never blocked.
 * - free-intro on the platform default model: onboarding actions only, drawing from the shared
 *   "first impression" budget (R32). Full interviews are always plan-gated.
 * - paid host model: requires remaining token credit (`tokens_used < token_quota`).
 *
 * For a free-intro onboarding call scoped to a profile, this *consumes* a first-impression credit
 * on first touch (idempotent — a profile already onboarded stays free, so re-checking a position
 * never re-burns). Pass `profileId` for profile-scoped actions (calibration); omit it for the
 * pre-profile company-pack lookup, which is allowed as long as the user still has a free slot.
 */
export async function enforceEntitlement(
  user: db.User,
  call: ResolvedCall,
  kind: CallKind,
  profileId?: number,
): Promise<void> {
  if (!isHosted) return
  // Admins are staff (the deploy owner + SENIORBRO_ADMIN_EMAILS): they run every feature
  // un-metered on the platform's models, never paywalled by the free-impression or credit gates.
  if (user.role === 'admin') return
  if (call.modelId === null) return
  if (call.freeIntro) {
    // The free tier covers onboarding a position, never a full interview.
    if (!FIRST_IMPRESSION_KINDS.includes(kind))
      throw new HttpError(402, 'Pick a plan to start interviews — the free tier covers onboarding only')
    // A profile that already spent a first impression keeps its onboarding free forever.
    if (profileId !== undefined) {
      const profile = await db.getProfile(profileId)
      if (profile?.first_impression_at) return
    }
    if ((await db.firstImpressionCount(user.id)) >= FREE_IMPRESSION_LIMIT)
      throw new HttpError(
        402,
        `You've used your ${FREE_IMPRESSION_LIMIT} free first impressions — delete a position or pick a plan to add more`,
      )
    // Consume the slot on the profile-scoped action (calibration). The pre-profile pack lookup
    // doesn't consume — the calibration on the profile it's for will.
    if (profileId !== undefined) await db.consumeFirstImpression(profileId)
    return
  }
  if (user.token_quota === null || (await db.tokensUsed(user.id)) >= user.token_quota)
    throw new HttpError(402, 'Out of token credit — add credit or redeem an invite code')
}

/** Resolve the requesting user + their model call, enforcing entitlement (401/402/409). */
export async function requireCall(
  c: Context,
  kind: CallKind,
  opts?: { profileId?: number; feature?: FeatureKey },
): Promise<{ user: db.User; call: ResolvedCall }> {
  const user = await requireUser(c)
  const call = await resolveCall(user, opts?.feature)
  await enforceEntitlement(user, call, kind, opts?.profileId)
  return { user, call }
}

/**
 * Resolve + entitle a model call for an already-loaded interview, routing by its domain (R33).
 * Used on the message/finish paths where the domain comes from the stored interview, not the body.
 */
export async function callForInterview(user: db.User, interview: db.InterviewRow): Promise<ResolvedCall> {
  const call = await resolveCall(user, domainDef(interview.domain).feature)
  await enforceEntitlement(user, call, 'interview')
  return call
}

/**
 * Resolve a model call for voice transcription (R30). Unlike `resolveCall`, this NEVER falls
 * back to the global default chat model — a chat model can't serve `/audio/transcriptions`, so
 * that fallback would just fail confusingly. Returns null when no admin has explicitly assigned
 * `voice.transcribe`, so the caller can offer the browser-STT fallback instead of erroring.
 */
export async function resolveTranscribeCall(): Promise<ResolvedCall | null> {
  const routedId = await db.assignedFeatureModel('voice.transcribe')
  if (!routedId) return null
  const resolved = await db.modelConfig(routedId)
  if (!resolved?.option.enabled) return null
  return hostCall(resolved, false)
}
