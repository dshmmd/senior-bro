import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { DEFAULT_MODELS, loadConfig, saveConfig, type AppConfig } from './config.js'
import * as db from './db.js'
import { chat, extractJson, validateKey, type ChatMessage } from './providers.js'
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

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function requireConfig(): AppConfig {
  const cfg = loadConfig()
  if (!cfg) throw new HttpError(409, 'Not configured: set provider and API key first')
  return cfg
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

const configSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'mock']),
  apiKey: z.string().min(4).max(400),
  model: z.string().max(120).optional(),
})

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

// ── config ──────────────────────────────────────────────────────────

api.get('/health', (c) => c.json({ ok: true, configured: loadConfig() !== null }))

api.get('/config', (c) => {
  const cfg = loadConfig()
  return c.json(cfg ? { provider: cfg.provider, model: cfg.model, hasKey: true } : { hasKey: false })
})

api.post('/config', async (c) => {
  const body = await parseBody(c, configSchema)
  const cfg: AppConfig = {
    provider: body.provider,
    apiKey: body.apiKey.trim(),
    model: body.model?.trim() ?? DEFAULT_MODELS[body.provider],
  }
  const check = await validateKey(cfg)
  if (!check.ok) throw new HttpError(400, `API key validation failed: ${check.error ?? 'unknown'}`)
  saveConfig(cfg)
  return c.json({ ok: true, provider: cfg.provider, model: cfg.model })
})

// ── skills ──────────────────────────────────────────────────────────

api.get('/skills', (c) =>
  c.json(loadSkillPacks().map(({ id, company, roles, summary }) => ({ id, company, roles, summary }))),
)

// ── profile ─────────────────────────────────────────────────────────

api.post('/profile', async (c) => {
  const body = await parseBody(c, profileSchema)
  const profile = db.createProfile({
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
  const profile = db.latestProfile()
  if (!profile) return c.json(null)
  return c.json({ ...profile, weaknesses: db.listWeaknesses(profile.id) })
})

// ── calibration ─────────────────────────────────────────────────────

api.post('/calibration/start', async (c) => {
  const cfg = requireConfig()
  const { profile_id } = await parseBody(c, calibrationStartSchema)
  const profile = db.getProfile(profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')
  const raw = await chat(cfg, 'You generate interview calibration questions as JSON.', [
    { role: 'user', content: calibrationGeneratePrompt(profile) },
  ])
  const questions = extractJson<string[]>(raw)
  const id = db.createCalibration(profile.id, questions)
  return c.json({ calibration_id: id, questions })
})

api.post('/calibration/submit', async (c) => {
  const cfg = requireConfig()
  const { calibration_id, answers } = await parseBody(c, calibrationSubmitSchema)
  const calibration = db.getCalibration(calibration_id)
  if (!calibration) throw new HttpError(404, 'calibration not found')
  const profile = db.getProfile(calibration.profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')
  const raw = await chat(cfg, 'You grade interview calibration quizzes as JSON.', [
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
  const cfg = requireConfig()
  const body = await parseBody(c, interviewSchema)
  const profile = db.getProfile(body.profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')

  const interview = db.createInterview(profile.id, body.mode, body.kind)
  const system = systemFor(interview, body.weakness_id)
  const messages: ChatMessage[] = [{ role: 'user', content: FIRST_MESSAGE_TRIGGER }]

  const persist = (opener: string) => {
    db.saveTranscript(interview.id, [{ role: 'assistant', content: opener }])
  }

  if (!wantsStream(c)) {
    const opener = await chat(cfg, system, messages)
    persist(opener)
    return c.json({ interview_id: interview.id, message: opener })
  }

  return streamSSE(c, async (stream) => {
    try {
      const opener = await chat(cfg, system, messages, 4096, (t) => {
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
  const cfg = requireConfig()
  const id = Number(c.req.param('id'))
  const interview = db.getInterview(id)
  if (!interview) throw new HttpError(404, 'interview not found')
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
    const reply = await chat(cfg, system, messages)
    return c.json(persist(reply))
  }

  return streamSSE(c, async (stream) => {
    try {
      const reply = await chat(cfg, system, messages, 4096, (t) => {
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
  const cfg = requireConfig()
  const id = Number(c.req.param('id'))
  const interview = db.getInterview(id)
  if (!interview) throw new HttpError(404, 'interview not found')
  if (interview.status === 'finished') return c.json(interview.report)
  if (interview.transcript.length < 2)
    throw new HttpError(400, 'not enough conversation to evaluate — answer at least one question')

  const profile = db.getProfile(interview.profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')

  const raw = await chat(
    cfg,
    'You evaluate mock interviews and respond with strict JSON.',
    [{ role: 'user', content: evaluationPrompt(profile, interview.transcript) }],
    8192,
  )
  const report = extractJson<db.InterviewReport>(raw)
  db.finishInterview(id, report)
  for (const w of report.weaknesses) db.addWeakness(profile.id, w, id)
  return c.json(report)
})

api.get('/interviews', (c) =>
  c.json(
    db.listInterviews().map((i) => ({
      id: i.id,
      mode: i.mode,
      kind: i.kind,
      status: i.status,
      created_at: i.created_at,
      turns: i.transcript.length,
      overall_score: i.report?.overall_score ?? null,
      level_estimate: i.report?.level_estimate ?? null,
    })),
  ),
)

api.get('/interviews/:id', (c) => {
  const interview = db.getInterview(Number(c.req.param('id')))
  if (!interview) throw new HttpError(404, 'interview not found')
  return c.json(interview)
})

// ── weaknesses ──────────────────────────────────────────────────────

api.get('/weaknesses', (c) => {
  const profile = db.latestProfile()
  return c.json(profile ? db.listWeaknesses(profile.id) : [])
})

api.post('/weaknesses/:id/status', async (c) => {
  const { status } = await parseBody(c, weaknessStatusSchema)
  db.setWeaknessStatus(Number(c.req.param('id')), status)
  return c.json({ ok: true })
})

// ── progress (gamification) ─────────────────────────────────────────

api.get('/progress', (c) => {
  const profile = db.latestProfile()
  if (!profile) return c.json(null)
  const interviews = db.listInterviews().filter((i) => i.profile_id === profile.id)
  const weaknesses = db.listWeaknesses(profile.id)
  return c.json(computeProgress(profile, interviews, weaknesses))
})
