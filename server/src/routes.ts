import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { DEFAULT_MODELS, isCliProvider, type AppConfig } from './config.js'
import { currentUser, endSession, requireUser, startSession } from './auth.js'
import { isAdminEmail, requireAdmin } from './admin.js'
import { randomToken } from './crypto.js'
import { HttpError } from './http.js'
import { isHosted, MODE } from './mode.js'
import { revealLinks, sendMagicLink } from './mailer.js'
import * as db from './db.js'
import {
  chat,
  extractJson,
  validateKey,
  type ChatMessage,
  type ChatOptions,
  type OnDelta,
} from './providers.js'
import { computeProgress } from './progress.js'
import { FEATURES, isFeatureKey, type FeatureKey } from './features.js'
import { DOMAINS, domainDef, sampleHrTopics } from './domains.js'
import {
  FIRST_MESSAGE_TRIGGER,
  PROMPT_SEEDS,
  renderCalibrationGenerate,
  renderCalibrationGrade,
  renderCoachingSystem,
  renderCompanyPack,
  renderDistill,
  renderEvaluation,
  renderHrSystem,
  renderInterviewSystem,
  renderOpportunityDiscover,
  renderResumeImprove,
  renderResumeParse,
  renderStudyPlan,
} from './prompts.js'
import { extractText } from 'unpdf'

export const api = new Hono()

/**
 * Free tier (R32 / D21): a `free-intro` user gets a shared lifetime budget of
 * FREE_IMPRESSION_LIMIT "first impressions" — one per profile/position they onboard.
 * Each first impression covers that profile's free onboarding actions (company-knowledge,
 * first-knowledge build, calibration). Full interviews stay plan-gated. (Redefines the old
 * unconditional 30k-token level-check budget from Phase 13.)
 */
const FREE_IMPRESSION_LIMIT = 3

/** Token packs the mocked checkout sells (real Stripe/crypto is Phase 8). */
const CREDIT_PACKS = [100_000, 500_000, 1_000_000] as const

/**
 * What a model call is for — gates which plans may make it (D11/D21). The onboarding kinds
 * ('resume' | 'calibration' | 'pack') draw from the free "first impression" budget; 'interview'
 * never does.
 */
type CallKind = 'resume' | 'calibration' | 'interview' | 'pack'

/** The onboarding call kinds that a free "first impression" credit covers (R32). */
const FIRST_IMPRESSION_KINDS: readonly CallKind[] = ['resume', 'calibration', 'pack']

/**
 * A resolved model call: which provider/key to use, plus the metering metadata
 * (catalog id + per-Mtok prices) so usage can be recorded and quotas enforced.
 * `modelId` is null for BYOK (the user's own key → no host cost, no quota).
 * `freeIntro` = the platform's default model funding a free-intro level-check.
 */
interface ResolvedCall {
  cfg: AppConfig
  modelId: number | null
  priceIn: number
  priceOut: number
  freeIntro: boolean
}

/** Build a ResolvedCall from a curated model's config (host-funded, metered). */
function hostCall(resolved: { cfg: AppConfig; option: db.ModelOption }, freeIntro: boolean): ResolvedCall {
  return {
    cfg: resolved.cfg,
    modelId: resolved.option.id,
    priceIn: resolved.option.price_in,
    priceOut: resolved.option.price_out,
    freeIntro,
  }
}

/**
 * Resolve which provider/model powers a call (pure — entitlement is separate). Pass `feature`
 * (R35 / D23) to let an admin per-feature assignment override the global model choice for
 * platform-funded calls; BYOK is never routed (the user's own key + cost).
 */
async function resolveCall(user: db.User, feature?: FeatureKey): Promise<ResolvedCall> {
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
  if (cfg) return { cfg, modelId: null, priceIn: 0, priceOut: 0, freeIntro: false }
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
async function enforceEntitlement(
  user: db.User,
  call: ResolvedCall,
  kind: CallKind,
  profileId?: number,
): Promise<void> {
  if (!isHosted) return
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
async function requireCall(
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
async function callForInterview(user: db.User, interview: db.InterviewRow): Promise<ResolvedCall> {
  const call = await resolveCall(user, domainDef(interview.domain).feature)
  await enforceEntitlement(user, call, 'interview')
  return call
}

/** Run a model call, record its token usage/cost, and return the text. */
async function runModel(
  user: db.User,
  call: ResolvedCall,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
  onDelta?: OnDelta,
  options?: ChatOptions,
): Promise<string> {
  return (await runModelFull(user, call, system, messages, maxTokens, onDelta, options)).text
}

/** Like `runModel` but also returns the raw `ChatResult` (e.g. the `searched` provenance flag). */
async function runModelFull(
  user: db.User,
  call: ResolvedCall,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
  onDelta?: OnDelta,
  options?: ChatOptions,
): Promise<{ text: string; searched: boolean }> {
  const { text, usage, searched } = await chat(call.cfg, system, messages, maxTokens, onDelta, options)
  const costUsd =
    (usage.inputTokens / 1_000_000) * call.priceIn + (usage.outputTokens / 1_000_000) * call.priceOut
  await db.recordUsage({
    userId: user.id,
    modelId: call.modelId,
    provider: call.cfg.provider,
    model: call.cfg.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
  })
  return { text, searched: searched ?? false }
}

/** Throw 404 unless `profileId` belongs to `userId` (cross-user isolation guard). */
async function ownProfile(userId: number, profileId: number): Promise<db.Profile> {
  const profile = await db.getProfile(profileId)
  if (profile?.user_id !== userId) throw new HttpError(404, 'profile not found')
  return profile
}

/** Throw 404 unless `interviewId` is owned (via its profile) by `userId`. */
async function ownInterview(userId: number, interviewId: number): Promise<db.InterviewRow> {
  const interview = await db.getInterview(interviewId)
  if (!interview) throw new HttpError(404, 'interview not found')
  await ownProfile(userId, interview.profile_id)
  return interview
}

async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw: unknown = await c.req.json().catch(() => {
    throw new HttpError(400, 'invalid JSON body')
  })
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new HttpError(400, `${issue?.path.join('.') ?? 'body'}: ${issue?.message ?? 'invalid'}`)
  }
  return result.data as z.infer<S>
}

const wantsStream = (c: Context): boolean => (c.req.header('accept') ?? '').includes('text/event-stream')

api.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500
  console.error(JSON.stringify({ level: 'error', path: c.req.path, message: err.message }))
  return c.json({ error: err.message }, status as 409)
})

