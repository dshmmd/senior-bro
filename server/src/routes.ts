import { Hono } from 'hono'
import { DEFAULT_MODELS, loadConfig, saveConfig, type AppConfig, type Provider } from './config.js'
import * as db from './db.js'
import { chat, extractJson, validateKey } from './providers.js'
import { getSkillPack, loadSkillPacks } from './skills.js'
import {
  FIRST_MESSAGE_TRIGGER,
  calibrationGeneratePrompt,
  calibrationGradePrompt,
  coachingSystemPrompt,
  evaluationPrompt,
  interviewSystemPrompt,
} from './prompts.js'

export const api = new Hono()

function requireConfig(): AppConfig {
  const cfg = loadConfig()
  if (!cfg) throw new HttpError(409, 'Not configured: set provider and API key first')
  return cfg
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

api.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500
  console.error(`[api] ${c.req.method} ${c.req.path} →`, err.message)
  return c.json({ error: err.message }, status as 409)
})

// ── config ──────────────────────────────────────────────────────────

api.get('/health', (c) => c.json({ ok: true, configured: loadConfig() !== null }))

api.get('/config', (c) => {
  const cfg = loadConfig()
  return c.json(cfg ? { provider: cfg.provider, model: cfg.model, hasKey: true } : { hasKey: false })
})

api.post('/config', async (c) => {
  const body = await c.req.json<{ provider: Provider; apiKey: string; model?: string }>()
  if (!body.provider || !body.apiKey) throw new HttpError(400, 'provider and apiKey are required')
  const cfg: AppConfig = {
    provider: body.provider,
    apiKey: body.apiKey.trim(),
    model: body.model?.trim() || DEFAULT_MODELS[body.provider],
  }
  const check = await validateKey(cfg)
  if (!check.ok) throw new HttpError(400, `API key validation failed: ${check.error}`)
  saveConfig(cfg)
  return c.json({ ok: true, provider: cfg.provider, model: cfg.model })
})

// ── skills ──────────────────────────────────────────────────────────

api.get('/skills', (c) =>
  c.json(loadSkillPacks().map(({ id, company, roles, summary }) => ({ id, company, roles, summary }))),
)

// ── profile ─────────────────────────────────────────────────────────

api.post('/profile', async (c) => {
  const body = await c.req.json<{
    role: string
    company?: string
    skill_pack?: string
    technologies?: string[]
    years_experience?: number
    notes?: string
  }>()
  if (!body.role?.trim()) throw new HttpError(400, 'role is required')
  const profile = db.createProfile({
    role: body.role.trim(),
    company: body.company?.trim() || null,
    skill_pack: body.skill_pack || null,
    technologies: body.technologies ?? [],
    years_experience: body.years_experience ?? 0,
    notes: body.notes?.trim() || null,
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
  const { profile_id } = await c.req.json<{ profile_id: number }>()
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
  const { calibration_id, answers } = await c.req.json<{ calibration_id: number; answers: string[] }>()
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

api.post('/interviews', async (c) => {
  const cfg = requireConfig()
  const body = await c.req.json<{
    profile_id: number
    mode?: 'voice' | 'text'
    kind?: 'full' | 'coaching'
    weakness_id?: number
  }>()
  const profile = db.getProfile(body.profile_id)
  if (!profile) throw new HttpError(404, 'profile not found')

  const interview = db.createInterview(profile.id, body.mode ?? 'text', body.kind ?? 'full')
  const system = systemFor(interview, body.weakness_id)
  const opener = await chat(cfg, system, [{ role: 'user', content: FIRST_MESSAGE_TRIGGER }])
  const transcript: db.TranscriptEntry[] = [{ role: 'assistant', content: opener }]
  db.saveTranscript(interview.id, transcript)
  return c.json({ interview_id: interview.id, message: opener })
})

api.post('/interviews/:id/messages', async (c) => {
  const cfg = requireConfig()
  const id = Number(c.req.param('id'))
  const interview = db.getInterview(id)
  if (!interview) throw new HttpError(404, 'interview not found')
  if (interview.status !== 'active') throw new HttpError(409, 'interview already finished')

  const { content } = await c.req.json<{ content: string }>()
  if (!content?.trim()) throw new HttpError(400, 'content is required')

  const transcript = [...interview.transcript, { role: 'user', content: content.trim() } as const]
  const system = systemFor(interview)
  // The model only ever saw FIRST_MESSAGE_TRIGGER as turn one; replay it so
  // roles alternate user/assistant from the start.
  const messages = [{ role: 'user' as const, content: FIRST_MESSAGE_TRIGGER }, ...transcript]
  const reply = await chat(cfg, system, messages)

  const done = reply.includes('[INTERVIEW_COMPLETE]')
  const cleaned = reply.replace('[INTERVIEW_COMPLETE]', '').trim()
  transcript.push({ role: 'assistant', content: cleaned })
  db.saveTranscript(id, transcript)
  return c.json({ message: cleaned, done })
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
  for (const w of report.weaknesses ?? []) db.addWeakness(profile.id, w, id)
  return c.json(report)
})

api.get('/interviews', (c) =>
  c.json(
    listSummaries(),
  ),
)

function listSummaries() {
  return db.listInterviews().map((i) => ({
    id: i.id,
    mode: i.mode,
    kind: i.kind,
    status: i.status,
    created_at: i.created_at,
    turns: i.transcript.length,
    overall_score: i.report?.overall_score ?? null,
    level_estimate: i.report?.level_estimate ?? null,
  }))
}

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
  const { status } = await c.req.json<{ status: 'open' | 'improving' | 'resolved' }>()
  if (!['open', 'improving', 'resolved'].includes(status)) throw new HttpError(400, 'invalid status')
  db.setWeaknessStatus(Number(c.req.param('id')), status)
  return c.json({ ok: true })
})
