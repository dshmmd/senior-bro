// Shared DB connection state (RF-3 slice 2). `db` is a live binding assigned by
// `connect()` (called from init.ts) — every query module imports it from here.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as t from '../schema.js'

export let pool: Pool
export let db: NodePgDatabase<typeof t>

const DEFAULT_DB_URL = 'postgres://senior:senior@localhost:5433/senior_bro'

/** Open the pool + drizzle handle. Idempotent enough for our single boot path. */
export function connect(): void {
  pool = new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DB_URL })
  db = drizzle(pool, { schema: t })
}

/** ISO-ish timestamp `ms` from now, as a plain (no-TZ) string for timestamp columns. */
export function future(ms: number): string {
  return new Date(Date.now() + ms).toISOString().replace('T', ' ').replace('Z', '')
}
