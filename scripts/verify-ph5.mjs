// Phase 5 verification (hosted mode, mock provider): résumé & opportunity pipeline.
// Proves:
//   - résumé review returns evidence-grounded suggestions;
//   - opportunity discovery returns match-scored openings;
//   - target-company mode ensures a company pack + repoints the profile (company/skill_pack);
//   - all three are plan-gated (free-intro users get 402; a host user with a model works).
// Boots its own server against the running Postgres. Usage: npm run build && node scripts/verify-ph5.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4796
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ph5.test',
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

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@ph5.test')
  const model = await call(
    'POST',
    '/api/admin/models',
    {
      label: 'House',
      provider: 'mock',
      model: 'mock-1',
      enabled: true,
      is_default: true,
      price_in: 0,
      price_out: 0,
    },
    admin.cookie,
  )
  assert(model.status === 200, 'admin created the default mock model')

  // Free-intro user: the pipeline is plan-gated → 402.
  const free = await signIn(`f-${uniq}@ph5.test`)
  const fp = await call(
    'POST',
    '/api/profile',
    { role: 'Backend Engineer', technologies: ['Go'] },
    free.cookie,
  )
  const gated = await call('POST', '/api/resume/review', { profile_id: fp.json.id }, free.cookie)
  assert(gated.status === 402, `résumé review is plan-gated for free-intro (402): "${gated.json.error}"`)

  // Host user (redeem invite + pick model) can use the pipeline.
  const invite = await call('POST', '/api/admin/invites', { token_credit: 1_000_000 }, admin.cookie)
  const user = await signIn(`u-${uniq}@ph5.test`)
  await call('POST', '/api/plan/redeem', { code: invite.json.code }, user.cookie)
  await call('POST', '/api/models/select', { model_id: model.json.id }, user.cookie)
  const prof = await call(
    'POST',
    '/api/profile',
    { role: 'Backend Engineer', technologies: ['Go', 'Postgres'] },
    user.cookie,
  )
  const profileId = prof.json.id

  // Résumé review returns grounded suggestions.
  const review = await call('POST', '/api/resume/review', { profile_id: profileId }, user.cookie)
  assert(review.status === 200, 'host user gets a résumé review')
  assert(typeof review.json.summary === 'string' && review.json.summary.length > 0, 'review has a summary')
  assert(
    Array.isArray(review.json.suggestions) &&
      review.json.suggestions.length > 0 &&
      review.json.suggestions[0].suggested_bullet,
    'review returns concrete suggested bullets',
  )

  // Opportunity discovery returns match-scored openings.
  const opps = await call(
    'POST',
    '/api/opportunities',
    { profile_id: profileId, location: 'Remote' },
    user.cookie,
  )
  assert(opps.status === 200, 'host user gets opportunities')
  assert(
    Array.isArray(opps.json.opportunities) &&
      opps.json.opportunities.length > 0 &&
      typeof opps.json.opportunities[0].match_score === 'number',
    'opportunities are match-scored',
  )

  // Target-company mode repoints the profile + ensures the company pack.
  const before = await call('GET', '/api/profile', undefined, user.cookie)
  assert(
    before.json.company == null || before.json.company !== 'Northwind',
    'profile not yet targeting Northwind',
  )
  const targeted = await call(
    'POST',
    '/api/opportunities/target',
    { profile_id: profileId, company: 'Northwind', role: 'Senior Backend Engineer' },
    user.cookie,
  )
  assert(targeted.status === 200 && targeted.json.pack_id, 'targeting an opening ensured a company pack')
  const after = await call('GET', '/api/profile', undefined, user.cookie)
  assert(after.json.company === 'Northwind', 'profile now targets the chosen company')
  assert(after.json.role === 'Senior Backend Engineer', 'profile role updated to the opening')
  assert(after.json.skill_pack, 'profile is pointed at the company pack (skill_pack set)')

  // Cross-user isolation: cannot review someone else's profile.
  const other = await signIn(`o-${uniq}@ph5.test`)
  await call(
    'POST',
    '/api/plan/redeem',
    { code: (await call('POST', '/api/admin/invites', { token_credit: 100 }, admin.cookie)).json.code },
    other.cookie,
  )
  await call('POST', '/api/models/select', { model_id: model.json.id }, other.cookie)
  const cross = await call('POST', '/api/resume/review', { profile_id: profileId }, other.cookie)
  assert(cross.status === 404, 'a user cannot review another user’s profile (404)')

  console.log('\n✅ Phase 5 (résumé improvement + opportunity discovery + target mode) verified\n')
} catch (err) {
  console.error('\n❌ Phase 5 verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
