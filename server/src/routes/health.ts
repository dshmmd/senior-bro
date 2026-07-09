// Health/readiness + per-user provider config (BYOK/CLI) routes.
import type { Hono } from 'hono'
import { z } from 'zod'
import { DEFAULT_MODELS, isCliProvider, type AppConfig } from '../config.js'
import { currentUser, requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import { isHosted, MODE } from '../mode.js'
import * as db from '../db.js'
import { validateKey } from '../providers.js'
import { classifyByName, probeTier } from '../capability.js'
import { FREE_IMPRESSION_LIMIT, resolveTier } from '../services/entitlement.js'
import { parseBody } from './shared.js'

const configSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'claude-cli', 'codex-cli', 'mock']),
    apiKey: z.string().max(400).optional(),
    model: z.string().max(120).optional(),
  })
  .refine((v) => isCliProvider(v.provider) || (v.apiKey?.trim().length ?? 0) >= 4, {
    message: 'API key is required for this provider',
    path: ['apiKey'],
  })
  // CLI subscription providers run the user's local login — only valid in local
  // mode (D8). A hosted server must never try to proxy a customer's CLI.
  .refine((v) => !isHosted || !isCliProvider(v.provider), {
    message: 'subscription/CLI providers are not available on the hosted service — use an API key',
    path: ['provider'],
  })

export function registerHealthRoutes(api: Hono): void {
  api.get('/health', async (c) => {
    const user = await currentUser(c)
    const configured = user ? (await db.getUserConfig(user.id)) !== null : false
    const hasModel = user ? user.model_id !== null : false
    // Can this user actually start a (paid) interview right now? This is the readiness signal the
    // client routes on — crucially it counts a *selected host model*, not just the user's own key.
    // (The prior gate only looked at `configured`, so picking a curated model looked like "nothing
    // configured" and the app bounced the user back to setup.)
    let creditLeft: number | null = null
    let impressionsUsed = 0
    let interviewReady = !isHosted // local mode is single-owner & unrestricted
    if (user && isHosted) {
      const tokensUsed = await db.tokensUsed(user.id)
      creditLeft = user.token_quota !== null ? Math.max(0, user.token_quota - tokensUsed) : null
      impressionsUsed = await db.firstImpressionCount(user.id)
      if (user.role === 'admin') {
        // Staff run un-metered on the platform models — ready as long as one exists to run on.
        interviewReady = hasModel || configured || (await db.defaultModel()) !== null
      } else {
        interviewReady =
          user.plan === 'byok' || user.plan === 'local'
            ? configured || hasModel // own key / local CLI: never metered, always ready
            : hasModel && (creditLeft ?? 0) > 0 // host plan: needs a chosen model + remaining credit
      }
    } else if (user) {
      interviewReady = configured || hasModel
    }
    return c.json({
      ok: true,
      mode: MODE,
      authed: user !== null,
      user: user ? { email: user.email, role: user.role } : null,
      plan: user?.plan ?? null,
      configured,
      has_model: hasModel,
      credit_left: creditLeft,
      first_impressions_used: impressionsUsed,
      first_impressions_limit: FREE_IMPRESSION_LIMIT,
      interview_ready: interviewReady,
    })
  })

  api.get('/config', async (c) => {
    const user = await requireUser(c)
    const cfg = await db.getUserConfig(user.id)
    return c.json(
      cfg
        ? {
            provider: cfg.provider,
            model: cfg.model,
            hasKey: true,
            // D3: the probed tier, or a name-based fallback so the UI always shows something.
            capability_tier: resolveTier(user.capability_tier, cfg.model),
          }
        : { hasKey: false },
    )
  })

  api.post('/config', async (c) => {
    const user = await requireUser(c)
    const body = await parseBody(c, configSchema)
    const cfg: AppConfig = {
      provider: body.provider,
      apiKey: body.apiKey?.trim() ?? '',
      model: body.model?.trim() ?? DEFAULT_MODELS[body.provider],
    }
    const check = await validateKey(cfg)
    if (!check.ok) {
      const what = isCliProvider(cfg.provider) ? 'CLI check' : 'API key validation'
      throw new HttpError(400, `${what} failed: ${check.error ?? 'unknown'}`)
    }
    await db.setUserConfig(user.id, cfg)
    // Bringing your own key is the free 'byok' plan (D11). Local owner stays 'local'.
    if (isHosted) await db.setUserPlan(user.id, 'byok')
    // Probe the model's capability tier once (D3) so budgets + prompt guidance match this key.
    // Best-effort — a probe failure just leaves the name-based classification to resolve at call time.
    const tier = await probeTier(cfg).catch(() => classifyByName(cfg.model))
    await db.setUserCapabilityTier(user.id, tier).catch(() => undefined)
    return c.json({ ok: true, provider: cfg.provider, model: cfg.model, capability_tier: tier })
  })
}