// ── schemas ─────────────────────────────────────────────────────────

const configSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'claude-cli', 'codex-cli', 'mock']),
    apiKey: z.string().max(400).optional(),
    model: z.string().max(120).optional(),
  })
  .refine((v) => isCliProvider(v.provider) || (v.apiKey?.trim().length ?? 0) >= 4, {
    message: 'API key is required for this provider',
    path: ['apiKey'],
  })
  // CLI subscription providers run the user's local login — only valid in local
  // mode (D8). A hosted server must never try to proxy a customer's CLI.
  .refine((v) => !isHosted || !isCliProvider(v.provider), {
    message: 'subscription/CLI providers are not available on the hosted service — use an API key',
    path: ['provider'],
  })

const authRequestSchema = z.object({ email: z.string().trim().email().max(200) })
const authVerifySchema = z.object({ token: z.string().min(10).max(200) })

const profileSchema = z.object({
  role: z.string().trim().min(2).max(200),
  company: z.string().trim().max(200).optional(),
  skill_pack: z.string().max(100).optional(),
  technologies: z.array(z.string().max(80)).max(40).default([]),
  years_experience: z.number().int().min(0).max(60).default(0),
  notes: z.string().max(4000).optional(),
})

// Résumé pasted as plain text (R31) — the multipart path carries a file instead.
const resumeTextSchema = z.object({ text: z.string().max(60000) })

const calibrationStartSchema = z.object({ profile_id: z.number().int().positive() })

const calibrationSubmitSchema = z.object({
  calibration_id: z.number().int().positive(),
  answers: z.array(z.string().max(8000)).min(1).max(10),
})

const interviewSchema = z.object({
  profile_id: z.number().int().positive(),
  mode: z.enum(['voice', 'text']).default('text'),
  kind: z.enum(['full', 'coaching']).default('full'),
  // Interview domain (R33 / D22). Coaching drills are domain-agnostic → 'technical'.
  domain: z.enum(['technical', 'hr']).default('technical'),
  weakness_id: z.number().int().positive().optional(),
})

const messageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  // Optional one-tap steering label (Phase 4 chips) — logged as a preference event for the
  // user-model distiller. The message content still flows normally so the interviewer adapts now.
  preference: z.string().trim().max(60).optional(),
})

const userModelSchema = z.object({ summary: z.string().trim().min(1).max(8000) })

const weaknessStatusSchema = z.object({ status: z.enum(['open', 'improving', 'resolved']) })

const modelCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    provider: z.enum(['anthropic', 'openai', 'arvan', 'mock']),
    model: z.string().trim().min(1).max(120),
    // Arvan (D19): the per-model gateway URL up to `/v1` — required for that provider.
    base_url: z.string().trim().url().max(500).optional(),
    apiKey: z.string().max(400).optional(),
    enabled: z.boolean().default(true),
    is_default: z.boolean().default(false),
    price_in: z.number().min(0).max(10000).default(0),
    price_out: z.number().min(0).max(10000).default(0),
  })
  .refine((v) => v.provider !== 'arvan' || (v.base_url?.length ?? 0) > 0, {
    message: 'Arvan models need a gateway base URL',
    path: ['base_url'],
  })

const modelUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  base_url: z.string().trim().url().max(500).optional(),
  apiKey: z.string().max(400).optional(),
  enabled: z.boolean().optional(),
  is_default: z.boolean().optional(),
  price_in: z.number().min(0).max(10000).optional(),
  price_out: z.number().min(0).max(10000).optional(),
})

const modelSelectSchema = z.object({ model_id: z.number().int().positive() })
// null clears a feature's assignment (→ global default). (R35 / D23)
const featureModelSchema = z.object({ model_id: z.number().int().positive().nullable() })
const quotaSchema = z.object({ token_quota: z.number().int().min(0).nullable() })

const planCheckoutSchema = z.object({
  tokens: z
    .number()
    .int()
    .refine((n) => (CREDIT_PACKS as readonly number[]).includes(n), {
      message: 'pick one of the offered token packs',
    }),
})
const planRedeemSchema = z.object({ code: z.string().trim().min(3).max(64) })
const inviteCreateSchema = z.object({
  token_credit: z.number().int().min(1).max(1_000_000_000),
  note: z.string().trim().max(200).optional(),
  expires_in_days: z.number().int().min(1).max(365).nullable().default(null),
})

