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
export function requireUser(c: Context): db.User {
  if (!isHosted) {
    const local = db.getUser(LOCAL_USER_ID)
    if (!local) throw new HttpError(500, 'local user missing — database not initialized')
    return local
  }
  const token = getCookie(c, SESSION_COOKIE)
  const user = token ? db.userForSession(token) : null
  if (!user) throw new HttpError(401, 'sign in required')
  return user
}

/** The current user if authenticated, else null (never throws). */
export function currentUser(c: Context): db.User | null {
  try {
    return requireUser(c)
  } catch {
    return null
  }
}

export function startSession(c: Context, userId: number): void {
  const token = randomToken(32)
  db.createSession(userId, token, SESSION_TTL_DAYS)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

export function endSession(c: Context): void {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) db.deleteSession(token)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
