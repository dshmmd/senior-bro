// Boots the built server on a scratch port and checks the key endpoints.
// Usage: npm run build && npm run smoke
import { spawn } from 'node:child_process'

const PORT = 4748
const proc = spawn('node', ['server/dist/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'inherit',
})

const get = async (path) => {
  const res = await fetch(`http://localhost:${PORT}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res
}

try {
  await new Promise((r) => setTimeout(r, 1500))
  const health = await (await get('/api/health')).json()
  if (!health.ok) throw new Error('health not ok')
  const skills = await (await get('/api/skills')).json()
  if (!Array.isArray(skills) || skills.length < 4) throw new Error('expected ≥4 skill packs')
  await get('/')
  console.log(`\n✅ smoke passed — health ok, ${skills.length} skill packs, SPA served\n`)
} catch (err) {
  console.error('\n❌ smoke failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  proc.kill()
}
