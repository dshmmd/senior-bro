// Admin console routes (R13/R17/R14/R35): model & key catalog, per-feature routing,
// users/quotas, invite codes, versioned prompts, company-pack review queue.
import type { PromptCatalogEntry } from '@senior-bro/shared'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../admin.js'
import { randomToken } from '../crypto.js'
import { HttpError } from '../http.js'
import * as db from '../db.js'
import { validateKey } from '../providers.js'
import { FEATURES, isFeatureKey } from '../features.js'
import { classifyByName, probeTier } from '../capability.js'
import { PROMPT_SEEDS } from '../prompts.js'
import { requireCall } from '../services/entitlement.js'
import { draftPack } from '../services/pack-generator.js'
import { parseBody } from './shared.js'

const modelCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    provider: z.enum(['anthropic', 'openai', 'arvan', 'mock']),
    model: z.string().trim().min(1).max(120),
    // Arvan (D19): the per-model gateway URL up to `/v1` — required for that provider.
    base_url: z.string().trim().url().max(500).optional(),
    apiKey: z.string().max(400).optional(),
    enabled: z.boolean().default(true),
    is_default: z.boolean().default(false),
    // Price per 1M tokens in the DEPLOY'S currency (USD, Toman, …) — hence the loose cap.
    price_in: z.number().min(0).max(100_000_000).default(0),
    price_out: z.number().min(0).max(100_000_000).default(0),
  })
  .refine((v) => v.provider !== 'arvan' || (v.base_url?.length ?? 0) > 0, {
    message: 'Arvan models need a gateway base URL',
    path: ['base_url'],
  })

const modelUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  base_url: z.string().trim().url().max(500).optional(),
  apiKey: z.string().max(400).optional(),
  enabled: z.boolean().optional(),
  is_default: z.boolean().optional(),
  price_in: z.number().min(0).max(100_000_000).optional(),
  price_out: z.number().min(0).max(100_000_000).optional(),
})

// null clears a feature's assignment (→ global default). (R35 / D23)
// Partial: omitted fields keep their current value. `disabled` = the RF-9 kill switch.
const featureModelSchema = z.object({
  model_id: z.number().int().positive().nullable().optional(),
  disabled: z.boolean().optional(),
})
const quotaSchema = z.object({ token_quota: z.number().int().min(0).nullable() })
const suspendSchema = z.object({ suspended: z.boolean() })

const inviteCreateSchema = z.object({
  token_credit: z.number().int().min(1).max(1_000_000_000),
  note: z.string().trim().max(200).optional(),
  expires_in_days: z.number().int().min(1).max(365).nullable().default(null),
})

const promptKeys = PROMPT_SEEDS.map((s) => s.key) as [string, ...string[]]
const promptVersionSchema = z.object({ body: z.string().trim().min(1).max(20000) })
const promptActivateSchema = z.object({ version: z.number().int().positive() })

const packUpdateSchema = z.object({
  company: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(500).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  roles: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  status: z.enum(['published', 'draft', 'archived']).optional(),
})

/** Validate the `:key` path param against the known prompt catalogue (404 if unknown). */
function promptKeyOf(c: Context): (typeof promptKeys)[number] {
  const key = c.req.param('key') ?? ''
  if (!(promptKeys as readonly string[]).includes(key)) throw new HttpError(404, 'unknown prompt key')
  return key
}

/** Best-effort admin audit entry (RF-9) — a log failure must never fail the admin action. */
function audit(admin: db.User, action: string, detail: string): void {
  void db
    .recordAdminEvent({ adminId: admin.id, adminEmail: admin.email, action, detail })
    .catch((err: unknown) =>
      console.error(JSON.stringify({ level: 'warn', msg: 'audit failed', err: String(err) })),
    )
}

