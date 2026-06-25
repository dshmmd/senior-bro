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

/**
 * A resolved model call: which provider/key to use, plus the metering metadata
 * (catalog id + per-Mtok prices) so usage can be recorded and quotas enforced.
 * `modelId` is null for BYOK (the user's own key → no host cost, no quota).
 */
interface ResolvedCall {
  cfg: AppConfig
  modelId: number | null
  priceIn: number
  priceOut: number
}

function resolveCall(user: db.User): ResolvedCall {
  if (user.model_id !== null) {
    const resolved = db.modelConfig(user.model_id)
    if (!resolved?.option.enabled)
      throw new HttpError(409, 'your selected model is no longer available — pick another')
    return {
      cfg: resolved.cfg,
      modelId: resolved.option.id,
      priceIn: resolved.option.price_in,
      priceOut: resolved.option.price_out,
    }
  }
  const cfg = db.getUserConfig(user.id)
  if (!cfg) throw new HttpError(409, 'Not configured: set provider and API key first')
  return { cfg, modelId: null, priceIn: 0, priceOut: 0 }
}

/** Resolve the requesting user + their model call in one step (401/409 otherwise). */
function requireCall(c: Context): { user: db.User; call: ResolvedCall } {
  const user = requireUser(c)
  return { user, call: resolveCall(user) }
}

