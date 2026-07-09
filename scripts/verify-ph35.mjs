// R35 / D23 verification (hosted mode, mock provider): per-feature model routing.
// Proves the admin can assign a model per feature, the assignment round-trips + validates, and a
// routed feature actually uses the assigned model — shown by metering: a free-intro user's
// calibration runs free on the (price-0) default, but costs > 0 once calibration is routed to a
// priced model. Boots its own server. Usage: npm run build && node scripts/verify-ph35.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4794
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ph35.test',
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
const addModel = (cookie, label, extra) =>
  call(
    'POST',
    '/api/admin/models',
    { label, provider: 'mock', model: 'mock-1', enabled: true, price_in: 0, price_out: 0, ...extra },
    cookie,
  )

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@ph35.test')
  // Default model is free (price 0); the "Premium" model is expensive so routed usage shows a cost.
  const free = await addModel(admin.cookie, 'House (free)', { is_default: true })
  const premium = await addModel(admin.cookie, 'Premium', { price_in: 10000, price_out: 10000 })
  assert(free.status === 200 && premium.status === 200, 'admin created a free default + a priced model')

  const cat = await call('GET', '/api/admin/feature-models', undefined, admin.cookie)
  assert(
    Array.isArray(cat.json.features) && cat.json.features.some((f) => f.key === 'calibration'),
    'feature catalogue lists calibration (and friends)',
  )
  assert(
    cat.json.assignments.calibration?.model_id == null,
    'calibration starts unassigned (→ global default)',
  )

  const badKey = await call('PUT', '/api/admin/feature-models/nope', { model_id: null }, admin.cookie)
  assert(badKey.status === 404, 'unknown feature key is rejected (404)')
  const badModel = await call(
    'PUT',
    '/api/admin/feature-models/calibration',
    { model_id: 999999 },
    admin.cookie,
  )
  assert(badModel.status === 404, 'assigning a missing model is rejected (404)')

  // Baseline: a free-intro user's calibration runs on the free default → no cost.
  const u1 = await signIn(`a-${uniq}@ph35.test`)
  const p1 = await call('POST', '/api/profile', { role: 'Backend Engineer', technologies: ['Go'] }, u1.cookie)
  await call('POST', '/api/calibration/start', { profile_id: p1.json.id }, u1.cookie)
  const usage1 = await call('GET', '/api/usage', undefined, u1.cookie)
  assert(usage1.json.usage.cost_usd === 0, 'unrouted calibration runs on the free default (cost 0)')

  // Route calibration → the priced model; the assignment round-trips.
  const assign = await call(
    'PUT',
    '/api/admin/feature-models/calibration',
    { model_id: premium.json.id },
    admin.cookie,
  )
  assert(assign.status === 200, 'admin routed calibration → the priced model')
  const cat2 = await call('GET', '/api/admin/feature-models', undefined, admin.cookie)
  assert(cat2.json.assignments.calibration?.model_id === premium.json.id, 'assignment round-trips')

  // A fresh free-intro user's calibration now runs on the priced model → cost > 0.
  const u2 = await signIn(`b-${uniq}@ph35.test`)
  const p2 = await call('POST', '/api/profile', { role: 'Data Engineer', technologies: ['SQL'] }, u2.cookie)
  await call('POST', '/api/calibration/start', { profile_id: p2.json.id }, u2.cookie)
  const usage2 = await call('GET', '/api/usage', undefined, u2.cookie)
  assert(usage2.json.usage.cost_usd > 0, 'routed calibration used the priced model (cost > 0)')

  // Clearing the assignment falls back to the global default again.
  const clear = await call('PUT', '/api/admin/feature-models/calibration', { model_id: null }, admin.cookie)
  assert(clear.status === 200, 'admin cleared the calibration assignment')
  const cat3 = await call('GET', '/api/admin/feature-models', undefined, admin.cookie)
  assert(
    cat3.json.assignments.calibration?.model_id == null,
    'cleared assignment falls back to global default',
  )

  // Feature routing endpoints are admin-only.
  const asUser = await call('GET', '/api/admin/feature-models', undefined, u1.cookie)
  assert(asUser.status === 401 || asUser.status === 403, 'feature-model routes are admin-only')

  console.log('\n✅ R35 per-feature model routing verified\n')
} catch (err) {
  console.error('\n❌ R35 verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
