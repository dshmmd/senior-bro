// R31 verification (hosted mode, mock provider): CV-first onboarding.
// Proves: pasted-text résumé → extracted profile; a real PDF is text-extracted server-side (unpdf);
// extraction reflects the résumé (role/tech/years); the created profile consumes one free "first
// impression" (R32); the profile can be edited (PUT); and it flows into calibration. Boots its own
// server. Usage: npm run build && node scripts/verify-ph31.mjs
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'

const PORT = 4795
const proc = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SENIORBRO_MODE: 'hosted',
    SENIORBRO_SECRET: randomBytes(16).toString('hex'),
    SENIORBRO_ADMIN_EMAILS: 'admin@ph31.test',
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
  return verify.setCookie
}
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ✓ ' + msg)
}

// A minimal valid single-page PDF whose text is `content` — uncompressed (pure-ASCII) content
// stream so it survives string building; all bytes are ASCII so char length === byte offset.
function makePdf(content) {
  const streamBody = `BT /F1 12 Tf 72 720 Td (${content}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => (pdf += `${String(off).padStart(10, '0')} 00000 n \n`))
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'ascii')
}

const RESUME = `Jane Doe — Senior Backend Engineer
8 years building payment systems. Expert in Go, PostgreSQL and Kubernetes.
Currently targeting Stripe. Led a team migrating a monolith to services.`

const impressions = async (cookie) =>
  (await call('GET', '/api/usage', undefined, cookie)).json.first_impressions_used

try {
  await new Promise((r) => setTimeout(r, 1800))

  const admin = await signIn('admin@ph31.test')
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
    admin,
  )
  assert(model.status === 200, 'admin created the default mock model')

  // ── pasted-text path ──
  const u1 = await signIn(`t-${randomBytes(3).toString('hex')}@ph31.test`)
  const p1 = await call('POST', '/api/profile/from-cv', { text: RESUME }, u1)
  assert(p1.status === 200, 'pasted résumé text → a created profile')
  assert(/Backend Engineer/i.test(p1.json.role), `extracted the role ("${p1.json.role}")`)
  assert(
    p1.json.technologies.includes('Go') && p1.json.technologies.includes('PostgreSQL'),
    'extracted technologies',
  )
  assert(p1.json.years_experience === 8, `extracted years of experience (${p1.json.years_experience})`)
  assert((await impressions(u1)) === 1, 'the résumé check consumed one free first impression (1/3)')

  // Review/edit the extracted profile (R31 edit path).
  const edited = await call(
    'PUT',
    `/api/profile/${p1.json.id}`,
    { role: 'Staff Backend Engineer', technologies: ['Go', 'PostgreSQL', 'Kafka'], years_experience: 9 },
    u1,
  )
  assert(
    edited.status === 200 && edited.json.role === 'Staff Backend Engineer',
    'extracted profile is editable (PUT)',
  )
  assert((await impressions(u1)) === 1, 'editing does not burn another first impression (still 1/3)')

  // It flows straight into calibration without re-burning (same profile already onboarded).
  const cal = await call('POST', '/api/calibration/start', { profile_id: p1.json.id }, u1)
  assert(cal.status === 200 && Array.isArray(cal.json.questions), 'the profile flows into calibration')
  assert((await impressions(u1)) === 1, 'calibration on the same profile does not re-burn (still 1/3)')

  // ── PDF upload path (server-side text extraction via unpdf) ──
  const u2 = await signIn(`p-${randomBytes(3).toString('hex')}@ph31.test`)
  const fd = new FormData()
  fd.append(
    'file',
    new Blob([makePdf('Senior Data Engineer 6 years Python PostgreSQL')], { type: 'application/pdf' }),
    'cv.pdf',
  )
  const pdfRes = await fetch(`${BASE}/api/profile/from-cv`, {
    method: 'POST',
    headers: { cookie: u2 },
    body: fd,
  })
  const pdfProfile = await pdfRes.json().catch(() => ({}))
  assert(pdfRes.status === 200, `PDF upload → a created profile (status ${pdfRes.status})`)
  assert(/Data Engineer/i.test(pdfProfile.role), `PDF text was extracted + parsed ("${pdfProfile.role}")`)
  assert(pdfProfile.technologies.includes('Python'), 'PDF-extracted technologies')

  // Too-little text is rejected clearly.
  const tiny = await call('POST', '/api/profile/from-cv', { text: 'hi' }, u2)
  assert(tiny.status === 400, 'an empty/too-short résumé is rejected (400)')

  console.log('\n✅ R31 CV-first onboarding verified (text + PDF, extract → edit → calibrate)\n')
} catch (err) {
  console.error('\n❌ R31 verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
