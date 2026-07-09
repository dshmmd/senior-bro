// Server-side voice transcription (R30 / D20).
import type { Hono } from 'hono'
import { requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import { transcribe } from '../providers.js'
import { enforceEntitlement, resolveTranscribeCall } from '../services/entitlement.js'
import { meterUsage } from '../services/model-runner.js'

export function registerVoiceRoutes(api: Hono): void {
  // Whether server-side transcription is configured — lets the client silently fall back to
  // the browser's built-in dictation instead of erroring on every recording.
  api.get('/voice/available', async (c) => {
    await requireUser(c)
    return c.json({ available: (await resolveTranscribeCall()) !== null })
  })

  // Transcribe a recorded answer. Entitlement-gated like an interview turn (paid host credit /
  // BYOK / local — never covered by the free-intro onboarding budget, since it's used mid-interview).
  api.post('/voice/transcribe', async (c) => {
    const user = await requireUser(c)
    const call = await resolveTranscribeCall()
    if (!call) throw new HttpError(409, 'server-side transcription is not configured')
    await enforceEntitlement(user, call, 'interview')
    const form = await c.req.parseBody()
    const file = form.file
    if (!file || typeof file === 'string') throw new HttpError(400, 'missing audio file')
    const audio = new Uint8Array(await file.arrayBuffer())
    if (audio.length === 0) throw new HttpError(400, 'empty audio')
    const { text, usage } = await transcribe(
      call.cfg,
      audio,
      file.type || 'audio/webm',
      file.name || 'audio.webm',
    )
    await meterUsage(user, call, usage)
    return c.json({ text })
  })
}