const promptKeys = PROMPT_SEEDS.map((s) => s.key) as [string, ...string[]]
const promptVersionSchema = z.object({ body: z.string().trim().min(1).max(20000) })
const promptActivateSchema = z.object({ version: z.number().int().positive() })

const packEnsureSchema = z.object({
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
})

// Phase 5 — opportunity discovery + target-company mode.
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
const packUpdateSchema = z.object({
  company: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(500).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  roles: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  status: z.enum(['published', 'draft', 'archived']).optional(),
})

/** Validate the `:key` path param against the known prompt catalogue (404 if unknown). */
function promptKeyOf(c: Context): (typeof promptKeys)[number] {
  const key = c.req.param('key') ?? ''
  if (!(promptKeys as readonly string[]).includes(key)) throw new HttpError(404, 'unknown prompt key')
  return key
}

// ── config ──────────────────────────────────────────────────────────

api.get('/health', async (c) => {
  const user = await currentUser(c)
  const configured = user ? (await db.getUserConfig(user.id)) !== null : false
  return c.json({
    ok: true,
    mode: MODE,
    authed: user !== null,
    user: user ? { email: user.email, role: user.role } : null,
    plan: user?.plan ?? null,
    configured,
    has_model: user ? user.model_id !== null : false,
  })
})

api.get('/config', async (c) => {
  const user = await requireUser(c)
  const cfg = await db.getUserConfig(user.id)
  return c.json(cfg ? { provider: cfg.provider, model: cfg.model, hasKey: true } : { hasKey: false })
})

api.post('/config', async (c) => {
  const user = await requireUser(c)
  const body = await parseBody(c, configSchema)
  const cfg: AppConfig = {
    provider: body.provider,
    apiKey: body.apiKey?.trim() ?? '',
    model: body.model?.trim() ?? DEFAULT_MODELS[body.provider],
  }
  const check = await validateKey(cfg)
  if (!check.ok) {
    const what = isCliProvider(cfg.provider) ? 'CLI check' : 'API key validation'
    throw new HttpError(400, `${what} failed: ${check.error ?? 'unknown'}`)
  }
  await db.setUserConfig(user.id, cfg)
  // Bringing your own key is the free 'byok' plan (D11). Local owner stays 'local'.
  if (isHosted) await db.setUserPlan(user.id, 'byok')
  return c.json({ ok: true, provider: cfg.provider, model: cfg.model })
})

// ── auth (hosted mode: email magic-link, no passwords) ───────────────

api.get('/auth/me', async (c) => {
  const user = await currentUser(c)
  return c.json(user ? { email: user.email, role: user.role } : null)
})

api.post('/auth/request', async (c) => {
  if (!isHosted) throw new HttpError(400, 'accounts are only used in hosted mode')
  const { email } = await parseBody(c, authRequestSchema)
  const token = randomToken(32)
  await db.createMagicLink(email, token, 20)
  const origin = c.req.header('origin') ?? new URL(c.req.url).origin
  const link = `${origin}/?magic=${token}`
  await sendMagicLink(email, link)
  // In non-prod (no real mailbox) we hand the link back so dev/staging can sign in.
  return c.json({ ok: true, sent: true, ...(revealLinks() ? { link } : {}) })
})

api.post('/auth/verify', async (c) => {
  if (!isHosted) throw new HttpError(400, 'accounts are only used in hosted mode')
  const { token } = await parseBody(c, authVerifySchema)
  const email = await db.consumeMagicLink(token)
  if (!email) throw new HttpError(400, 'this sign-in link is invalid or expired — request a new one')
  const user = await db.upsertUserByEmail(email)
  // Promote configured admin emails (SENIORBRO_ADMIN_EMAILS) on sign-in.
  let role = user.role
  if (isAdminEmail(email) && role !== 'admin') {
    await db.setUserRole(user.id, 'admin')
    role = 'admin'
  }
  await startSession(c, user.id)
  return c.json({ ok: true, email: user.email, role })
})

