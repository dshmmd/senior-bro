// Regression lock for the "selected a website model but the app didn't register it" bug.
// Root cause: /health readiness (and the client gate it drives) only looked at the user's own
// key/CLI config (`configured`), ignoring a *selected provided model* (`has_model`) — so picking
// a curated model looked like "nothing configured" and the app bounced back to setup.
// This proves /health now exposes `interview_ready` and that it flips true once a model is chosen
// (with balance), and that the interview then actually starts.
// Boots its own hosted server against the running Postgres. Usage: npm run build && node scripts/verify-model-readiness.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4795
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@mr.test',
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
  const cookie = cookieFrom(res)
  if (!cookie) throw new Error(`sign-in failed for ${email}`)
  return { cookie, role: (await res.json()).role }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}
const health = async (cookie) => (await call('GET', '/api/health', undefined, cookie)).json
const uniq = randomBytes(3).toString('hex')

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@mr.test')
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
  const modelId = model.json.id

  const user = await signIn(`user-${uniq}@mr.test`)
  const h0 = await health(user.cookie)
  assert(h0.plan === 'free-intro', 'new user starts free-intro')
  assert(h0.has_model === false, 'new user has no model selected')
  assert(h0.interview_ready === false, 'free-intro user is NOT interview-ready (must choose a model)')
  assert(h0.first_impressions_limit === 3, 'health reports the 3 free first impressions budget')

  const profile = await call(
    'POST',
    '/api/profile',
    { role: 'Backend Engineer', technologies: ['Go'] },
    user.cookie,
  )
  const profileId = profile.json.id
  const calib = await call('POST', '/api/calibration/start', { profile_id: profileId }, user.cookie)
  assert(calib.status === 200, 'free first impression (level-check) runs with no model chosen')

  const paywalled = await call(
    'POST',
    '/api/interviews',
    { profile_id: profileId, mode: 'text', kind: 'full' },
    user.cookie,
  )
  assert(paywalled.status === 402, 'interview is paywalled before a plan (402)')

  const pay = await call('POST', '/api/plan/checkout', { tokens: 100_000 }, user.cookie)
  assert(pay.status === 200, 'mock checkout adds balance + flips to host plan')

  const h1 = await health(user.cookie)
  assert(
    h1.has_model === false && h1.interview_ready === false,
    'host plan WITH balance but NO model chosen is still not ready (needs the brain-model pick)',
  )

  const sel = await call('POST', '/api/models/select', { model_id: modelId }, user.cookie)
  assert(sel.status === 200, 'user picks the interviewer model')

  const h2 = await health(user.cookie)
  // The regression: selecting a provided model now makes the app recognize the user as ready.
  assert(h2.has_model === true, 'health reports the selected model')
  assert(h2.interview_ready === true, 'REGRESSION LOCK: a selected model makes the user interview-ready')

  const iv = await call(
    'POST',
    '/api/interviews',
    { profile_id: profileId, mode: 'text', kind: 'full' },
    user.cookie,
  )
  assert(
    iv.status === 200 && typeof iv.json.interview_id === 'number',
    'interview starts on the selected model',
  )

  console.log('\n✅ model-readiness verification passed')
} finally {
  proc.kill()
}
