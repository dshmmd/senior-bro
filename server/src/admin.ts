import type { Context } from 'hono'
import { requireUser } from './auth.js'
import { HttpError } from './http.js'
import type { User } from './db.js'

/**
 * Admins are designated two ways:
 * - local mode: the implicit owner is seeded with role `admin`.
 * - hosted mode: any email listed in `SENIORBRO_ADMIN_EMAILS` (comma-separated)
 *   is promoted to `admin` when they sign in.
 */
function adminEmails(): string[] {
  return (process.env.SENIORBRO_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string | null): boolean {
  return email !== null && adminEmails().includes(email.toLowerCase())
}

export async function requireAdmin(c: Context): Promise<User> {
  const user = await requireUser(c)
  if (user.role !== 'admin') throw new HttpError(403, 'admin access required')
  return user
}