api.post('/auth/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

// ── model catalog & usage (user-facing) ──────────────────────────────

// Curated models the user may pick from (admin-enabled only; never exposes keys).
api.get('/models', async (c) => {
  const user = await requireUser(c)
  return c.json({ models: await db.listModels(true), selected_model_id: user.model_id })
})

// Pick an admin-curated model (host key + metered). Hosted mode only.
api.post('/models/select', async (c) => {
  const user = await requireUser(c)
  const { model_id } = await parseBody(c, modelSelectSchema)
  const option = await db.getModel(model_id)
  if (!option?.enabled) throw new HttpError(404, 'model not available')
  await db.setUserModelChoice(user.id, model_id)
  // Choosing a curated host model is the paid 'host' plan (entitlement checked per call).
  if (isHosted) await db.setUserPlan(user.id, 'host')
  return c.json({ ok: true })
})

// The signed-in user's own usage, plan + remaining credit (D11 billing readout).
api.get('/usage', async (c) => {
  const user = await requireUser(c)
  const tokensUsed = await db.tokensUsed(user.id)
  const impressionsUsed = await db.firstImpressionCount(user.id)
  return c.json({
    usage: await db.usageSummary(user.id),
    plan: user.plan,
    token_quota: user.token_quota,
    tokens_used: tokensUsed,
    credit_left: user.token_quota !== null ? Math.max(0, user.token_quota - tokensUsed) : null,
    // Free-tier "first impression" budget (R32) — replaces the old flat token budget.
    first_impressions_used: impressionsUsed,
    first_impressions_limit: FREE_IMPRESSION_LIMIT,
  })
})

// ── plans, mocked payment & invite redemption (D11) ──────────────────

// Mocked "payment": grant a token-credit pack and flip to the paid 'host' plan.
api.post('/plan/checkout', async (c) => {
  const user = await requireUser(c)
  const { tokens } = await parseBody(c, planCheckoutSchema)
  await db.grantCredit(user.id, tokens)
  return c.json({ ok: true, plan: 'host', granted: tokens })
})

// Redeem an admin-minted invite code for its token credit (also → 'host' plan).
api.post('/plan/redeem', async (c) => {
  const user = await requireUser(c)
  const { code } = await parseBody(c, planRedeemSchema)
  const granted = await db.redeemInviteCode(code.trim(), user.id)
  if (granted === null) throw new HttpError(400, 'that invite code is invalid, expired, or already used')
  return c.json({ ok: true, plan: 'host', granted })
})

// ── admin (model/key management, users, usage console) ───────────────

api.get('/admin/models', async (c) => {
  await requireAdmin(c)
  return c.json(await db.listModels(false))
})

api.post('/admin/models', async (c) => {
  await requireAdmin(c)
  const body = await parseBody(c, modelCreateSchema)
  // Validate the key works before saving (mock needs none).
  if (body.provider !== 'mock') {
    const check = await validateKey({
      provider: body.provider,
      apiKey: body.apiKey?.trim() ?? '',
      model: body.model,
      baseUrl: body.base_url?.trim(),
    })
    if (!check.ok) throw new HttpError(400, `key validation failed: ${check.error ?? 'unknown'}`)
  }
  const created = await db.createModel({
    label: body.label,
    provider: body.provider,
    model: body.model,
    base_url: body.base_url?.trim() ?? null,
    apiKey: body.apiKey?.trim() ?? '',
    enabled: body.enabled,
    is_default: body.is_default,
    price_in: body.price_in,
    price_out: body.price_out,
  })
  return c.json(created)
})

api.patch('/admin/models/:id', async (c) => {
  await requireAdmin(c)
  const id = Number(c.req.param('id'))
  const body = await parseBody(c, modelUpdateSchema)
  const updated = await db.updateModel(id, {
    label: body.label,
    base_url: body.base_url?.trim(),
    enabled: body.enabled,
    is_default: body.is_default,
    price_in: body.price_in,
    price_out: body.price_out,
    apiKey: body.apiKey?.trim(),
  })
  if (!updated) throw new HttpError(404, 'model not found')
  return c.json(updated)
})

api.delete('/admin/models/:id', async (c) => {
  await requireAdmin(c)
  await db.deleteModel(Number(c.req.param('id')))
  return c.json({ ok: true })
})

// Per-feature model routing (R35 / D23): the feature catalogue + each feature's current assignment.
api.get('/admin/feature-models', async (c) => {
  await requireAdmin(c)
  return c.json({ features: FEATURES, assignments: await db.listFeatureModels() })
})

// Assign a model to a feature (or clear it with model_id: null → falls back to the global default).
api.put('/admin/feature-models/:key', async (c) => {
  await requireAdmin(c)
  const key = c.req.param('key')
  if (!isFeatureKey(key)) throw new HttpError(404, 'unknown feature key')
  const { model_id } = await parseBody(c, featureModelSchema)
  if (model_id !== null && !(await db.getModel(model_id))) throw new HttpError(404, 'model not found')
  await db.setFeatureModel(key, model_id)
  return c.json({ ok: true })
})

api.get('/admin/users', async (c) => {
  await requireAdmin(c)
  const users = await db.listUsers()
  const rows = await Promise.all(
    users.map(async (u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      model_id: u.model_id,
      token_quota: u.token_quota,
      ...(await db.usageSummary(u.id)),
    })),
  )
  return c.json(rows)
})

api.post('/admin/users/:id/quota', async (c) => {
  await requireAdmin(c)
  const { token_quota } = await parseBody(c, quotaSchema)
  await db.setUserQuota(Number(c.req.param('id')), token_quota)
  return c.json({ ok: true })
})

// ── admin: invite codes (token-credit codes for testers/partners) ────

api.get('/admin/invites', async (c) => {
  await requireAdmin(c)
  return c.json(await db.listInviteCodes())
})

api.post('/admin/invites', async (c) => {
  await requireAdmin(c)
  const body = await parseBody(c, inviteCreateSchema)
  const code = `SB-${randomToken(4).toUpperCase()}`
  const created = await db.createInviteCode({
    code,
    tokenCredit: body.token_credit,
    note: body.note ?? null,
    expiresInDays: body.expires_in_days,
  })
  return c.json(created)
})

api.post('/admin/invites/:code/revoke', async (c) => {
  await requireAdmin(c)
  await db.revokeInviteCode(c.req.param('code'))
  return c.json({ ok: true })
})

