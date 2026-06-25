// Runs BEFORE `playwright test` (see the "e2e" npm script). Playwright starts its
// webServer before globalSetup, so DB prep must happen here — otherwise the server
// boots against a test DB that doesn't exist yet. Isolates the e2e run:
//  - HOME → .e2e-home with a mock-provider config.json (imported into the local user)
//  - DATABASE_URL → a dedicated senior_bro_test DB, created if missing + wiped clean
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://senior:senior@localhost:5433/senior_bro_test'

// 1. Fresh isolated HOME with a mock-provider config.json.
const dir = path.resolve(__dirname, '../.e2e-home/.senior-bro')
fs.rmSync(path.dirname(dir), { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(
  path.join(dir, 'config.json'),
  JSON.stringify({ provider: 'mock', apiKey: 'mock-key', model: 'mock-1' }),
)

// 2. Ensure the test database exists.
const url = new URL(E2E_DATABASE_URL)
const dbName = url.pathname.slice(1)
const adminUrl = new URL(E2E_DATABASE_URL)
adminUrl.pathname = '/postgres'
const admin = new Client({ connectionString: adminUrl.toString() })
await admin.connect()
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`)
await admin.end()

// 3. Wipe it to an empty public schema (the server re-migrates on boot).
const test = new Client({ connectionString: E2E_DATABASE_URL })
await test.connect()
await test.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
await test.end()

console.log(`e2e prepared: ${dbName} wiped, mock config in .e2e-home`)
