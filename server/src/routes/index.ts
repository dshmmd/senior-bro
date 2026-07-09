// The API surface, composed from per-domain route modules (RF-3 — replaced the
// former 1,600-line routes.ts monolith). Cross-cutting business logic lives in
// ../services/ (entitlement, model-runner, pack-generator, interview-engine).
import { Hono } from 'hono'
import { HttpError } from '../http.js'
import { registerHealthRoutes } from './health.js'
import { registerAuthRoutes } from './auth.js'
import { registerModelRoutes } from './models.js'
import { registerVoiceRoutes } from './voice.js'
import { registerPlanRoutes } from './plan.js'
import { registerAdminRoutes } from './admin.js'
import { registerPackRoutes } from './packs.js'
import { registerCareerRoutes } from './career.js'
import { registerProfileRoutes } from './profiles.js'
import { registerInterviewRoutes } from './interviews.js'
import { registerMeRoutes } from './me.js'

export const api = new Hono()

api.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500
  console.error(JSON.stringify({ level: 'error', path: c.req.path, message: err.message }))
  return c.json({ error: err.message }, status as 409)
})

registerHealthRoutes(api)
registerAuthRoutes(api)
registerModelRoutes(api)
registerVoiceRoutes(api)
registerPlanRoutes(api)
registerAdminRoutes(api)
registerPackRoutes(api)
registerCareerRoutes(api)
registerProfileRoutes(api)
registerInterviewRoutes(api)
registerMeRoutes(api)