// ── admin: versioned system prompts (D12 — edit/version/rollback) ────

/** Prompt catalogue: each key with its metadata + active version + total versions. */
api.get('/admin/prompts', async (c) => {
  await requireAdmin(c)
  const rows = await Promise.all(
    PROMPT_SEEDS.map(async (s) => {
      const versions = await db.listPromptVersions(s.key)
      return {
        key: s.key,
        label: s.label,
        description: s.description,
        placeholders: s.placeholders,
        guardrailed: s.guardrailed,
        active_version: versions.find((v) => v.active)?.version ?? null,
        version_count: versions.length,
      }
    }),
  )
  return c.json(rows)
})

/** All saved versions of one prompt key (newest first), for the editor + history. */
api.get('/admin/prompts/:key', async (c) => {
  await requireAdmin(c)
  const key = promptKeyOf(c)
  return c.json(await db.listPromptVersions(key))
})

/** Save an edited body as a new active version. */
api.post('/admin/prompts/:key', async (c) => {
  const admin = await requireAdmin(c)
  const key = promptKeyOf(c)
  const { body } = await parseBody(c, promptVersionSchema)
  const created = await db.createPromptVersion(key, body, admin.email ?? `user#${admin.id}`)
  return c.json(created)
})

/** Roll back / forward by re-activating an existing version. */
api.post('/admin/prompts/:key/activate', async (c) => {
  await requireAdmin(c)
  const key = promptKeyOf(c)
  const { version } = await parseBody(c, promptActivateSchema)
  const ok = await db.activatePromptVersion(key, version)
  if (!ok) throw new HttpError(404, 'no such prompt version')
  return c.json({ ok: true })
})

// ── admin: company packs review queue (D10 — edit/publish/regenerate) ─

api.get('/admin/packs', async (c) => {
  await requireAdmin(c)
  return c.json(await db.listAllPacks())
})

api.patch('/admin/packs/:id', async (c) => {
  await requireAdmin(c)
  const patch = await parseBody(c, packUpdateSchema)
  const updated = await db.updatePack(Number(c.req.param('id')), patch)
  if (!updated) throw new HttpError(404, 'pack not found')
  return c.json(updated)
})

/** Re-draft a pack's body from scratch (e.g. when it's stale), keeping its slug/cache key. */
api.post('/admin/packs/:id/regenerate', async (c) => {
  await requireAdmin(c)
  const { user, call } = await requireCall(c, 'pack', { feature: 'company.pack' })
  const pack = await db.getPack(Number(c.req.param('id')))
  if (!pack) throw new HttpError(404, 'pack not found')
  const role = pack.roles[0] ?? 'Engineer'
  const promptBody = await db.activePromptBody('company.pack')
  const content = renderCompanyPack(promptBody, pack.company, role)
  const webSearch = call.cfg.provider === 'anthropic'
  const { text, searched } = await runModelFull(
    user,
    call,
    'You research companies and respond with strict JSON.',
    [{ role: 'user', content }],
    1500,
    undefined,
    { webSearch },
  )
  const draft = extractJson<{ company?: string; roles?: string[]; summary?: string; body?: string }>(text)
  if (!draft.body?.trim()) throw new HttpError(502, 'pack generation returned no playbook — try again')
  const updated = await db.updatePack(pack.id, {
    summary: draft.summary?.trim() ?? pack.summary,
    body: draft.body.trim(),
    roles: Array.isArray(draft.roles) && draft.roles.length ? draft.roles : pack.roles,
    model: call.cfg.model,
    searched,
  })
  return c.json(updated)
})

api.delete('/admin/packs/:id', async (c) => {
  await requireAdmin(c)
  await db.deletePack(Number(c.req.param('id')))
  return c.json({ ok: true })
})

// ── company packs (D10 / Phase 15) ──────────────────────────────────

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

/** Draft a company pack via the model (web-search-augmented on Anthropic), then cache it. */
async function generatePack(
  user: db.User,
  call: ResolvedCall,
  company: string,
  role: string,
): Promise<db.CompanyPack> {
  const promptBody = await db.activePromptBody('company.pack')
  const content = renderCompanyPack(promptBody, company, role)
  const webSearch = call.cfg.provider === 'anthropic'
  const { text, searched } = await runModelFull(
    user,
    call,
    'You research companies and respond with strict JSON.',
    [{ role: 'user', content }],
    1500,
    undefined,
    { webSearch },
  )
  const draft = extractJson<{ company?: string; roles?: string[]; summary?: string; body?: string }>(text)
  if (!draft.body?.trim()) throw new HttpError(502, 'pack generation returned no playbook — try again')
  return db.createPack({
    slug: db.packSlug(company),
    company: draft.company?.trim() ?? company,
    roles: Array.isArray(draft.roles) && draft.roles.length ? draft.roles : [role],
    summary: draft.summary?.trim() ?? '',
    body: draft.body.trim(),
    status: 'published',
    source: 'generated',
    model: call.cfg.model,
    searched,
    createdBy: user.id,
  })
}

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

// ── résumé & opportunity pipeline (Phase 5) ─────────────────────────
// These are value-adds that build on interview history, so they're plan-gated exactly like
// interviews (free-intro users must pick a plan first; BYOK/local are free). Each is routed to
// its own feature model (R35) and metered (R25).

