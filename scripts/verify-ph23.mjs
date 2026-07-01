// Phase 23 verification (hosted mode, mock provider) for R32 + R36.
// Proves the shared "first impression" free tier (D21) and profile deletion:
//   - a free-intro user gets 3 free first impressions, one per profile they onboard;
//   - re-calibrating the same profile never re-burns a credit;
//   - the 4th new profile's onboarding is paywalled (402);
//   - deleting a profile frees a slot so a new one can onboard again;
//   - full interviews stay plan-gated regardless.
// Boots its own server against the running Postgres. Usage: npm run build && node scripts/verify-ph23.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4793
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ph23.test',
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
  return { cookie: verify.setCookie, role: verify.json.role }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}
const uniq = randomBytes(3).toString('hex')

// Create a profile then run its calibration (start = the credit-consuming onboarding action).
async function onboard(cookie, role) {
  const p = await call('POST', '/api/profile', { role, technologies: ['Go'] }, cookie)
  if (p.status !== 200) return { profileId: p.json.id ?? null, calib: p }
  const calib = await call('POST', '/api/calibration/start', { profile_id: p.json.id }, cookie)
  return { profileId: p.json.id, calib }
}
const impressions = async (cookie) =>
  (await call('GET', '/api/usage', undefined, cookie)).json.first_impressions_used

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@ph23.test')
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

  const user = await signIn(`u-${uniq}@ph23.test`)
  const health = await call('GET', '/api/health', undefined, user.cookie)
  assert(health.json.plan === 'free-intro', 'new user starts on the free-intro plan')

  // First impression #1: onboarding a profile runs on the platform model + consumes 1 of 3.
  const p1 = await onboard(user.cookie, 'Backend Engineer')
  assert(p1.calib.status === 200, 'profile 1 onboarding (calibration) runs free')
  assert((await impressions(user.cookie)) === 1, 'first impression #1 consumed (1/3)')

  // Re-calibrating the same profile must NOT re-burn a credit.
  const recal = await call('POST', '/api/calibration/start', { profile_id: p1.profileId }, user.cookie)
  assert(recal.status === 200, 're-calibrating the same position still works')
  assert((await impressions(user.cookie)) === 1, 're-checking the same position does not re-burn (still 1/3)')

  // Impressions #2 and #3.
  const p2 = await onboard(user.cookie, 'Platform Engineer')
  assert(p2.calib.status === 200, 'profile 2 onboarding runs free (2/3)')
  const p3 = await onboard(user.cookie, 'Data Engineer')
  assert(p3.calib.status === 200, 'profile 3 onboarding runs free (3/3)')
  assert((await impressions(user.cookie)) === 3, 'all 3 free first impressions consumed')

  // 4th new profile's onboarding is paywalled.
  const p4 = await onboard(user.cookie, 'ML Engineer')
  assert(p4.calib.status === 402, `4th profile onboarding paywalled (402): "${p4.calib.json.error}"`)

  // Deleting a profile frees a slot.
  const del = await call('DELETE', `/api/profiles/${p1.profileId}`, undefined, user.cookie)
  assert(del.status === 200, 'user deleted profile 1')
  assert((await impressions(user.cookie)) === 2, 'deleting a profile freed a slot (2/3)')

  // The 4th profile already exists; its calibration should now succeed with a free slot.
  const p4again = await call('POST', '/api/calibration/start', { profile_id: p4.profileId }, user.cookie)
  assert(p4again.status === 200, 'after freeing a slot, the 4th position can onboard')
  assert((await impressions(user.cookie)) === 3, 'that onboarding consumed the freed slot (3/3)')

  // Full interviews are always plan-gated for free-intro.
  const iv = await call(
    'POST',
    '/api/interviews',
    { profile_id: p4.profileId, mode: 'text', kind: 'full' },
    user.cookie,
  )
  assert(iv.status === 402, `full interviews stay paywalled for free-intro (402): "${iv.json.error}"`)

  // Deleting someone else's profile is a 404 (cross-user isolation intact).
  const other = await signIn(`o-${uniq}@ph23.test`)
  const cross = await call('DELETE', `/api/profiles/${p4.profileId}`, undefined, other.cookie)
  assert(cross.status === 404, 'a user cannot delete another user’s profile (404)')

  console.log('\n✅ Phase 23 (R32 first-impression free tier + R36 delete) verified\n')
} catch (err) {
  console.error('\n❌ Phase 23 verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
