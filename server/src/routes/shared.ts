// Shared HTTP helpers for the route modules (RF-3) — body parsing, streaming
// detection, and the cross-user isolation guards every by-id route uses.
import type { Context } from 'hono'
import { z } from 'zod'
import * as db from '../db.js'
import { HttpError } from '../http.js'

/** Throw 404 unless `profileId` belongs to `userId` (cross-user isolation guard). */
export async function ownProfile(userId: number, profileId: number): Promise<db.Profile> {
  const profile = await db.getProfile(profileId)
  if (profile?.user_id !== userId) throw new HttpError(404, 'profile not found')
  return profile
}

/** Throw 404 unless `interviewId` is owned (via its profile) by `userId`. */
export async function ownInterview(userId: number, interviewId: number): Promise<db.InterviewRow> {
  const interview = await db.getInterview(interviewId)
  if (!interview) throw new HttpError(404, 'interview not found')
  await ownProfile(userId, interview.profile_id)
  return interview
}

export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
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

export const wantsStream = (c: Context): boolean =>
  (c.req.header('accept') ?? '').includes('text/event-stream')