/** Block a host-key call when the user is over their token quota (BYOK is never blocked). */
function enforceQuota(user: db.User, call: ResolvedCall): void {
  if (call.modelId === null || user.token_quota === null) return
  if (db.tokensUsed(user.id) >= user.token_quota)
    throw new HttpError(402, 'token quota reached — contact the admin to raise your limit')
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
  enforceQuota(user, call)
  const { text, usage } = await chat(call.cfg, system, messages, maxTokens, onDelta)
  const costUsd =
    (usage.inputTokens / 1_000_000) * call.priceIn + (usage.outputTokens / 1_000_000) * call.priceOut
  db.recordUsage({
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
function ownProfile(userId: number, profileId: number): db.Profile {
  const profile = db.getProfile(profileId)
  if (profile?.user_id !== userId) throw new HttpError(404, 'profile not found')
  return profile
}

/** Throw 404 unless `interviewId` is owned (via its profile) by `userId`. */
function ownInterview(userId: number, interviewId: number): db.InterviewRow {
  const interview = db.getInterview(interviewId)
  if (!interview) throw new HttpError(404, 'interview not found')
  ownProfile(userId, interview.profile_id)
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

// ── config ──────────────────────────────────────────────────────────

api.get('/health', (c) => {
  const user = currentUser(c)
  const configured = user ? db.getUserConfig(user.id) !== null : false
  return c.json({
    ok: true,
    mode: MODE,
    authed: user !== null,
    user: user ? { email: user.email, role: user.role } : null,
    configured,
  })
})

api.get('/config', (c) => {
  const user = requireUser(c)
  const cfg = db.getUserConfig(user.id)
  return c.json(cfg ? { provider: cfg.provider, model: cfg.model, hasKey: true } : { hasKey: false })
})

api.post('/config', async (c) => {
  const user = requireUser(c)
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
  db.setUserConfig(user.id, cfg)
  return c.json({ ok: true, provider: cfg.provider, model: cfg.model })
})

// ── auth (hosted mode: email magic-link, no passwords) ───────────────

api.get('/auth/me', (c) => {
  const user = currentUser(c)
  return c.json(user ? { email: user.email, role: user.role } : null)
})

api.post('/auth/request', async (c) => {
  if (!isHosted) throw new HttpError(400, 'accounts are only used in hosted mode')
  const { email } = await parseBody(c, authRequestSchema)
  const token = randomToken(32)
  db.createMagicLink(email, token, 20)
  const origin = c.req.header('origin') ?? new URL(c.req.url).origin
  const link = `${origin}/?magic=${token}`
  await sendMagicLink(email, link)
  // In non-prod (no real mailbox) we hand the link back so dev/staging can sign in.
  return c.json({ ok: true, sent: true, ...(revealLinks() ? { link } : {}) })
})

api.post('/auth/verify', async (c) => {
  if (!isHosted) throw new HttpError(400, 'accounts are only used in hosted mode')
  const { token } = await parseBody(c, authVerifySchema)
  const email = db.consumeMagicLink(token)
  if (!email) throw new HttpError(400, 'this sign-in link is invalid or expired — request a new one')
  const user = db.upsertUserByEmail(email)
  // Promote configured admin emails (SENIORBRO_ADMIN_EMAILS) on sign-in.
  let role = user.role
  if (isAdminEmail(email) && role !== 'admin') {
    db.setUserRole(user.id, 'admin')
    role = 'admin'
  }
  startSession(c, user.id)
  return c.json({ ok: true, email: user.email, role })
})

api.post('/auth/logout', (c) => {
  endSession(c)
  return c.json({ ok: true })
})

// ── model catalog & usage (user-facing) ──────────────────────────────

// Curated models the user may pick from (admin-enabled only; never exposes keys).
api.get('/models', (c) => {
  const user = requireUser(c)
  return c.json({ models: db.listModels(true), selected_model_id: user.model_id })
})

// Pick an admin-curated model (host key + metered). Hosted mode only.
api.post('/models/select', async (c) => {
  const user = requireUser(c)
  const { model_id } = await parseBody(c, modelSelectSchema)
  const option = db.getModel(model_id)
  if (!option?.enabled) throw new HttpError(404, 'model not available')
  db.setUserModelChoice(user.id, model_id)
  return c.json({ ok: true })
})

// The signed-in user's own usage + quota.
api.get('/usage', (c) => {
  const user = requireUser(c)
  return c.json({
    usage: db.usageSummary(user.id),
    token_quota: user.token_quota,
    tokens_used: db.tokensUsed(user.id),
  })
})

// ── admin (model/key management, users, usage console) ───────────────

api.get('/admin/models', (c) => {
  requireAdmin(c)
  return c.json(db.listModels(false))
})

api.post('/admin/models', async (c) => {
  requireAdmin(c)
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
  const created = db.createModel({
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
  requireAdmin(c)
  const id = Number(c.req.param('id'))
  const body = await parseBody(c, modelUpdateSchema)
  const updated = db.updateModel(id, {
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

api.delete('/admin/models/:id', (c) => {
  requireAdmin(c)
  db.deleteModel(Number(c.req.param('id')))
  return c.json({ ok: true })
})

api.get('/admin/users', (c) => {
  requireAdmin(c)
  return c.json(
    db.listUsers().map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      model_id: u.model_id,
      token_quota: u.token_quota,
      ...db.usageSummary(u.id),
    })),
  )
})

api.post('/admin/users/:id/quota', async (c) => {
  requireAdmin(c)
  const { token_quota } = await parseBody(c, quotaSchema)
  db.setUserQuota(Number(c.req.param('id')), token_quota)
  return c.json({ ok: true })
})

// ── skills ──────────────────────────────────────────────────────────

api.get('/skills', (c) =>
  c.json(loadSkillPacks().map(({ id, company, roles, summary }) => ({ id, company, roles, summary }))),
)

// ── profile ─────────────────────────────────────────────────────────

api.post('/profile', async (c) => {
  const user = requireUser(c)
  const body = await parseBody(c, profileSchema)
  const profile = db.createProfile(user.id, {
    role: body.role,
    company: body.company ?? null,
    skill_pack: body.skill_pack ?? null,
    technologies: body.technologies,
    years_experience: body.years_experience,
    notes: body.notes ?? null,
  })
  return c.json(profile)
})

api.get('/profile', (c) => {
  const user = requireUser(c)
  const profile = db.latestProfile(user.id)
  if (!profile) return c.json(null)
  return c.json({ ...profile, weaknesses: db.listWeaknesses(profile.id) })
})

// ── calibration ─────────────────────────────────────────────────────

api.post('/calibration/start', async (c) => {
  const { user, call } = requireCall(c)
  const { profile_id } = await parseBody(c, calibrationStartSchema)
  const profile = ownProfile(user.id, profile_id)
  const raw = await runModel(user, call, 'You generate interview calibration questions as JSON.', [
    { role: 'user', content: calibrationGeneratePrompt(profile) },
  ])
  const questions = extractJson<string[]>(raw)
  const id = db.createCalibration(profile.id, questions)
  return c.json({ calibration_id: id, questions })
})

api.post('/calibration/submit', async (c) => {
  const { user, call } = requireCall(c)
  const { calibration_id, answers } = await parseBody(c, calibrationSubmitSchema)
  const calibration = db.getCalibration(calibration_id)
  if (!calibration) throw new HttpError(404, 'calibration not found')
  const profile = ownProfile(user.id, calibration.profile_id)
  const raw = await runModel(user, call, 'You grade interview calibration quizzes as JSON.', [
    { role: 'user', content: calibrationGradePrompt(profile, calibration.questions as string[], answers) },
  ])
  const result = extractJson<{ level: string; summary: string }>(raw)
  db.saveCalibrationResult(calibration_id, result)
  db.setProfileLevel(profile.id, result.level, result.summary)
  return c.json(result)
})

// ── interviews ──────────────────────────────────────────────────────

function systemFor(interview: db.InterviewRow, weaknessId?: number): string {
  const profile = db.getProfile(interview.profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')
  if (interview.kind === 'coaching') {
    const weaknesses = db.listWeaknesses(profile.id)
    const target = weaknessId ? db.getWeakness(weaknessId) : weaknesses.find((w) => w.status !== 'resolved')
    if (!target) throw new HttpError(400, 'no open weakness to coach on')
    return coachingSystemPrompt(profile, target, interview.mode)
  }
  const pack = profile.skill_pack ? getSkillPack(profile.skill_pack) : null
  return interviewSystemPrompt(profile, pack, db.listWeaknesses(profile.id), interview.mode)
}

const stripToken = (text: string) => text.replace('[INTERVIEW_COMPLETE]', '').trim()

api.post('/interviews', async (c) => {
  const { user, call } = requireCall(c)
  const body = await parseBody(c, interviewSchema)
  const profile = ownProfile(user.id, body.profile_id)

  const interview = db.createInterview(profile.id, body.mode, body.kind)
  const system = systemFor(interview, body.weakness_id)
  const messages: ChatMessage[] = [{ role: 'user', content: FIRST_MESSAGE_TRIGGER }]

  const persist = (opener: string) => {
    db.saveTranscript(interview.id, [{ role: 'assistant', content: opener }])
  }

  if (!wantsStream(c)) {
    const opener = await runModel(user, call, system, messages)
    persist(opener)
    return c.json({ interview_id: interview.id, message: opener })
  }

  return streamSSE(c, async (stream) => {
    try {
      const opener = await runModel(user, call, system, messages, 4096, (t) => {
        void stream.writeSSE({ event: 'delta', data: JSON.stringify(t) })
      })
      persist(opener)
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
  const { user, call } = requireCall(c)
  const id = Number(c.req.param('id'))
  const interview = ownInterview(user.id, id)
  if (interview.status !== 'active') throw new HttpError(409, 'interview already finished')

  const { content } = await parseBody(c, messageSchema)

  const transcript = [...interview.transcript, { role: 'user', content } as const]
  const system = systemFor(interview)
  // The model only ever saw FIRST_MESSAGE_TRIGGER as turn one; replay it so
  // roles alternate user/assistant from the start.
  const messages: ChatMessage[] = [{ role: 'user', content: FIRST_MESSAGE_TRIGGER }, ...transcript]

  const persist = (reply: string): { message: string; done: boolean } => {
    const done = reply.includes('[INTERVIEW_COMPLETE]')
    const cleaned = stripToken(reply)
    transcript.push({ role: 'assistant', content: cleaned })
    db.saveTranscript(id, transcript)
    return { message: cleaned, done }
  }

  if (!wantsStream(c)) {
    const reply = await runModel(user, call, system, messages)
    return c.json(persist(reply))
  }

  return streamSSE(c, async (stream) => {
    try {
      const reply = await runModel(user, call, system, messages, 4096, (t) => {
        void stream.writeSSE({ event: 'delta', data: JSON.stringify(t) })
      })
      await stream.writeSSE({ event: 'done', data: JSON.stringify(persist(reply)) })
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      })
    }
  })
})

api.post('/interviews/:id/finish', async (c) => {
  const { user, call } = requireCall(c)
  const id = Number(c.req.param('id'))
  const interview = ownInterview(user.id, id)
  if (interview.status === 'finished') return c.json(interview.report)
  if (interview.transcript.length < 2)
    throw new HttpError(400, 'not enough conversation to evaluate — answer at least one question')

  const profile = ownProfile(user.id, interview.profile_id)

  const raw = await runModel(
    user,
    call,
    'You evaluate mock interviews and respond with strict JSON.',
    [{ role: 'user', content: evaluationPrompt(profile, interview.transcript) }],
    8192,
  )
  const report = extractJson<db.InterviewReport>(raw)
  db.finishInterview(id, report)
  for (const w of report.weaknesses) db.addWeakness(profile.id, w, id)
  return c.json(report)
})

api.get('/interviews', (c) => {
  const user = requireUser(c)
  return c.json(
    db.listInterviewsForUser(user.id).map((i) => ({
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

api.get('/interviews/:id', (c) => {
  const user = requireUser(c)
  const interview = ownInterview(user.id, Number(c.req.param('id')))
  return c.json(interview)
})

// ── weaknesses ──────────────────────────────────────────────────────

api.get('/weaknesses', (c) => {
  const user = requireUser(c)
  const profile = db.latestProfile(user.id)
  return c.json(profile ? db.listWeaknesses(profile.id) : [])
})

api.post('/weaknesses/:id/status', async (c) => {
  const user = requireUser(c)
  const { status } = await parseBody(c, weaknessStatusSchema)
  const weakness = db.getWeakness(Number(c.req.param('id')))
  if (!weakness) throw new HttpError(404, 'weakness not found')
  ownProfile(user.id, weakness.profile_id)
  db.setWeaknessStatus(weakness.id, status)
  return c.json({ ok: true })
})

// ── progress (gamification) ─────────────────────────────────────────

api.get('/progress', (c) => {
  const user = requireUser(c)
  const profile = db.latestProfile(user.id)
  if (!profile) return c.json(null)
  const interviews = db.listInterviewsForUser(user.id).filter((i) => i.profile_id === profile.id)
  const weaknesses = db.listWeaknesses(profile.id)
  return c.json(computeProgress(profile, interviews, weaknesses))
})
