// Profiles: manual + CV-first creation (R31), edit, multi-profile switching (R24),
// delete-with-history (R36), and calibration (the free level-check).
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { extractText } from 'unpdf'
import { requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import * as db from '../db.js'
import { extractJson } from '../providers.js'
import { renderCalibrationGenerate, renderCalibrationGrade, renderResumeParse } from '../prompts.js'
import { enforceEntitlement, requireCall, resolveCall } from '../services/entitlement.js'
import { runModel } from '../services/model-runner.js'
import { ownProfile, parseBody } from './shared.js'

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

export function registerProfileRoutes(api: Hono): void {
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

  // ── calibration (the free level-check) ──────────────────────────────

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
}
