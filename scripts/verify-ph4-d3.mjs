// Phase 4 D3 verification (hosted mode, mock provider): capability tiers.
// Proves the probe-once-and-store mechanism + name classification over HTTP:
//   - an admin adds mock models named like fast / standard / deep families → each gets the right
//     capability_tier back (probed on create, surfaced in /api/admin/models);
//   - a BYOK user's model is probed on /config and reported by /api/config + /api/usage.
// Boots its own server against the running Postgres. Usage: npm run build && node scripts/verify-ph4-d3.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4798
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ph4d3.test',
  },
  stdio: 'inherit',
})

const BASE = `http://localhost:${PORT}`
function cookieFrom(res) {
  const m = /sb_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')
  return m ? `sb_session=${m[1]}` : null
}
async function call(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json, setCookie: cookieFrom(res) }
}
async function signIn(email) {
  const req = await call('POST', '/api/auth/request', { email })
  const token = new URL(req.json.link).searchParams.get('magic')
  const verify = await call('POST', '/api/auth/verify', { token })
  if (!verify.setCookie) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(verify.json)}`)
  return { cookie: verify.setCookie }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}
const uniq = randomBytes(3).toString('hex')

async function addModel(cookie, label, model, is_default = false) {
  return call(
    'POST',
    '/api/admin/models',
    { label, provider: 'mock', model, enabled: true, is_default, price_in: 0, price_out: 0 },
    cookie,
  )
}

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@ph4d3.test')

  // Probe-on-create classifies each mock model by its name; the probe (mock returns valid JSON)
  // never downgrades a capable name.
  const fast = await addModel(admin.cookie, 'Fast', 'claude-haiku-4-5', true)
  const std = await addModel(admin.cookie, 'Standard', 'claude-sonnet-5')
  const deep = await addModel(admin.cookie, 'Deep', 'claude-opus-4-8')
  assert(
    fast.json.capability_tier === 'fast',
    `haiku-named model probed as fast (${fast.json.capability_tier})`,
  )
  assert(
    std.json.capability_tier === 'standard',
    `sonnet-named model probed as standard (${std.json.capability_tier})`,
  )
  assert(
    deep.json.capability_tier === 'deep',
    `opus-named model probed as deep (${deep.json.capability_tier})`,
  )

  // Tiers persist and are surfaced in the admin catalog.
  const models = await call('GET', '/api/admin/models', undefined, admin.cookie)
  const byId = Object.fromEntries(models.json.map((m) => [m.id, m.capability_tier]))
  assert(byId[fast.json.id] === 'fast', 'catalog keeps the fast tier')
  assert(byId[deep.json.id] === 'deep', 'catalog keeps the deep tier')

  // BYOK: setting a personal key probes + stores the user's tier, reported by /config + /usage.
  const user = await signIn(`u-${uniq}@ph4d3.test`)
  const saved = await call(
    'POST',
    '/api/config',
    { provider: 'mock', apiKey: 'byok-secret', model: 'gpt-4o-mini' },
    user.cookie,
  )
  assert(
    saved.json.capability_tier === 'fast',
    `BYOK gpt-4o-mini probed as fast (${saved.json.capability_tier})`,
  )
  const cfg = await call('GET', '/api/config', undefined, user.cookie)
  assert(cfg.json.capability_tier === 'fast', '/config reports the BYOK tier')
  const usage = await call('GET', '/api/usage', undefined, user.cookie)
  assert(usage.json.capability_tier === 'fast', '/usage reports the effective tier')

  console.log('\n✅ Phase 4 D3 (capability tiers: probe + classify + persist + expose) verified\n')
} catch (err) {
  console.error('\n❌ Phase 4 D3 verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
