// Admin-curated model catalog (R13: providers + encrypted keys + prices) and
// per-feature model routing (R35 / D23).
import { and, desc, eq } from 'drizzle-orm'
import { type AppConfig, type Provider } from '../config.js'
import { decryptSecret, encryptSecret } from '../crypto.js'
import * as t from '../schema.js'
import { db } from './client.js'

export interface ModelOption {
  id: number
  label: string
  provider: string
  model: string
  base_url: string | null // OpenAI-compatible custom endpoint (D19, Arvan)
  enabled: boolean
  is_default: boolean
  price_in: number // USD per 1M input tokens
  price_out: number // USD per 1M output tokens
  has_key: boolean
  capability_tier: string | null // D3: probed once when the model is added
}

// ── model catalog (admin-curated providers + keys) ───────────────────

type ModelRow = typeof t.models.$inferSelect

function toModel(r: ModelRow): ModelOption {
  return {
    id: r.id,
    label: r.label,
    provider: r.provider,
    model: r.model,
    base_url: r.baseUrl,
    enabled: r.enabled,
    is_default: r.isDefault,
    price_in: r.priceIn,
    price_out: r.priceOut,
    has_key: Boolean(r.apiKeyEnc),
    capability_tier: r.capabilityTier,
  }
}

/** Store a curated model's probed capability tier (D3). */
export async function setModelCapabilityTier(id: number, tier: string): Promise<void> {
  await db.update(t.models).set({ capabilityTier: tier }).where(eq(t.models.id, id))
}

export async function listModels(enabledOnly = false): Promise<ModelOption[]> {
  const base = db.select().from(t.models)
  const rows = await (enabledOnly ? base.where(eq(t.models.enabled, true)) : base).orderBy(
    desc(t.models.isDefault),
    t.models.id,
  )
  return rows.map(toModel)
}

export async function getModel(id: number): Promise<ModelOption | null> {
  const [row] = await db.select().from(t.models).where(eq(t.models.id, id))
  return row ? toModel(row) : null
}

/** The enabled default model — powers the free level-check for free-intro users (D11). */
export async function defaultModel(): Promise<ModelOption | null> {
  const [row] = await db
    .select()
    .from(t.models)
    .where(and(eq(t.models.enabled, true), eq(t.models.isDefault, true)))
    .limit(1)
  return row ? toModel(row) : null
}

// ── per-feature model routing (R35 / D23) ───────────────────────────

/** The model_id an admin assigned to a feature, if any and still enabled; else null (→ default). */
export async function assignedFeatureModel(featureKey: string): Promise<number | null> {
  const [row] = await db
    .select({ modelId: t.featureModels.modelId })
    .from(t.featureModels)
    .where(eq(t.featureModels.featureKey, featureKey))
  if (row?.modelId == null) return null
  const model = await getModel(row.modelId)
  return model?.enabled ? model.id : null
}

/** A feature's routing row for the admin UI: assigned model + kill switch (RF-9). */
export interface FeatureAssignment {
  model_id: number | null
  disabled: boolean
}

/** Whether an admin flipped this feature's kill switch (RF-9). Missing row = enabled. */
export async function featureDisabled(featureKey: string): Promise<boolean> {
  const [row] = await db
    .select({ disabled: t.featureModels.disabled })
    .from(t.featureModels)
    .where(eq(t.featureModels.featureKey, featureKey))
  return row?.disabled ?? false
}

/** Every feature's current assignment (raw model_id + kill switch) for the admin UI. */
export async function listFeatureModels(): Promise<Record<string, FeatureAssignment>> {
  const rows = await db.select().from(t.featureModels)
  const map: Record<string, FeatureAssignment> = {}
  for (const r of rows) map[r.featureKey] = { model_id: r.modelId, disabled: r.disabled }
  return map
}

/** Assign the model powering a feature (null → global default) and/or its kill switch. Upserts. */
export async function setFeatureModel(
  featureKey: string,
  modelId: number | null,
  disabled = false,
): Promise<void> {
  await db
    .insert(t.featureModels)
    .values({ featureKey, modelId, disabled, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: t.featureModels.featureKey,
      set: { modelId, disabled, updatedAt: new Date().toISOString() },
    })
}

/** Resolve a catalog model into a usable AppConfig (decrypts the host key). */
export async function modelConfig(id: number): Promise<{ cfg: AppConfig; option: ModelOption } | null> {
  const [row] = await db.select().from(t.models).where(eq(t.models.id, id))
  if (!row) return null
  const option = toModel(row)
  const apiKey = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : ''
  return {
    option,
    cfg: {
      provider: option.provider as Provider,
      apiKey,
      model: option.model,
      baseUrl: option.base_url ?? undefined,
    },
  }
}

export async function createModel(m: {
  label: string
  provider: string
  model: string
  base_url?: string | null
  apiKey: string
  enabled: boolean
  is_default: boolean
  price_in: number
  price_out: number
}): Promise<ModelOption> {
  if (m.is_default) await db.update(t.models).set({ isDefault: false })
  const [row] = await db
    .insert(t.models)
    .values({
      label: m.label,
      provider: m.provider,
      model: m.model,
      baseUrl: m.base_url ?? null,
      apiKeyEnc: m.apiKey ? encryptSecret(m.apiKey) : null,
      enabled: m.enabled,
      isDefault: m.is_default,
      priceIn: m.price_in,
      priceOut: m.price_out,
    })
    .returning()
  return toModel(row!)
}

export async function updateModel(
  id: number,
  patch: Partial<{
    label: string
    base_url: string | null
    enabled: boolean
    is_default: boolean
    price_in: number
    price_out: number
    apiKey: string // '' leaves the existing key untouched
  }>,
): Promise<ModelOption | null> {
  const [current] = await db.select().from(t.models).where(eq(t.models.id, id))
  if (!current) return null
  if (patch.is_default) await db.update(t.models).set({ isDefault: false })
  await db
    .update(t.models)
    .set({
      label: patch.label ?? current.label,
      baseUrl: patch.base_url !== undefined ? patch.base_url : current.baseUrl,
      enabled: patch.enabled ?? current.enabled,
      isDefault: patch.is_default ?? current.isDefault,
      priceIn: patch.price_in ?? current.priceIn,
      priceOut: patch.price_out ?? current.priceOut,
      apiKeyEnc: patch.apiKey ? encryptSecret(patch.apiKey) : current.apiKeyEnc,
    })
    .where(eq(t.models.id, id))
  return getModel(id)
}

export async function deleteModel(id: number): Promise<void> {
  await db.delete(t.models).where(eq(t.models.id, id))
  await db.update(t.users).set({ modelId: null }).where(eq(t.users.modelId, id))
}
