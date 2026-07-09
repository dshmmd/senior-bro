// RF-2 (REFACTOR.md) — integration suite, first slice.
// Runs every scripts/verify-*.mjs behavioral verification inside `node --test`
// against an ISOLATED database (senior_bro_itest), so the money/trust-critical
// coverage (entitlement, free tier, feature routing, isolation, domains, …)
// finally gates CI instead of living in one-off scripts.
//
// The scripts stay the source of truth for now; as each is ported into a focused
// test file under this directory, drop it from SCRIPTS and delete the script.
//
// Requirements: `npm run build` first (scripts boot server/dist), Postgres up.
// Scripts run SEQUENTIALLY — several share hardcoded ports (4795/4796) — and the
// DB is wiped between scripts so no run inherits another's models/users.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const ITEST_DATABASE_URL =
  process.env.ITEST_DATABASE_URL ?? 'postgres://senior:senior@localhost:5433/senior_bro_itest'

// Self-booting hosted-mode scripts: spawn with an isolated DATABASE_URL and assert exit 0.
const SCRIPTS = [
  'verify-ph23.mjs', // R32 free-impression tier + R36 delete profile + isolation
  'verify-ph24.mjs', // R33/R34 interview domains + per-domain progress
  'verify-ph31.mjs', // R31 CV-first onboarding (text + PDF)
  'verify-ph35.mjs', // R35 per-feature model routing (proven via metering)
  'verify-ph4.mjs', // Phase 4 personalization: events → distill → inject → read/correct/delete
  'verify-ph4-d3.mjs', // D3 capability tiers (budgets + MODEL NOTE)
  'verify-ph5.mjs', // Phase 5 résumé review / opportunities / target mode + gating
  'verify-ph7.mjs', // Phase 7 study plan + gating + weakness linkage
  'verify-model-readiness.mjs', // R39 /health.interview_ready counts a selected model
  'verify-admin-entitlement.mjs', // admins are staff (un-metered) + résumé error surface
  'verify-arvan.mjs', // D19 Arvan wire format + usage parsing (stub gateway, no DB)
]

async function ensureDatabase() {
  const url = new URL(ITEST_DATABASE_URL)
  const dbName = url.pathname.slice(1)
  const adminUrl = new URL(ITEST_DATABASE_URL)
  adminUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.end()
}

// Empty schema → the server re-migrates + re-seeds on boot (same trick as e2e/prepare.mjs).
async function wipeDatabase() {
  const c = new Client({ connectionString: ITEST_DATABASE_URL })
  await c.connect()
  await c.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  )
  await c.end()
}

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: ITEST_DATABASE_URL, ...env },
    })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('close', (code) => resolve({ code, out, proc }))
  })
}

await ensureDatabase()

for (const script of SCRIPTS) {
  test(script, { timeout: 120_000 }, async () => {
    await wipeDatabase()
    const { code, out } = await run('node', [path.join('scripts', script)])
    assert.equal(code, 0, `${script} failed (exit ${code}):\n${out}`)
  })
}

// verify-ph13 predates the self-boot pattern: it expects a hosted server already
// running at :4791, so boot one for it here.
test('verify-ph13.mjs (plans, gating & invite codes)', { timeout: 120_000 }, async () => {
  await wipeDatabase()
  const server = spawn('node', ['server/dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: ITEST_DATABASE_URL,
      PORT: '4791',
      SENIORBRO_MODE: 'hosted',
      SENIORBRO_SECRET: randomBytes(16).toString('hex'),
      SENIORBRO_ADMIN_EMAILS: 'admin@ph13.test',
    },
    stdio: 'ignore',
  })
  try {
    // Wait for the server to answer before running the script.
    let up = false
    for (let i = 0; i < 40 && !up; i++) {
      up = await fetch('http://localhost:4791/api/health')
        .then((r) => r.ok)
        .catch(() => false)
      if (!up) await new Promise((r) => setTimeout(r, 250))
    }
    assert.ok(up, 'hosted server for ph13 did not come up on :4791')
    const { code, out } = await run('node', ['scripts/verify-ph13.mjs'], {
      BASE: 'http://localhost:4791',
    })
    assert.equal(code, 0, `verify-ph13.mjs failed (exit ${code}):\n${out}`)
  } finally {
    server.kill()
  }
})