// "Your interviews show more than your résumé says" — suggestions grounded in demonstrated skills.
api.post('/resume/review', async (c) => {
  const { user, call } = await requireCall(c, 'interview', { feature: 'resume.improve' })
  const { profile_id } = await parseBody(c, resumeReviewSchema)
  const profile = await ownProfile(user.id, profile_id)
  const [claims, weaknesses, interviews] = await Promise.all([
    db.listClaims(profile.id),
    db.listWeaknesses(profile.id),
    db.listInterviewsForUser(user.id),
  ])
  const reports = interviews
    .filter((i) => i.profile_id === profile.id && i.report !== null)
    .slice(0, 5)
    .map((i) => i.report!)
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
  const [weaknesses, interviews] = await Promise.all([
    db.listWeaknesses(profile.id),
    db.listInterviewsForUser(user.id),
  ])
  const reports = interviews
    .filter((i) => i.profile_id === profile.id && i.report !== null)
    .slice(0, 5)
    .map((i) => i.report!)
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

// ── profile ─────────────────────────────────────────────────────────

api.post('/profile', async (c) => {
  const user = await requireUser(c)
  const body = await parseBody(c, profileSchema)
  const profile = await db.createProfile(user.id, {
    role: body.role,
    company: body.company ?? null,
    skill_pack: body.skill_pack ?? null,
    technologies: body.technologies,
    years_experience: body.years_experience,
    notes: body.notes ?? null,
  })
  await db.recordEvent(profile.id, 'profile_created', profile.role)
  return c.json(profile)
})

/**
 * Read résumé text from the request (R31). Accepts either a multipart upload (a `file` field —
 * PDF is text-extracted server-side, anything else decoded as UTF-8 — plus an optional pasted
 * `text` field) or a JSON `{ text }` body. Returns the raw text; the caller caps + validates it.
 */
async function readResumeText(c: Context): Promise<string> {
  const ctype = c.req.header('content-type') ?? ''
  if (ctype.includes('application/json')) {
    const { text } = await parseBody(c, resumeTextSchema)
    return text
  }
  const form = await c.req.parseBody()
  const pasted = typeof form.text === 'string' ? form.text : ''
  const file = form.file
  if (file && typeof file !== 'string') {
    const buf = new Uint8Array(await file.arrayBuffer())
    const name = file.name.toLowerCase()
    const isPdf =
      name.endsWith('.pdf') ||
      file.type === 'application/pdf' ||
      (buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) // %PDF
    // unpdf extracts text server-side; `mergePages` returns a single string.
    if (isPdf) return (await extractText(buf, { mergePages: true })).text
    return new TextDecoder().decode(buf)
  }
  return pasted
}

/**
 * CV-first onboarding (R31): extract a profile from an uploaded/pasted résumé with the
 * `resume.parse` model (R35), then create it. Consumes a free "first impression" (R32) on the new
 * profile — even if the user edits nothing further. The client then loads it for review/edit (PUT).
 */
api.post('/profile/from-cv', async (c) => {
  const { user, call } = await requireCall(c, 'resume', { feature: 'resume.parse' })
  const text = (await readResumeText(c)).slice(0, 24_000)
  if (text.trim().length < 30)
    throw new HttpError(400, "couldn't read enough text from that résumé — try pasting it as text")
  const body = await db.activePromptBody('resume.parse')
  const raw = await runModel(
    user,
    call,
    'You extract structured profile data from a résumé and respond with strict JSON only.',
    [{ role: 'user', content: renderResumeParse(body, text) }],
    1200,
  )
  // The model's output is untrusted JSON — coerce every field defensively.
  const x = extractJson<{
    role?: unknown
    company?: unknown
    technologies?: unknown
    years_experience?: unknown
    notes?: unknown
  }>(raw)
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const technologies = Array.isArray(x.technologies)
    ? [...new Set(x.technologies.map((s) => str(s).trim()).filter(Boolean))].slice(0, 40)
    : []
  const years = Math.max(0, Math.min(60, Math.round(Number(x.years_experience) || 0)))
  const profile = await db.createProfile(user.id, {
    role: str(x.role).trim() || 'Software Engineer',
    company: str(x.company).trim() || null,
    skill_pack: null,
    technologies,
    years_experience: years,
    notes: str(x.notes).trim().slice(0, 4000) || null,
  })
  await db.recordEvent(profile.id, 'profile_created', `${profile.role} (from résumé)`)
  // A résumé check consumes a first impression on the created profile (idempotent; no-op for
  // host/byok). Slot availability was already enforced above (kind 'resume', no profile yet).
  if (call.freeIntro) await db.consumeFirstImpression(profile.id)
  return c.json(profile)
})

// Edit a profile — the review/edit step after CV extraction (R31), and general profile editing.
api.put('/profile/:id', async (c) => {
  const user = await requireUser(c)
  const profile = await ownProfile(user.id, Number(c.req.param('id')))
  const b = await parseBody(c, profileSchema)
  const updated = await db.updateProfile(profile.id, {
    role: b.role,
    company: b.company ?? null,
    skill_pack: b.skill_pack ?? null,
    technologies: b.technologies,
    years_experience: b.years_experience,
    notes: b.notes ?? null,
  })
  return c.json(updated)
})

api.get('/profile', async (c) => {
  const user = await requireUser(c)
  const profile = await db.activeProfile(user.id)
  if (!profile) return c.json(null)
  const [weaknesses, skill_claims] = await Promise.all([
    db.listWeaknesses(profile.id),
    db.listClaims(profile.id),
  ])
  return c.json({ ...profile, weaknesses, skill_claims })
})

// All of the user's profiles + which one is active (R24 — the profile switcher).
api.get('/profiles', async (c) => {
  const user = await requireUser(c)
  const profiles = await db.listProfiles(user.id)
  const active = await db.activeProfile(user.id)
  return c.json({ profiles, active_profile_id: active?.id ?? null })
})

// Switch the active profile (must be one of the user's own).
api.post('/profiles/:id/select', async (c) => {
  const user = await requireUser(c)
  const profile = await ownProfile(user.id, Number(c.req.param('id')))
  await db.setActiveProfile(user.id, profile.id)
  return c.json({ ok: true })
})

// Delete a profile/position and all its history (R36). Cascades to interviews, weaknesses,
// skill claims, events, calibrations and the user model at the DB. Frees a first-impression
// slot (R32) since the deleted profile's `first_impression_at` goes with it.
api.delete('/profiles/:id', async (c) => {
  const user = await requireUser(c)
  const profile = await ownProfile(user.id, Number(c.req.param('id')))
  await db.deleteProfile(profile.id)
  const active = await db.activeProfile(user.id)
  return c.json({ ok: true, active_profile_id: active?.id ?? null })
})

// ── calibration ─────────────────────────────────────────────────────

api.post('/calibration/start', async (c) => {
  // Verify ownership BEFORE the entitlement check so a first-impression credit is only ever
  // consumed against the caller's own profile (R32).
  const user = await requireUser(c)
  const { profile_id } = await parseBody(c, calibrationStartSchema)
  const profile = await ownProfile(user.id, profile_id)
  const call = await resolveCall(user, 'calibration')
  await enforceEntitlement(user, call, 'calibration', profile.id)
  const body = await db.activePromptBody('calibration.generate')
  const raw = await runModel(user, call, 'You generate interview calibration questions as JSON.', [
    { role: 'user', content: renderCalibrationGenerate(body, profile) },
  ])
  const questions = extractJson<string[]>(raw)
  const id = await db.createCalibration(profile.id, questions)
  return c.json({ calibration_id: id, questions })
})

api.post('/calibration/submit', async (c) => {
  const user = await requireUser(c)
  const { calibration_id, answers } = await parseBody(c, calibrationSubmitSchema)
  const calibration = await db.getCalibration(calibration_id)
  if (!calibration) throw new HttpError(404, 'calibration not found')
  const profile = await ownProfile(user.id, calibration.profile_id)
  const call = await resolveCall(user)
  // Idempotent: the matching /start already consumed this profile's first impression.
  await enforceEntitlement(user, call, 'calibration', profile.id)
  const body = await db.activePromptBody('calibration.grade')
  const raw = await runModel(user, call, 'You grade interview calibration quizzes as JSON.', [
    {
      role: 'user',
      content: renderCalibrationGrade(body, profile, calibration.questions as string[], answers),
    },
  ])
  const result = extractJson<{ level: string; summary: string }>(raw)
  await db.saveCalibrationResult(calibration_id, result)
  await db.setProfileLevel(profile.id, result.level, result.summary)
  await db.recordEvent(profile.id, 'calibration', `assessed level: ${result.level}`)
  return c.json(result)
})

// ── interviews ──────────────────────────────────────────────────────

async function systemFor(interview: db.InterviewRow, weaknessId?: number): Promise<string> {
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
    return renderCoachingSystem(body, profile, target, interview.mode, userModel?.summary ?? null)
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
  )
}

const stripToken = (text: string) => text.replace('[INTERVIEW_COMPLETE]', '').trim()

/**
 * Re-distill a profile's "what we know about you" model after an interview (D2 / Phase 4).
 * Reads the prior model + recent events + the fresh report, asks the model for an updated body,
 * and stores it (as an LLM distillation → `edited: false`, folding in any earlier user correction
 * since the prior body is fed back in). Capped small; the caller treats failure as non-fatal.
 */
async function distillUserModel(
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

api.post('/interviews', async (c) => {
  const body = await parseBody(c, interviewSchema)
  // Coaching drills are domain-agnostic (weakness-driven) → always the technical model route.
  const dom = domainDef(body.kind === 'coaching' ? 'technical' : body.domain)
  const { user, call } = await requireCall(c, 'interview', { feature: dom.feature })
  const profile = await ownProfile(user.id, body.profile_id)

  const interview = await db.createInterview(profile.id, body.mode, body.kind, dom.key)
  await db.recordEvent(
    profile.id,
    'interview_started',
    `${dom.key} ${body.kind} · ${body.mode}`,
    interview.id,
  )
  const system = await systemFor(interview, body.weakness_id)
  const messages: ChatMessage[] = [{ role: 'user', content: FIRST_MESSAGE_TRIGGER }]

  const persist = (opener: string) =>
    db.saveTranscript(interview.id, [{ role: 'assistant', content: opener }])

  if (!wantsStream(c)) {
    const opener = await runModel(user, call, system, messages)
    await persist(opener)
    return c.json({ interview_id: interview.id, message: opener })
  }

  return streamSSE(c, async (stream) => {
    try {
      const opener = await runModel(user, call, system, messages, 4096, (t) => {
        void stream.writeSSE({ event: 'delta', data: JSON.stringify(t) })
      })
      await persist(opener)
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ interview_id: interview.id, message: opener }),
      })
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      })
    }
  })
})

