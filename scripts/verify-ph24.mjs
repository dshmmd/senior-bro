// Phase 24 verification (hosted mode, mock provider) for R33 + R34 + D22.
// Proves interview domains (technical + HR):
//   - a full interview carries a `domain`, persisted + returned on the interview + its history row;
//   - an HR interview routes to the `interview.hr` feature model (R35) — shown by metering: HR runs
//     on a priced model while technical runs on the free default;
//   - per-domain constellations (R34) stay hidden until a domain has a *finished* interview, then
//     each unlocked domain returns its own progress.
// Boots its own server against the running Postgres. Usage: npm run build && node scripts/verify-ph24.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4795
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ph24.test',
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
const addModel = (cookie, label, extra) =>
  call(
    'POST',
    '/api/admin/models',
    { label, provider: 'mock', model: 'mock-1', enabled: true, price_in: 0, price_out: 0, ...extra },
    cookie,
  )
const cost = async (cookie) => (await call('GET', '/api/usage', undefined, cookie)).json.usage.cost_usd

// Drive one full interview to completion in the given domain; returns its id.
async function runInterview(cookie, profileId, domain) {
  const start = await call(
    'POST',
    '/api/interviews',
    { profile_id: profileId, mode: 'text', kind: 'full', domain },
    cookie,
  )
  if (start.status !== 200) throw new Error(`start ${domain} failed: ${JSON.stringify(start.json)}`)
  const id = start.json.interview_id
  await call('POST', `/api/interviews/${id}/messages`, { content: 'Here is my answer.' }, cookie)
  const fin = await call('POST', `/api/interviews/${id}/finish`, {}, cookie)
  if (fin.status !== 200) throw new Error(`finish ${domain} failed: ${JSON.stringify(fin.json)}`)
  return id
}

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@ph24.test')
  const free = await addModel(admin.cookie, 'House (free)', { is_default: true })
  const hrModel = await addModel(admin.cookie, 'HR premium', { price_in: 10000, price_out: 10000 })
  assert(free.status === 200 && hrModel.status === 200, 'admin created a free default + a priced HR model')

  // R33/R35: the interview.hr feature is a real routing knob; route it to the priced model.
  const cat = await call('GET', '/api/admin/feature-models', undefined, admin.cookie)
  assert(
    cat.json.features.some((f) => f.key === 'interview.hr'),
    'feature catalogue lists the new interview.hr feature',
  )
  const routeHr = await call(
    'PUT',
    '/api/admin/feature-models/interview.hr',
    { model_id: hrModel.json.id },
    admin.cookie,
  )
  assert(routeHr.status === 200, 'admin routed interview.hr → the priced model')

  // A user who can run interviews: mint + redeem an invite (→ host plan + credit).
  const invite = await call('POST', '/api/admin/invites', { token_credit: 1_000_000 }, admin.cookie)
  const user = await signIn(`u-${uniq}@ph24.test`)
  const redeem = await call('POST', '/api/plan/redeem', { code: invite.json.code }, user.cookie)
  assert(redeem.status === 200, 'user redeemed an invite → host plan + credit')
  // Host users pick a curated model; select the free default (HR gets overridden by the R35 route).
  const pick = await call('POST', '/api/models/select', { model_id: free.json.id }, user.cookie)
  assert(pick.status === 200, 'user selected the free default model')

  const prof = await call(
    'POST',
    '/api/profile',
    { role: 'Backend Engineer', technologies: ['Go', 'Postgres'] },
    user.cookie,
  )
  const profileId = prof.json.id

  // Before any interview, no domain is unlocked (R34).
  const prog0 = await call('GET', '/api/progress', undefined, user.cookie)
  assert(
    Array.isArray(prog0.json.domains) && prog0.json.domains.length === 0,
    'no constellation unlocked yet',
  )

  // Technical interview runs on the free default → no cost added.
  const beforeTech = await cost(user.cookie)
  const techId = await runInterview(user.cookie, profileId, 'technical')
  const techIv = await call('GET', `/api/interviews/${techId}`, undefined, user.cookie)
  assert(techIv.json.domain === 'technical', 'technical interview persists domain=technical')
  assert((await cost(user.cookie)) === beforeTech, 'technical interview used the free default (no cost)')

  // After a finished technical interview, only the technical constellation is unlocked (R34).
  const prog1 = await call('GET', '/api/progress', undefined, user.cookie)
  const domains1 = prog1.json.domains.map((d) => d.domain)
  assert(domains1.length === 1 && domains1[0] === 'technical', 'only technical constellation unlocked')
  assert(prog1.json.domains[0].progress.interviews_total === 1, 'technical constellation counts 1 interview')

  // HR interview routes to the priced model → cost strictly increases.
  const beforeHr = await cost(user.cookie)
  const hrId = await runInterview(user.cookie, profileId, 'hr')
  const hrIv = await call('GET', `/api/interviews/${hrId}`, undefined, user.cookie)
  assert(hrIv.json.domain === 'hr', 'HR interview persists domain=hr')
  assert(
    (await cost(user.cookie)) > beforeHr,
    'HR interview routed to the priced interview.hr model (cost > 0)',
  )

  // Now both domains are unlocked, each its own constellation (R34).
  const prog2 = await call('GET', '/api/progress', undefined, user.cookie)
  const domains2 = prog2.json.domains.map((d) => d.domain).sort()
  assert(
    domains2.length === 2 && domains2[0] === 'hr' && domains2[1] === 'technical',
    'both technical + HR constellations unlocked, separately',
  )
  const hrProg = prog2.json.domains.find((d) => d.domain === 'hr').progress
  assert(
    hrProg.interviews_total === 1,
    'HR constellation counts exactly its 1 interview (not the technical one)',
  )

  // History rows expose the domain too.
  const hist = await call('GET', '/api/interviews', undefined, user.cookie)
  assert(
    hist.json.some((h) => h.id === hrId && h.domain === 'hr') &&
      hist.json.some((h) => h.id === techId && h.domain === 'technical'),
    'history rows carry the interview domain',
  )

  console.log('\n✅ Phase 24 (R33 domains + R34 per-domain constellations) verified\n')
} catch (err) {
  console.error('\n❌ Phase 24 verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
