// Throwaway hosted-mode verification for Phase 13 (plans/gating/invite codes).
// Boots nothing itself — expects the server already running at BASE (hosted mode).
const BASE = process.env.BASE ?? 'http://localhost:4791'

function cookieFrom(res) {
  const raw = res.headers.get('set-cookie') ?? ''
  const m = /sb_session=([^;]+)/.exec(raw)
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
  return { cookie: verify.setCookie, role: verify.json.role }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}

const admin = await signIn('admin@ph13.test')
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
assert(model.status === 200 && model.json.is_default, 'admin created the default mock model')
const modelId = model.json.id

const inv = await call(
  'POST',
  '/api/admin/invites',
  { token_credit: 1_000_000, note: 'tester' },
  admin.cookie,
)
assert(inv.status === 200 && inv.json.code.startsWith('SB-'), `admin minted invite ${inv.json.code}`)
const code = inv.json.code

const user = await signIn('user@ph13.test')
assert(user.role === 'user', 'new user signs in as a regular user')
const health0 = await call('GET', '/api/health', undefined, user.cookie)
assert(health0.json.plan === 'free-intro', 'new user starts on the free-intro plan')
assert(health0.json.has_model === false, 'new user has no model selected')

const profile = await call(
  'POST',
  '/api/profile',
  { role: 'Backend Engineer', technologies: ['Go'] },
  user.cookie,
)
assert(profile.status === 200, 'user created a profile (no key/plan needed)')
const profileId = profile.json.id

const calib = await call('POST', '/api/calibration/start', { profile_id: profileId }, user.cookie)
assert(
  calib.status === 200 && Array.isArray(calib.json.questions),
  'free-intro level-check runs on the platform model',
)

const blocked = await call(
  'POST',
  '/api/interviews',
  { profile_id: profileId, mode: 'text', kind: 'full' },
  user.cookie,
)
assert(blocked.status === 402, `free-intro user is paywalled from interviews (402): "${blocked.json.error}"`)

const redeem = await call('POST', '/api/plan/redeem', { code }, user.cookie)
assert(redeem.status === 200 && redeem.json.granted === 1_000_000, 'invite code redeemed → 1M token credit')
const reuse = await call('POST', '/api/plan/redeem', { code }, user.cookie)
assert(reuse.status === 400, 'the same code cannot be redeemed twice (single-use)')

const stillNoModel = await call(
  'POST',
  '/api/interviews',
  { profile_id: profileId, mode: 'text', kind: 'full' },
  user.cookie,
)
assert(stillNoModel.status === 409, 'host user with credit but no model picked is asked to configure (409)')

const sel = await call('POST', '/api/models/select', { model_id: modelId }, user.cookie)
assert(sel.status === 200, 'user selects the host model')

const iv = await call(
  'POST',
  '/api/interviews',
  { profile_id: profileId, mode: 'text', kind: 'full' },
  user.cookie,
)
assert(
  iv.status === 200 && typeof iv.json.interview_id === 'number',
  'host user with credit can start an interview',
)

const usage = await call('GET', '/api/usage', undefined, user.cookie)
assert(usage.json.plan === 'host', 'usage reports the host plan')
assert(
  usage.json.credit_left !== null && usage.json.credit_left < 1_000_000,
  `credit decremented by metered usage (left=${usage.json.credit_left})`,
)

console.log('\n✅ Phase 13 hosted verification passed')
