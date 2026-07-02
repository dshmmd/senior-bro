// Phase 7 verification (hosted mode, mock provider): learn-while-interviewing.
// Proves the post-interview study plan:
//   - is plan-gated like interviews (free-intro → 402);
//   - after a finished interview, returns prioritized items;
//   - at least one item links to a real open weakness id (so the UI can launch a coaching drill).
// (Teaching mode is a prompt-construction behavior, asserted structurally in the guardrail unit test.)
// Boots its own server against the running Postgres. Usage: npm run build && node scripts/verify-ph7.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4797
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ph7.test',
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

  const admin = await signIn('admin@ph7.test')
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

  // Free-intro user: study plan is plan-gated → 402.
  const free = await signIn(`f-${uniq}@ph7.test`)
  const fp = await call(
    'POST',
    '/api/profile',
    { role: 'Backend Engineer', technologies: ['Go'] },
    free.cookie,
  )
  const gated = await call('POST', '/api/study-plan', { profile_id: fp.json.id }, free.cookie)
  assert(gated.status === 402, `study plan is plan-gated for free-intro (402): "${gated.json.error}"`)

  // Host user: run one interview to completion so weaknesses exist.
  const invite = await call('POST', '/api/admin/invites', { token_credit: 1_000_000 }, admin.cookie)
  const user = await signIn(`u-${uniq}@ph7.test`)
  await call('POST', '/api/plan/redeem', { code: invite.json.code }, user.cookie)
  await call('POST', '/api/models/select', { model_id: model.json.id }, user.cookie)
  const prof = await call(
    'POST',
    '/api/profile',
    { role: 'Backend Engineer', technologies: ['Go', 'Postgres'] },
    user.cookie,
  )
  const profileId = prof.json.id

  const start = await call(
    'POST',
    '/api/interviews',
    { profile_id: profileId, mode: 'text', kind: 'full' },
    user.cookie,
  )
  await call(
    'POST',
    `/api/interviews/${start.json.interview_id}/messages`,
    { content: 'My answer.' },
    user.cookie,
  )
  const fin = await call('POST', `/api/interviews/${start.json.interview_id}/finish`, {}, user.cookie)
  assert(fin.status === 200, 'ran + finished an interview (produces weaknesses)')

  const weaknesses = await call('GET', '/api/weaknesses', undefined, user.cookie)
  assert(Array.isArray(weaknesses.json) && weaknesses.json.length > 0, 'the interview produced weaknesses')
  const weaknessIds = new Set(weaknesses.json.map((w) => w.id))

  const plan = await call('POST', '/api/study-plan', { profile_id: profileId }, user.cookie)
  assert(plan.status === 200, 'host user gets a study plan')
  assert(typeof plan.json.overview === 'string' && plan.json.overview.length > 0, 'plan has an overview')
  assert(Array.isArray(plan.json.items) && plan.json.items.length > 0, 'plan has prioritized items')
  const linked = plan.json.items.filter((it) => it.weakness_id !== null)
  assert(linked.length > 0, 'at least one plan item links to a weakness (drillable)')
  assert(
    linked.every((it) => weaknessIds.has(it.weakness_id)),
    'linked ids are real open weaknesses',
  )

  // Cross-user isolation.
  const other = await signIn(`o-${uniq}@ph7.test`)
  await call(
    'POST',
    '/api/plan/redeem',
    { code: (await call('POST', '/api/admin/invites', { token_credit: 100 }, admin.cookie)).json.code },
    other.cookie,
  )
  await call('POST', '/api/models/select', { model_id: model.json.id }, other.cookie)
  const cross = await call('POST', '/api/study-plan', { profile_id: profileId }, other.cookie)
  assert(cross.status === 404, 'a user cannot get a study plan for another user’s profile (404)')

  console.log('\n✅ Phase 7 (teaching mode + post-interview study plan) verified\n')
} catch (err) {
  console.error('\n❌ Phase 7 verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
