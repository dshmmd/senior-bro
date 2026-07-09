// RF-9 slice 1 — admin console v2 server capabilities:
//  1. suspend/unsuspend: a suspended user fails every authenticated request with 403,
//     un-suspending restores access; an admin can't suspend themself.
//  2. admin-action audit log: admin mutations (model create, feature routing, quota,
//     suspend) each record an event readable at GET /api/admin/events.
//  3. per-event usage audit: GET /api/admin/usage-events lists metered calls
//     (who/model/tokens/cost), filterable by user.
//  4. feature kill switch: a disabled feature fails fast with 503 on platform-funded
//     calls, and re-enabling restores it. voice.transcribe reads as unavailable.
// Boots its own hosted server (mock provider) against the running Postgres.
// Usage: npm run build && node scripts/verify-admin-v2.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 4797
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@av2.test',
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
  return { cookie: cookieFrom(res), json: await res.json() }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}
const uniq = randomBytes(3).toString('hex')
const RESUME = 'Backend Engineer, 5 years. Go, PostgreSQL, Kubernetes. Built high-scale services.'

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@av2.test')
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
  assert(model.status === 200, 'admin created the default mock model')

  // ── a normal user generates some metered usage (free first impression) ──
  const user = await signIn(`user-${uniq}@av2.test`)
  const cv = await call('POST', '/api/profile/from-cv', { text: RESUME }, user.cookie)
  assert(cv.status === 200, 'user onboards a résumé (metered on the house model)')

  // ── 3. per-event usage audit ──
  const usersList = await call('GET', '/api/admin/users', undefined, admin.cookie)
  const row = usersList.json.find((u) => u.email === `user-${uniq}@av2.test`)
  assert(
    row && row.suspended === false && typeof row.plan === 'string',
    'users list carries plan + suspended',
  )
  const events = await call('GET', `/api/admin/usage-events?user_id=${row.id}`, undefined, admin.cookie)
  assert(
    events.status === 200 && Array.isArray(events.json) && events.json.length > 0,
    'usage audit lists the metered call',
  )
  const ev = events.json[0]
  assert(
    ev.email === `user-${uniq}@av2.test` && ev.input_tokens > 0 && typeof ev.cost_usd === 'number',
    'audit row has who/model/tokens/cost',
  )
  const forbidden = await call('GET', '/api/admin/usage-events', undefined, user.cookie)
  assert(forbidden.status === 403, 'non-admin cannot read the usage audit')

  // ── 1. suspend / unsuspend ──
  const selfSuspend = await call(
    'POST',
    `/api/admin/users/${usersList.json.find((u) => u.email === 'admin@av2.test').id}/suspend`,
    { suspended: true },
    admin.cookie,
  )
  assert(selfSuspend.status === 400, 'an admin cannot suspend their own account')
  const sus = await call('POST', `/api/admin/users/${row.id}/suspend`, { suspended: true }, admin.cookie)
  assert(sus.status === 200, 'admin suspends the user')
  const blocked = await call('GET', '/api/profile', undefined, user.cookie)
  assert(blocked.status === 403, 'suspended user is blocked (403) on every request')
  const unsus = await call('POST', `/api/admin/users/${row.id}/suspend`, { suspended: false }, admin.cookie)
  assert(unsus.status === 200, 'admin un-suspends the user')
  const restored = await call('GET', '/api/profile', undefined, user.cookie)
  assert(restored.status === 200, 'un-suspended user has access again')

  // ── 4. feature kill switch ──
  const kill = await call('PUT', '/api/admin/feature-models/resume.parse', { disabled: true }, admin.cookie)
  assert(kill.status === 200, 'admin flips the resume.parse kill switch')
  const killedCall = await call('POST', '/api/profile/from-cv', { text: RESUME }, user.cookie)
  assert(killedCall.status === 503, 'a killed feature fails fast with 503 (no model call)')
  assert(
    typeof killedCall.json.error === 'string' && killedCall.json.error.includes('disabled'),
    'the 503 carries a clear message',
  )
  const fm = await call('GET', '/api/admin/feature-models', undefined, admin.cookie)
  assert(fm.json.assignments['resume.parse']?.disabled === true, 'assignments expose the kill switch state')
  const revive = await call(
    'PUT',
    '/api/admin/feature-models/resume.parse',
    { disabled: false },
    admin.cookie,
  )
  assert(revive.status === 200, 'admin re-enables the feature')
  const revived = await call('POST', '/api/profile/from-cv', { text: RESUME }, user.cookie)
  assert(revived.status === 200, 're-enabled feature works again')
  // voice.transcribe: killed → reads as unavailable (client falls back to browser STT)
  await call('PUT', '/api/admin/feature-models/voice.transcribe', { disabled: true }, admin.cookie)
  const voice = await call('GET', '/api/voice/available', undefined, user.cookie)
  assert(voice.json.available === false, 'a killed voice.transcribe reads as unavailable (silent fallback)')

  // ── 2. admin-action audit log ──
  const log = await call('GET', '/api/admin/events', undefined, admin.cookie)
  assert(log.status === 200 && Array.isArray(log.json) && log.json.length >= 5, 'audit log has entries')
  const actions = log.json.map((e) => e.action)
  for (const expected of ['model.create', 'feature.route', 'user.suspend', 'user.unsuspend']) {
    assert(actions.includes(expected), `audit log recorded ${expected}`)
  }
  assert(
    log.json.every((e) => e.admin_email === 'admin@av2.test'),
    'audit rows carry the acting admin',
  )
  const logForbidden = await call('GET', '/api/admin/events', undefined, user.cookie)
  assert(logForbidden.status === 403, 'non-admin cannot read the audit log')

  console.log('\n✅ admin-v2 (RF-9 slice 1) verification passed')
} finally {
  proc.kill()
}
