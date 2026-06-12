import { defineConfig } from '@playwright/test'
import path from 'node:path'

// The e2e run is fully isolated: HOME points at .e2e-home so the server
// reads/writes .e2e-home/.senior-bro instead of the real ~/.senior-bro.
const E2E_HOME = path.resolve(import.meta.dirname, '.e2e-home')
const PORT = 4749

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
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
    },
    reuseExistingServer: false,
  },
})
