#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb } from './db.js'
import { api } from './routes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 4747)

initDb()

const app = new Hono()
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
