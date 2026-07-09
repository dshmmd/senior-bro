// Regression lock for two reported bugs:
//  1. Admin ("MUST work because I'm admin") was treated as an unpaid free-intro user — paywalled
//     from résumé onboarding / interviews. Admins are staff and must run every feature un-metered.
//  2. Running out of the free tier during résumé onboarding must return a CLEAR error (the UI had
//     no visible message) — here we lock the server contract: the blocked call is a 402 with a
//     non-empty `error` the client can surface.
// Boots its own hosted server (mock provider) against the running Postgres.
// Usage: npm run build && node scripts/verify-admin-entitlement.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4796
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ae.test',
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
  return { status: res.status, json }
}
async function signIn(email) {
  const req = await call('POST', '/api/auth/request', { email })
  const token = new URL(req.json.link).searchParams.get('magic')
  const res = await fetch(BASE + '/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return { cookie: cookieFrom(res), role: (await res.json()).role }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}
const health = async (cookie) => (await call('GET', '/api/health', undefined, cookie)).json
const RESUME = 'Backend Engineer, 5 years. Go, PostgreSQL, Kubernetes. Built high-scale services.'
const uniq = randomBytes(3).toString('hex')

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@ae.test')
  assert(admin.role === 'admin', 'admin email is promoted to admin role')
  const model = await call(
    'POST',
    '/api/admin/models',
    {
      label: 'House',
      provider: 'mock',
      model: 'mock-1',
      enabled: true,
      is_default: true,
      price_in: 1,
      price_out: 1,
    },
    admin.cookie,
  )
  assert(model.status === 200, 'admin created a default provided model')

  // --- Bug 2: admin is a privileged staff account, never paywalled ---
  const ah = await health(admin.cookie)
  assert(ah.plan === 'free-intro' && ah.credit_left === null, 'admin has no plan/credit of its own')
  assert(ah.interview_ready === true, 'admin is interview-ready anyway (staff runs on the default model)')

  const acv = await call('POST', '/api/profile/from-cv', { text: RESUME }, admin.cookie)
  assert(acv.status === 200, 'admin can onboard from a résumé un-metered')
  const aInt = await call(
    'POST',
    '/api/interviews',
    { profile_id: acv.json.id, mode: 'text', kind: 'full' },
    admin.cookie,
  )
  assert(aInt.status === 200, 'admin can start a full interview un-metered (not paywalled)')

  // --- Bug 1: a normal free-intro user out of impressions gets a CLEAR 402 on résumé ---
  const user = await signIn(`user-${uniq}@ae.test`)
  assert(user.role === 'user', 'normal user signs in as a regular user')
  for (let i = 1; i <= 3; i++) {
    const r = await call('POST', '/api/profile/from-cv', { text: RESUME }, user.cookie)
    assert(r.status === 200, `free first impression ${i}/3 onboards a résumé`)
  }
  const blocked = await call('POST', '/api/profile/from-cv', { text: RESUME }, user.cookie)
  assert(blocked.status === 402, '4th résumé (out of free tier) is blocked with 402')
  assert(
    typeof blocked.json.error === 'string' && blocked.json.error.length > 0,
    `the block carries a clear, surfaceable error message: "${blocked.json.error}"`,
  )

  console.log('\n✅ admin-entitlement verification passed')
} finally {
  proc.kill()
}