api.post('/interviews/:id/messages', async (c) => {
  const user = await requireUser(c)
  const id = Number(c.req.param('id'))
  const interview = await ownInterview(user.id, id)
  if (interview.status !== 'active') throw new HttpError(409, 'interview already finished')
  const call = await callForInterview(user, interview)

  const { content, preference } = await parseBody(c, messageSchema)
  // One-tap steering chip (Phase 4): log the preference so the user-model distiller learns it.
  if (preference) await db.recordEvent(interview.profile_id, 'preference', preference, interview.id)

  const transcript = [...interview.transcript, { role: 'user', content } as const]
  const system = await systemFor(interview)
  // The model only ever saw FIRST_MESSAGE_TRIGGER as turn one; replay it so
  // roles alternate user/assistant from the start.
  const messages: ChatMessage[] = [{ role: 'user', content: FIRST_MESSAGE_TRIGGER }, ...transcript]

  const persist = async (reply: string): Promise<{ message: string; done: boolean }> => {
    const done = reply.includes('[INTERVIEW_COMPLETE]')
    const cleaned = stripToken(reply)
    transcript.push({ role: 'assistant', content: cleaned })
    await db.saveTranscript(id, transcript)
    return { message: cleaned, done }
  }

  if (!wantsStream(c)) {
    const reply = await runModel(user, call, system, messages)
    return c.json(await persist(reply))
  }

  return streamSSE(c, async (stream) => {
    try {
      const reply = await runModel(user, call, system, messages, 4096, (t) => {
        void stream.writeSSE({ event: 'delta', data: JSON.stringify(t) })
      })
      await stream.writeSSE({ event: 'done', data: JSON.stringify(await persist(reply)) })
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      })
    }
  })
})

