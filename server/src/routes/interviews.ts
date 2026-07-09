// Interview lifecycle: start (streamed opener), turns, finish + evaluation,
// history, resume/discard (D14). Domain-routed (R33) and tier-budgeted (D3).
import type { InterviewSummary } from '@senior-bro/shared'
import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import * as db from '../db.js'
import { extractJson, type ChatMessage } from '../providers.js'
import { TIERS } from '../capability.js'
import { domainDef } from '../domains.js'
import { FIRST_MESSAGE_TRIGGER, renderEvaluation } from '../prompts.js'
import { callForInterview, requireCall, resolveCall } from '../services/entitlement.js'
import { runModel } from '../services/model-runner.js'
import { distillUserModel, stripToken, systemFor } from '../services/interview-engine.js'
import { ownInterview, ownProfile, parseBody, wantsStream } from './shared.js'

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

export function registerInterviewRoutes(api: Hono): void {
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
    const system = await systemFor(interview, call.tier, body.weakness_id)
    const budget = TIERS[call.tier].interviewMax
    const messages: ChatMessage[] = [{ role: 'user', content: FIRST_MESSAGE_TRIGGER }]

    const persist = (opener: string) =>
      db.saveTranscript(interview.id, [{ role: 'assistant', content: opener }])

    if (!wantsStream(c)) {
      const opener = await runModel(user, call, system, messages, budget)
      await persist(opener)
      return c.json({ interview_id: interview.id, message: opener })
    }

    return streamSSE(c, async (stream) => {
      try {
        const opener = await runModel(user, call, system, messages, budget, (t) => {
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
    const system = await systemFor(interview, call.tier)
    const budget = TIERS[call.tier].interviewMax
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
      const reply = await runModel(user, call, system, messages, budget)
      return c.json(await persist(reply))
    }

    return streamSSE(c, async (stream) => {
      try {
        const reply = await runModel(user, call, system, messages, budget, (t) => {
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
      TIERS[call.tier].evalMax,
    )
    const report = extractJson<
      db.InterviewReport & { skill_evidence?: { skill: string; verdict: string; note?: string }[] }
    >(raw)
    await db.finishInterview(id, report)
    for (const w of report.weaknesses) await db.addWeakness(profile.id, w, id)
    // Evidence-gating (R23): flip claimed skills to demonstrated/weak based on shown evidence.
    if (Array.isArray(report.skill_evidence))
      await db.applySkillEvidence(profile.id, id, report.skill_evidence)
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
      })) satisfies InterviewSummary[],
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
}
