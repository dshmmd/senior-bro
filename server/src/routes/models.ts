// User-facing model catalog, selection + usage/billing readout.
import type { ModelOption, UsageInfo } from '@senior-bro/shared'
import type { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import { isHosted } from '../mode.js'
import * as db from '../db.js'
import { FREE_IMPRESSION_LIMIT, TOKENS_PER_INTERVIEW, resolveCall } from '../services/entitlement.js'
import { parseBody } from './shared.js'

const modelSelectSchema = z.object({ model_id: z.number().int().positive() })

export function registerModelRoutes(api: Hono): void {
  // Curated models the user may pick from (admin-enabled only; never exposes keys).
  api.get('/models', async (c) => {
    const user = await requireUser(c)
    return c.json({ models: await db.listModels(true), selected_model_id: user.model_id } satisfies {
      models: ModelOption[]
      selected_model_id: number | null
    })
  })

  // Pick an admin-curated model (host key + metered). Hosted mode only.
  api.post('/models/select', async (c) => {
    const user = await requireUser(c)
    const { model_id } = await parseBody(c, modelSelectSchema)
    const option = await db.getModel(model_id)
    if (!option?.enabled) throw new HttpError(404, 'model not available')
    await db.setUserModelChoice(user.id, model_id)
    // Choosing a curated host model is the paid 'host' plan (entitlement checked per call).
    if (isHosted) await db.setUserPlan(user.id, 'host')
    return c.json({ ok: true })
  })

  // The signed-in user's own usage, plan + remaining credit (D11 billing readout).
  api.get('/usage', async (c) => {
    const user = await requireUser(c)
    const tokensUsed = await db.tokensUsed(user.id)
    const impressionsUsed = await db.firstImpressionCount(user.id)
    // The effective capability tier of the model that would power this user's calls (D3), if any.
    const tier = await resolveCall(user)
      .then((call) => call.tier)
      .catch(() => null)
    return c.json({
      usage: await db.usageSummary(user.id),
      plan: user.plan,
      token_quota: user.token_quota,
      tokens_used: tokensUsed,
      credit_left: user.token_quota !== null ? Math.max(0, user.token_quota - tokensUsed) : null,
      // Free-tier "first impression" budget (R32) — replaces the old flat token budget.
      first_impressions_used: impressionsUsed,
      first_impressions_limit: FREE_IMPRESSION_LIMIT,
      capability_tier: tier,
      interview_estimate_tokens: TOKENS_PER_INTERVIEW,
    } satisfies UsageInfo)
  })
}
