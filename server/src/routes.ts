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
import { chat, extractJson, validateKey, type ChatMessage, type OnDelta } from './providers.js'
import { getSkillPack, loadSkillPacks } from './skills.js'
import { computeProgress } from './progress.js'
import {
  FIRST_MESSAGE_TRIGGER,
  calibrationGeneratePrompt,
  calibrationGradePrompt,
  coachingSystemPrompt,
  evaluationPrompt,
  interviewSystemPrompt,
} from './prompts.js'

export const api = new Hono()

/** The platform-funded free level-check budget (tokens) for `free-intro` users (D11). */
const FREE_INTRO_TOKEN_BUDGET = 30_000

/** Token packs the mocked checkout sells (real Stripe/crypto is Phase 8). */
const CREDIT_PACKS = [100_000, 500_000, 1_000_000] as const

/** What a model call is for — gates which plans may make it (D11). */
type CallKind = 'calibration' | 'interview'

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

async function resolveCall(user: db.User): Promise<ResolvedCall> {
  if (user.model_id !== null) {
    const resolved = await db.modelConfig(user.model_id)
    if (!resolved?.option.enabled)
      throw new HttpError(409, 'your selected model is no longer available — pick another')
    return {
      cfg: resolved.cfg,
      modelId: resolved.option.id,
      priceIn: resolved.option.price_in,
      priceOut: resolved.option.price_out,
      freeIntro: false,
    }
  }
  const cfg = await db.getUserConfig(user.id)
  if (cfg) return { cfg, modelId: null, priceIn: 0, priceOut: 0, freeIntro: false }
  // Hosted free-intro user with nothing configured: the platform's default model
  // powers their free level-check (capped by FREE_INTRO_TOKEN_BUDGET, enforced below).
  if (isHosted && user.plan === 'free-intro') {
    const def = await db.defaultModel()
    const mc = def ? await db.modelConfig(def.id) : null
    if (def && mc)
      return { cfg: mc.cfg, modelId: def.id, priceIn: def.price_in, priceOut: def.price_out, freeIntro: true }
    throw new HttpError(409, 'No model is available yet — the admin needs to add one')
  }
  throw new HttpError(409, 'Not configured: set provider and API key first')
}

/**
 * Entitlement gate (D11), hosted mode only — local mode is always unrestricted.
 * - BYOK/CLI (user's own key): free, never blocked.
 * - free-intro on the platform default model: calibration only, under the free budget.
 * - paid host model: requires remaining token credit (`tokens_used < token_quota`).
 */
async function enforceEntitlement(user: db.User, call: ResolvedCall, kind: CallKind): Promise<void> {
  if (!isHosted) return
  if (call.modelId === null) return
  if (call.freeIntro) {
    if (kind !== 'calibration')
      throw new HttpError(402, 'Pick a plan to start interviews — the free check covers the level quiz only')
    if ((await db.tokensUsed(user.id)) >= FREE_INTRO_TOKEN_BUDGET)
      throw new HttpError(402, 'Your free level-check is used up — choose a plan to keep going')
    return
  }
  if (user.token_quota === null || (await db.tokensUsed(user.id)) >= user.token_quota)
    throw new HttpError(402, 'Out of token credit — add credit or redeem an invite code')
}

/** Resolve the requesting user + their model call, enforcing entitlement (401/402/409). */
async function requireCall(c: Context, kind: CallKind): Promise<{ user: db.User; call: ResolvedCall }> {
  const user = await requireUser(c)
  const call = await resolveCall(user)
  await enforceEntitlement(user, call, kind)
  return { user, call }
}

/** Run a model call, record its token usage/cost, and return the text. */
async function runModel(
  user: db.User,
  call: ResolvedCall,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
  onDelta?: OnDelta,
): Promise<string> {
  const { text, usage } = await chat(call.cfg, system, messages, maxTokens, onDelta)
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
  return text
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

const calibrationStartSchema = z.object({ profile_id: z.number().int().positive() })

const calibrationSubmitSchema = z.object({
  calibration_id: z.number().int().positive(),
  answers: z.array(z.string().max(8000)).min(1).max(10),
})

const interviewSchema = z.object({
  profile_id: z.number().int().positive(),
  mode: z.enum(['voice', 'text']).default('text'),
  kind: z.enum(['full', 'coaching']).default('full'),
  weakness_id: z.number().int().positive().optional(),
})

const messageSchema = z.object({ content: z.string().trim().min(1).max(8000) })

const weaknessStatusSchema = z.object({ status: z.enum(['open', 'improving', 'resolved']) })

const modelCreateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  provider: z.enum(['anthropic', 'openai', 'mock']),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(400).optional(),
  enabled: z.boolean().default(true),
  is_default: z.boolean().default(false),
  price_in: z.number().min(0).max(10000).default(0),
  price_out: z.number().min(0).max(10000).default(0),
})

const modelUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().max(400).optional(),
  enabled: z.boolean().optional(),
  is_default: z.boolean().optional(),
  price_in: z.number().min(0).max(10000).optional(),
  price_out: z.number().min(0).max(10000).optional(),
})

