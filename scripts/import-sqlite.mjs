// One-time migration: copy rows from the legacy node:sqlite store
// (~/.senior-bro/data.db) into Postgres (Phase 11 / D9). Safe to re-run —
// rows are inserted with their original ids and ON CONFLICT DO NOTHING.
//
//   node scripts/import-sqlite.mjs            # → DATABASE_URL (or the default dev DB)
//   DATABASE_URL=postgres://… node scripts/import-sqlite.mjs
//
// The encrypted api_key_enc blob is copied verbatim; it still decrypts because
// local mode reuses the same ~/.senior-bro/secret.key.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Client } from 'pg'

const SQLITE_PATH = path.join(os.homedir(), '.senior-bro', 'data.db')
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://senior:senior@localhost:5433/senior_bro'

if (!fs.existsSync(SQLITE_PATH)) {
  console.log(`no legacy DB at ${SQLITE_PATH} — nothing to import`)
  process.exit(0)
}

const lite = new DatabaseSync(SQLITE_PATH)
const pg = new Client({ connectionString: DATABASE_URL })
await pg.connect()

const has = (table) => {
  try {
    lite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()
    return true
  } catch {
    return false
  }
}
const rows = (table) => (has(table) ? lite.prepare(`SELECT * FROM ${table}`).all() : [])
const col = (r, name, fallback = null) => (name in r ? r[name] : fallback)

let imported = 0
const ins = async (sql, values) => {
  const res = await pg.query(sql, values)
  imported += res.rowCount ?? 0
}

// users: bring the local user's provider/model/encrypted key onto the seeded row.
for (const u of rows('users')) {
  await ins(
    `INSERT INTO users (id, email, role, provider, model, api_key_enc)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       provider = EXCLUDED.provider, model = EXCLUDED.model, api_key_enc = EXCLUDED.api_key_enc`,
    [
      u.id,
      col(u, 'email'),
      col(u, 'role', 'user'),
      col(u, 'provider'),
      col(u, 'model'),
      col(u, 'api_key_enc'),
    ],
  )
}

for (const p of rows('profiles')) {
  await ins(
    `INSERT INTO profiles (id, user_id, role, company, skill_pack, technologies, years_experience, notes, level, level_summary, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
    [
      p.id,
      col(p, 'user_id', 1),
      p.role,
      col(p, 'company'),
      col(p, 'skill_pack'),
      col(p, 'technologies', '[]'),
      col(p, 'years_experience', 0),
      col(p, 'notes'),
      col(p, 'level'),
      col(p, 'level_summary'),
      col(p, 'created_at'),
    ],
  )
}

for (const c of rows('calibrations')) {
  await ins(
    `INSERT INTO calibrations (id, profile_id, questions, result, created_at)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [c.id, c.profile_id, c.questions, col(c, 'result'), col(c, 'created_at')],
  )
}

for (const i of rows('interviews')) {
  await ins(
    `INSERT INTO interviews (id, profile_id, mode, kind, status, transcript, report, created_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
    [
      i.id,
      i.profile_id,
      col(i, 'mode', 'text'),
      col(i, 'kind', 'full'),
      col(i, 'status', 'finished'),
      col(i, 'transcript', '[]'),
      col(i, 'report'),
      col(i, 'created_at'),
      col(i, 'finished_at'),
    ],
  )
}

for (const w of rows('weaknesses')) {
  await ins(
    `INSERT INTO weaknesses (id, profile_id, title, detail, fix, status, source_interview_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [
      w.id,
      w.profile_id,
      w.title,
      w.detail,
      col(w, 'fix', ''),
      col(w, 'status', 'open'),
      col(w, 'source_interview_id'),
      col(w, 'created_at'),
    ],
  )
}

// Advance serial sequences past the imported ids.
for (const tbl of ['users', 'profiles', 'calibrations', 'interviews', 'weaknesses']) {
  await pg.query(
    `SELECT setval(pg_get_serial_sequence('${tbl}','id'), GREATEST((SELECT MAX(id) FROM ${tbl}), 1))`,
  )
}

await pg.end()
lite.close()
console.log(`imported ${imported} rows from ${SQLITE_PATH} → ${new URL(DATABASE_URL).pathname.slice(1)}`)
