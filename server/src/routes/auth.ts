// Auth routes (hosted mode: email magic-link, no passwords).
import type { Hono } from 'hono'
import { z } from 'zod'
import { currentUser, endSession, startSession } from '../auth.js'
import { isAdminEmail } from '../admin.js'
import { randomToken } from '../crypto.js'
import { HttpError } from '../http.js'
import { isHosted } from '../mode.js'
import { revealLinks, sendMagicLink } from '../mailer.js'
import * as db from '../db.js'
import { parseBody } from './shared.js'

const authRequestSchema = z.object({ email: z.string().trim().email().max(200) })
const authVerifySchema = z.object({ token: z.string().min(10).max(200) })

export function registerAuthRoutes(api: Hono): void {
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
}
