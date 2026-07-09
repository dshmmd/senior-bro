#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb } from './db.js'
import { api } from './routes/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 4747)

await initDb()

const app = new Hono()

// structured request logs (JSON lines)
app.use('/api/*', async (c, next) => {
  const start = Date.now()
  await next()
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - start,
    }),
  )
})

// per-client sliding-window rate limit (in-memory; fine for local + single node)
const RATE_LIMIT = 120 // requests per minute
const hits = new Map<string, number[]>()
app.use('/api/*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for') ?? 'local'
  const now = Date.now()
  const windowHits = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  windowHits.push(now)
  hits.set(ip, windowHits)
  if (windowHits.length > RATE_LIMIT) return c.json({ error: 'rate limit exceeded, slow down' }, 429)
  await next()
})

app.route('/api', api)

// Serve the built SPA (web/dist) in production; in dev, Vite proxies to us.
const webDist = path.resolve(__dirname, '../../web/dist')
if (fs.existsSync(webDist)) {
  const relRoot = path.relative(process.cwd(), webDist)
  app.use('/*', serveStatic({ root: relRoot }))
  app.get('*', serveStatic({ path: path.join(relRoot, 'index.html') }))
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n  Senior Bro is running → http://localhost:${PORT}\n`)
})
