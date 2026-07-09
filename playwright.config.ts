import { defineConfig } from '@playwright/test'
import path from 'node:path'

// The e2e run is fully isolated: HOME points at .e2e-home (config.json / secret key)
// and DATABASE_URL points at a dedicated `senior_bro_test` database that global-setup
// wipes clean before each run (Postgres persists across runs, unlike the old sqlite file).
const E2E_HOME = path.resolve(import.meta.dirname, '.e2e-home')
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://senior:senior@localhost:5433/senior_bro_test'
const PORT = 4749

export default defineConfig({
  testDir: './e2e',
  // DB + HOME isolation happens in e2e/prepare.mjs (the "e2e" npm script runs it
  // before Playwright — the webServer boots before globalSetup, so prep can't go there).
  // All specs share one server + one test DB, and later specs build on state earlier
  // ones created (urls.spec reuses happy-path's calibrated profile) — keep one worker.
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: 'node server/dist/index.js',
    port: PORT,
    env: {
      ...process.env,
      HOME: E2E_HOME,
      PORT: String(PORT),
      DATABASE_URL: E2E_DATABASE_URL,
    },
    reuseExistingServer: false,
  },
})