export function registerAdminRoutes(api: Hono): void {
  // ── model/key management ────────────────────────────────────────────

  api.get('/admin/models', async (c) => {
    await requireAdmin(c)
    return c.json(await db.listModels(false))
  })

  api.post('/admin/models', async (c) => {
    const admin = await requireAdmin(c)
    const body = await parseBody(c, modelCreateSchema)
    // Validate the key works before saving (mock needs none).
    if (body.provider !== 'mock') {
      const check = await validateKey({
        provider: body.provider,
        apiKey: body.apiKey?.trim() ?? '',
        model: body.model,
        baseUrl: body.base_url?.trim(),
      })
      if (!check.ok) throw new HttpError(400, `key validation failed: ${check.error ?? 'unknown'}`)
    }
    const created = await db.createModel({
      label: body.label,
      provider: body.provider,
      model: body.model,
      base_url: body.base_url?.trim() ?? null,
      apiKey: body.apiKey?.trim() ?? '',
      enabled: body.enabled,
      is_default: body.is_default,
      price_in: body.price_in,
      price_out: body.price_out,
    })
    // Probe the model's capability tier once (D3), best-effort. Falls back to a name classification.
    const resolved = await db.modelConfig(created.id)
    const tier = resolved
      ? await probeTier(resolved.cfg).catch(() => classifyByName(created.model))
      : classifyByName(created.model)
    await db.setModelCapabilityTier(created.id, tier).catch(() => undefined)
    audit(admin, 'model.create', `#${created.id} ${body.label} (${body.provider}/${body.model})`)
    return c.json({ ...created, capability_tier: tier })
  })

  api.patch('/admin/models/:id', async (c) => {
    const admin = await requireAdmin(c)
    const id = Number(c.req.param('id'))
    const body = await parseBody(c, modelUpdateSchema)
    const updated = await db.updateModel(id, {
      label: body.label,
      base_url: body.base_url?.trim(),
      enabled: body.enabled,
      is_default: body.is_default,
      price_in: body.price_in,
      price_out: body.price_out,
      apiKey: body.apiKey?.trim(),
    })
    if (!updated) throw new HttpError(404, 'model not found')
    audit(
      admin,
      'model.update',
      `#${id} ${Object.keys(body)
        .map((k) => (k === 'apiKey' ? 'apiKey(rotated)' : k))
        .join(',')}`,
    )
    return c.json(updated)
  })

  api.delete('/admin/models/:id', async (c) => {
    const admin = await requireAdmin(c)
    const id = Number(c.req.param('id'))
    await db.deleteModel(id)
    audit(admin, 'model.delete', `#${id}`)
    return c.json({ ok: true })
  })

  // ── per-feature model routing (R35 / D23) ───────────────────────────

  // The feature catalogue + each feature's current assignment.
  api.get('/admin/feature-models', async (c) => {
    await requireAdmin(c)
    return c.json({ features: FEATURES, assignments: await db.listFeatureModels() })
  })

  // Assign a model to a feature (or clear it with model_id: null → falls back to the global default).
  api.put('/admin/feature-models/:key', async (c) => {
    const admin = await requireAdmin(c)
    const key = c.req.param('key')
    if (!isFeatureKey(key)) throw new HttpError(404, 'unknown feature key')
    const body = await parseBody(c, featureModelSchema)
    const current = (await db.listFeatureModels())[key] ?? { model_id: null, disabled: false }
    const modelId = body.model_id !== undefined ? body.model_id : current.model_id
    const disabled = body.disabled ?? current.disabled
    if (modelId !== null && !(await db.getModel(modelId))) throw new HttpError(404, 'model not found')
    await db.setFeatureModel(key, modelId, disabled)
    audit(admin, 'feature.route', `${key} → model ${modelId ?? 'default'}${disabled ? ' (KILLED)' : ''}`)
    return c.json({ ok: true })
  })

  // ── users & quotas ──────────────────────────────────────────────────

  api.get('/admin/users', async (c) => {
    await requireAdmin(c)
    const users = await db.listUsers()
    const rows = await Promise.all(
      users.map(async (u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        plan: u.plan,
        suspended: u.suspended,
        model_id: u.model_id,
        token_quota: u.token_quota,
        ...(await db.usageSummary(u.id)),
      })),
    )
    return c.json(rows)
  })

  api.post('/admin/users/:id/quota', async (c) => {
    const admin = await requireAdmin(c)
    const id = Number(c.req.param('id'))
    const { token_quota } = await parseBody(c, quotaSchema)
    await db.setUserQuota(id, token_quota)
    audit(admin, 'user.quota', `#${id} → ${token_quota ?? 'unlimited'}`)
    return c.json({ ok: true })
  })

  // Suspend / un-suspend an account (RF-9). Suspended users fail every request with 403.
  api.post('/admin/users/:id/suspend', async (c) => {
    const admin = await requireAdmin(c)
    const id = Number(c.req.param('id'))
    if (id === admin.id) throw new HttpError(400, "you can't suspend your own account")
    const { suspended } = await parseBody(c, suspendSchema)
    if (!(await db.getUser(id))) throw new HttpError(404, 'user not found')
    await db.setUserSuspended(id, suspended)
    audit(admin, suspended ? 'user.suspend' : 'user.unsuspend', `#${id}`)
    return c.json({ ok: true })
  })

  // Per-event usage audit (RF-9 / R25): who/when/model/tokens/cost, newest first.
  api.get('/admin/usage-events', async (c) => {
    await requireAdmin(c)
    const userIdRaw = c.req.query('user_id')
    const userId = userIdRaw ? Number(userIdRaw) : undefined
    const limit = Math.min(Number(c.req.query('limit') ?? 200) || 200, 1000)
    return c.json(await db.listUsageEvents(userId, limit))
  })

  // Admin-action audit log (RF-9 / R26).
  api.get('/admin/events', async (c) => {
    await requireAdmin(c)
    const limit = Math.min(Number(c.req.query('limit') ?? 200) || 200, 1000)
    return c.json(await db.listAdminEvents(limit))
  })

  // ── invite codes (token-credit codes for testers/partners) ──────────

  api.get('/admin/invites', async (c) => {
    await requireAdmin(c)
    return c.json(await db.listInviteCodes())
  })

  api.post('/admin/invites', async (c) => {
    const admin = await requireAdmin(c)
    const body = await parseBody(c, inviteCreateSchema)
    const code = `SB-${randomToken(4).toUpperCase()}`
    const created = await db.createInviteCode({
      code,
      tokenCredit: body.token_credit,
      note: body.note ?? null,
      expiresInDays: body.expires_in_days,
    })
    audit(admin, 'invite.mint', `${code} (${body.token_credit} tokens)`)
    return c.json(created)
  })

  api.post('/admin/invites/:code/revoke', async (c) => {
    const admin = await requireAdmin(c)
    const code = c.req.param('code')
    await db.revokeInviteCode(code)
    audit(admin, 'invite.revoke', code)
    return c.json({ ok: true })
  })

  // ── versioned system prompts (D12 — edit/version/rollback) ──────────

  /** Prompt catalogue: each key with its metadata + active version + total versions. */
  api.get('/admin/prompts', async (c) => {
    await requireAdmin(c)
    const rows = await Promise.all(
      PROMPT_SEEDS.map(async (s) => {
        const versions = await db.listPromptVersions(s.key)
        return {
          key: s.key,
          label: s.label,
          description: s.description,
          placeholders: s.placeholders,
          guardrailed: s.guardrailed,
          active_version: versions.find((v) => v.active)?.version ?? null,
          version_count: versions.length,
        }
      }),
    )
    return c.json(rows satisfies PromptCatalogEntry[])
  })

  /** All saved versions of one prompt key (newest first), for the editor + history. */
  api.get('/admin/prompts/:key', async (c) => {
    await requireAdmin(c)
    const key = promptKeyOf(c)
    return c.json(await db.listPromptVersions(key))
  })

  /** Save an edited body as a new active version. */
  api.post('/admin/prompts/:key', async (c) => {
    const admin = await requireAdmin(c)
    const key = promptKeyOf(c)
    const { body } = await parseBody(c, promptVersionSchema)
    const created = await db.createPromptVersion(key, body, admin.email ?? `user#${admin.id}`)
    audit(admin, 'prompt.version', `${key} v${created.version}`)
    return c.json(created)
  })

  /** Roll back / forward by re-activating an existing version. */
  api.post('/admin/prompts/:key/activate', async (c) => {
    const admin = await requireAdmin(c)
    const key = promptKeyOf(c)
    const { version } = await parseBody(c, promptActivateSchema)
    const ok = await db.activatePromptVersion(key, version)
    if (!ok) throw new HttpError(404, 'no such prompt version')
    audit(admin, 'prompt.activate', `${key} → v${version}`)
    return c.json({ ok: true })
  })

  // ── company packs review queue (D10 — edit/publish/regenerate) ──────

  api.get('/admin/packs', async (c) => {
    await requireAdmin(c)
    return c.json(await db.listAllPacks())
  })

  api.patch('/admin/packs/:id', async (c) => {
    const admin = await requireAdmin(c)
    const patch = await parseBody(c, packUpdateSchema)
    const updated = await db.updatePack(Number(c.req.param('id')), patch)
    if (!updated) throw new HttpError(404, 'pack not found')
    audit(admin, 'pack.update', `#${updated.id} ${updated.company} [${Object.keys(patch).join(',')}]`)
    return c.json(updated)
  })

  /** Re-draft a pack's body from scratch (e.g. when it's stale), keeping its slug/cache key. */
  api.post('/admin/packs/:id/regenerate', async (c) => {
    await requireAdmin(c)
    const { user, call } = await requireCall(c, 'pack', { feature: 'company.pack' })
    const pack = await db.getPack(Number(c.req.param('id')))
    if (!pack) throw new HttpError(404, 'pack not found')
    const role = pack.roles[0] ?? 'Engineer'
    const { draft, searched } = await draftPack(user, call, pack.company, role)
    const updated = await db.updatePack(pack.id, {
      summary: draft.summary?.trim() ?? pack.summary,
      body: draft.body,
      roles: Array.isArray(draft.roles) && draft.roles.length ? draft.roles : pack.roles,
      model: call.cfg.model,
      searched,
    })
    return c.json(updated)
  })

  api.delete('/admin/packs/:id', async (c) => {
    const admin = await requireAdmin(c)
    const id = Number(c.req.param('id'))
    await db.deletePack(id)
    audit(admin, 'pack.delete', `#${id}`)
    return c.json({ ok: true })
  })
}