api.post('/interviews/:id/finish', async (c) => {
  const user = await requireUser(c)
  const id = Number(c.req.param('id'))
  const interview = await ownInterview(user.id, id)
  if (interview.status === 'finished') return c.json(interview.report)
  if (interview.transcript.length < 2)
    throw new HttpError(400, 'not enough conversation to evaluate — answer at least one question')
  const call = await callForInterview(user, interview)

  const profile = await ownProfile(user.id, interview.profile_id)
  const claims = await db.listClaims(profile.id)

  const evalBody = await db.activePromptBody('evaluation')
  const raw = await runModel(
    user,
    call,
    'You evaluate mock interviews and respond with strict JSON.',
    [
      {
        role: 'user',
        content: renderEvaluation(
          evalBody,
          profile,
          interview.transcript,
          claims,
          domainDef(interview.domain).label,
        ),
      },
    ],
    8192,
  )
  const report = extractJson<
    db.InterviewReport & { skill_evidence?: { skill: string; verdict: string; note?: string }[] }
  >(raw)
  await db.finishInterview(id, report)
  for (const w of report.weaknesses) await db.addWeakness(profile.id, w, id)
  // Evidence-gating (R23): flip claimed skills to demonstrated/weak based on shown evidence.
  if (Array.isArray(report.skill_evidence)) await db.applySkillEvidence(profile.id, id, report.skill_evidence)
  await db.recordEvent(
    profile.id,
    'interview_finished',
    `score ${report.overall_score}/100 · ${report.level_estimate}`,
    id,
  )
  // Personalization (D2): re-distill the user model from the prior model + recent events + this
  // result, so the next interview "knows" the candidate. Best-effort — never fail finishing on it.
  // Routed to its own feature model (R35) — the interview is already authorized, so this reuses
  // that entitlement and only swaps which model does the (cheap) summarization.
  const distillCall = await resolveCall(user, 'personalization.distill').catch(() => call)
  await distillUserModel(user, distillCall, profile, report).catch((err: unknown) =>
    console.error(JSON.stringify({ level: 'warn', msg: 'distill failed', error: String(err) })),
  )
  return c.json(report)
})

api.get('/interviews', async (c) => {
  const user = await requireUser(c)
  const interviews = await db.listInterviewsForUser(user.id)
  return c.json(
    interviews.map((i) => ({
      id: i.id,
      mode: i.mode,
      kind: i.kind,
      domain: i.domain,
      status: i.status,
      created_at: i.created_at,
      turns: i.transcript.length,
      overall_score: i.report?.overall_score ?? null,
      level_estimate: i.report?.level_estimate ?? null,
    })),
  )
})

api.get('/interviews/:id', async (c) => {
  const user = await requireUser(c)
  const interview = await ownInterview(user.id, Number(c.req.param('id')))
  return c.json(interview)
})

// Discard an in-progress interview the user chose to abandon (never a finished one,
// so reports stay intact). Phase 12 (D14): clears a stale "resume" entry.
api.delete('/interviews/:id', async (c) => {
  const user = await requireUser(c)
  const interview = await ownInterview(user.id, Number(c.req.param('id')))
  if (interview.status === 'finished') throw new HttpError(409, 'cannot discard a finished interview')
  await db.deleteInterview(interview.id)
  return c.json({ ok: true })
})

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
