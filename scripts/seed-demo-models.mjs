// One-command demo setup: add the curated models + wire per-feature routing into a running
// hosted server, so a fresh DB (after `make db-reset`) is demo-ready again in seconds.
//
// Secrets are NOT committed: this reads model definitions from an untracked JSON file
// (default `.demo-models.json`, gitignored) — put your real Arvan gateway URLs + apikey there.
//
// Usage (server must be running in hosted mode with your email in SENIORBRO_ADMIN_EMAILS):
//   SB_ADMIN_EMAIL=you@example.com node scripts/seed-demo-models.mjs
//   BASE=http://localhost:4747 SB_MODELS_FILE=.demo-models.json node scripts/seed-demo-models.mjs
//
// .demo-models.json shape:
// {
//   "models": [
//     { "label": "Claude Haiku 4.5", "provider": "arvan", "model": "Claude-Haiku-4-5-Brain-01kdw",
//       "base_url": "https://.../v1", "apiKey": "<account key>", "is_default": true,
//       "price_in": 1, "price_out": 5 }
//   ],
//   "feature_models": { "voice.transcribe": "GPT-4o Transcribe (voice)" }  // feature key -> model label
// }
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4747'
const ADMIN_EMAIL = process.env.SB_ADMIN_EMAIL ?? 'admin@demo.test'
const FILE = process.env.SB_MODELS_FILE ?? '.demo-models.json'

const cookieFrom = (res) => {
  const m = /sb_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')
  return m ? `sb_session=${m[1]}` : null
}
async function call(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})), setCookie: cookieFrom(res) }
}

const cfg = JSON.parse(readFileSync(FILE, 'utf8'))

// Admin sign-in via the dev magic-link (returned by /auth/request in non-prod).
const req = await call('POST', '/api/auth/request', { email: ADMIN_EMAIL })
const link = req.json.link
if (!link)
  throw new Error(
    `no dev magic link returned — is the server in hosted (non-prod) mode? ${JSON.stringify(req.json)}`,
  )
const token = new URL(link).searchParams.get('magic')
const verify = await call('POST', '/api/auth/verify', { token })
if (verify.json.role !== 'admin')
  throw new Error(`${ADMIN_EMAIL} is not an admin — add it to SENIORBRO_ADMIN_EMAILS`)
const cookie = verify.setCookie

const byLabel = {}
for (const m of cfg.models ?? []) {
  const r = await call('POST', '/api/admin/models', m, cookie)
  if (r.status !== 200) {
    console.error(`✗ ${m.label}: ${r.json.error ?? r.status}`)
    continue
  }
  byLabel[m.label] = r.json.id
  console.log(
    `✓ ${m.label} (id ${r.json.id}, tier ${r.json.capability_tier ?? '?'})${m.is_default ? ' — default' : ''}`,
  )
}

for (const [feature, label] of Object.entries(cfg.feature_models ?? {})) {
  const id = byLabel[label]
  if (!id) {
    console.error(`✗ route ${feature}: model "${label}" wasn't created`)
    continue
  }
  const r = await call('PUT', `/api/admin/feature-models/${feature}`, { model_id: id }, cookie)
  console.log(
    r.status === 200 ? `✓ routed ${feature} → ${label}` : `✗ route ${feature}: ${r.json.error ?? r.status}`,
  )
}

console.log('\n✅ demo models seeded')
