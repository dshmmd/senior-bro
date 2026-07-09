// Admin-action audit log (RF-9 / R26): who did what, when — one row per admin mutation.
import { desc } from 'drizzle-orm'
import * as t from '../schema.js'
import { db } from './client.js'

export interface AdminEvent {
  id: number
  admin_id: number | null
  admin_email: string | null
  action: string
  detail: string
  created_at: string
}

export async function recordAdminEvent(e: {
  adminId: number
  adminEmail: string | null
  action: string
  detail?: string
}): Promise<void> {
  await db.insert(t.adminEvents).values({
    adminId: e.adminId,
    adminEmail: e.adminEmail,
    action: e.action,
    detail: e.detail ?? '',
  })
}

export async function listAdminEvents(limit = 200): Promise<AdminEvent[]> {
  const rows = await db.select().from(t.adminEvents).orderBy(desc(t.adminEvents.id)).limit(limit)
  return rows.map((r) => ({
    id: r.id,
    admin_id: r.adminId,
    admin_email: r.adminEmail,
    action: r.action,
    detail: r.detail,
    created_at: r.createdAt,
  }))
}