const modelSelectSchema = z.object({ model_id: z.number().int().positive() })
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
  return c.json({
    usage: await db.usageSummary(user.id),
    plan: user.plan,
    token_quota: user.token_quota,
    tokens_used: tokensUsed,
    credit_left: user.token_quota !== null ? Math.max(0, user.token_quota - tokensUsed) : null,
    free_intro_budget: FREE_INTRO_TOKEN_BUDGET,
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
    })
    if (!check.ok) throw new HttpError(400, `key validation failed: ${check.error ?? 'unknown'}`)
  }
  const created = await db.createModel({
    label: body.label,
    provider: body.provider,
    model: body.model,
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

// ── skills ──────────────────────────────────────────────────────────

api.get('/skills', (c) =>
  c.json(loadSkillPacks().map(({ id, company, roles, summary }) => ({ id, company, roles, summary }))),
)

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
  return c.json(profile)
})

api.get('/profile', async (c) => {
  const user = await requireUser(c)
  const profile = await db.latestProfile(user.id)
  if (!profile) return c.json(null)
  return c.json({ ...profile, weaknesses: await db.listWeaknesses(profile.id) })
})

// ── calibration ─────────────────────────────────────────────────────

api.post('/calibration/start', async (c) => {
  const { user, call } = await requireCall(c, 'calibration')
  const { profile_id } = await parseBody(c, calibrationStartSchema)
  const profile = await ownProfile(user.id, profile_id)
  const raw = await runModel(user, call, 'You generate interview calibration questions as JSON.', [
    { role: 'user', content: calibrationGeneratePrompt(profile) },
  ])
  const questions = extractJson<string[]>(raw)
  const id = await db.createCalibration(profile.id, questions)
  return c.json({ calibration_id: id, questions })
})

api.post('/calibration/submit', async (c) => {
  const { user, call } = await requireCall(c, 'calibration')
  const { calibration_id, answers } = await parseBody(c, calibrationSubmitSchema)
  const calibration = await db.getCalibration(calibration_id)
  if (!calibration) throw new HttpError(404, 'calibration not found')
  const profile = await ownProfile(user.id, calibration.profile_id)
  const raw = await runModel(user, call, 'You grade interview calibration quizzes as JSON.', [
    { role: 'user', content: calibrationGradePrompt(profile, calibration.questions as string[], answers) },
  ])
  const result = extractJson<{ level: string; summary: string }>(raw)
  await db.saveCalibrationResult(calibration_id, result)
  await db.setProfileLevel(profile.id, result.level, result.summary)
  return c.json(result)
})

// ── interviews ──────────────────────────────────────────────────────

async function systemFor(interview: db.InterviewRow, weaknessId?: number): Promise<string> {
  const profile = await db.getProfile(interview.profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')
  if (interview.kind === 'coaching') {
    const weaknesses = await db.listWeaknesses(profile.id)
    const target = weaknessId
      ? await db.getWeakness(weaknessId)
      : weaknesses.find((w) => w.status !== 'resolved')
    if (!target) throw new HttpError(400, 'no open weakness to coach on')
    return coachingSystemPrompt(profile, target, interview.mode)
  }
  const pack = profile.skill_pack ? getSkillPack(profile.skill_pack) : null
  return interviewSystemPrompt(profile, pack, await db.listWeaknesses(profile.id), interview.mode)
}

const stripToken = (text: string) => text.replace('[INTERVIEW_COMPLETE]', '').trim()

api.post('/interviews', async (c) => {
  const { user, call } = await requireCall(c, 'interview')
  const body = await parseBody(c, interviewSchema)
  const profile = await ownProfile(user.id, body.profile_id)

  const interview = await db.createInterview(profile.id, body.mode, body.kind)
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
  const { user, call } = await requireCall(c, 'interview')
  const id = Number(c.req.param('id'))
  const interview = await ownInterview(user.id, id)
  if (interview.status !== 'active') throw new HttpError(409, 'interview already finished')

  const { content } = await parseBody(c, messageSchema)

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
  const { user, call } = await requireCall(c, 'interview')
  const id = Number(c.req.param('id'))
  const interview = await ownInterview(user.id, id)
  if (interview.status === 'finished') return c.json(interview.report)
  if (interview.transcript.length < 2)
    throw new HttpError(400, 'not enough conversation to evaluate — answer at least one question')

  const profile = await ownProfile(user.id, interview.profile_id)

  const raw = await runModel(
    user,
    call,
    'You evaluate mock interviews and respond with strict JSON.',
    [{ role: 'user', content: evaluationPrompt(profile, interview.transcript) }],
    8192,
  )
  const report = extractJson<db.InterviewReport>(raw)
  await db.finishInterview(id, report)
  for (const w of report.weaknesses) await db.addWeakness(profile.id, w, id)
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
  const profile = await db.latestProfile(user.id)
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

api.get('/progress', async (c) => {
  const user = await requireUser(c)
  const profile = await db.latestProfile(user.id)
  if (!profile) return c.json(null)
  const interviews = (await db.listInterviewsForUser(user.id)).filter((i) => i.profile_id === profile.id)
  const weaknesses = await db.listWeaknesses(profile.id)
  return c.json(computeProgress(profile, interviews, weaknesses))
})
