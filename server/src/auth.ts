import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { randomToken } from './crypto.js'
import * as db from './db.js'
import { HttpError } from './http.js'
import { isHosted, LOCAL_USER_ID } from './mode.js'

const SESSION_COOKIE = 'sb_session'
const SESSION_TTL_DAYS = 30

/**
 * Resolve the user making this request.
 * - local mode: always the implicit owner (no auth).
 * - hosted mode: the user behind a valid session cookie, or 401.
 */
export async function requireUser(c: Context): Promise<db.User> {
  if (!isHosted) {
    const local = await db.getUser(LOCAL_USER_ID)
    if (!local) throw new HttpError(500, 'local user missing — database not initialized')
    return local
  }
  const token = getCookie(c, SESSION_COOKIE)
  const user = token ? await db.userForSession(token) : null
  if (!user) throw new HttpError(401, 'sign in required')
  // RF-9: a suspended account fails every authenticated request until an admin lifts it.
  if (user.suspended) throw new HttpError(403, 'this account is suspended — contact support')
  return user
}

/** The current user if authenticated, else null (never throws). */
export async function currentUser(c: Context): Promise<db.User | null> {
  try {
    return await requireUser(c)
  } catch {
    return null
  }
}

export async function startSession(c: Context, userId: number): Promise<void> {
  const token = randomToken(32)
  await db.createSession(userId, token, SESSION_TTL_DAYS)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

export async function endSession(c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await db.deleteSession(token)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
