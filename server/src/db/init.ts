// Boot: connect, apply migrations, seed (local owner, prompt seeds, pack seeds).
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { loadConfig } from '../config.js'
import { LOCAL_USER_ID } from '../mode.js'
import { PROMPT_SEEDS } from '../prompts.js'
import { loadSeedPacks, TIER_SEED_PACKS } from '../skills.js'
import * as t from '../schema.js'
import { connect, db } from './client.js'
import { getUser, getUserConfig, setUserConfig } from './users.js'
import { packSlug } from './packs.js'

/** Connect, apply pending migrations, seed the local owner + legacy config. */
export async function initDb(): Promise<void> {
  connect()
  const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))
  await migrate(db, { migrationsFolder })
  await seed()
}

async function seed(): Promise<void> {
  // Stable local owner (also the bootstrap admin); explicit id so local mode never auths.
  await db
    .insert(t.users)
    .values({ id: LOCAL_USER_ID, email: 'local@senior-bro', role: 'admin', plan: 'local' })
    .onConflictDoNothing()
  // Inserting an explicit id leaves the serial sequence behind — advance it past max(id).
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))`,
  )
  // Back-fill any pre-accounts profiles onto the local owner (no-op on a fresh DB).
  await db
    .update(t.profiles)
    .set({ userId: LOCAL_USER_ID })
    .where(sql`${t.profiles.userId} IS NULL`)
  // One-time import of the legacy ~/.senior-bro/config.json into the local user.
  const local = await getUser(LOCAL_USER_ID)
  if (local && (await getUserConfig(LOCAL_USER_ID)) === null) {
    const legacy = loadConfig()
    if (legacy) await setUserConfig(LOCAL_USER_ID, legacy)
  }
  await seedPrompts()
  await seedPacks()
}

/**
 * Seed the built-in packs into the DB once: the static `skills/*.md` companies (`source: 'seed'`)
 * and the tiered targets (`source: 'tier'`, stable `tier-N` slugs — R22). Both keyed by slug so
 * boot is idempotent and admins can edit/delete seeds without them reappearing on the next start.
 */
async function seedPacks(): Promise<void> {
  const existing = await db.select({ slug: t.companyPacks.slug }).from(t.companyPacks)
  const have = new Set(existing.map((r) => r.slug))
  const rows = [
    ...loadSeedPacks()
      .filter((p) => !have.has(packSlug(p.company)))
      .map((p) => ({
        slug: packSlug(p.company),
        company: p.company,
        roles: JSON.stringify(p.roles),
        summary: p.summary,
        body: p.body,
        status: 'published',
        source: 'seed',
      })),
    ...TIER_SEED_PACKS.filter((p) => !have.has(p.slug)).map((p) => ({
      slug: p.slug,
      company: p.company,
      roles: JSON.stringify(p.roles),
      summary: p.summary,
      body: p.body,
      status: 'published',
      source: 'tier',
    })),
  ]
  if (rows.length === 0) return
  await db.insert(t.companyPacks).values(rows)
}

/** Seed the default (version 1, author 'seed') body for any prompt key not yet in the DB (D12). */
async function seedPrompts(): Promise<void> {
  const existing = await db.selectDistinct({ key: t.prompts.promptKey }).from(t.prompts)
  const have = new Set(existing.map((r) => r.key))
  const missing = PROMPT_SEEDS.filter((s) => !have.has(s.key))
  if (missing.length === 0) return
  await db
    .insert(t.prompts)
    .values(
      missing.map((s) => ({ promptKey: s.key, version: 1, body: s.body, author: 'seed', active: true })),
    )
}
