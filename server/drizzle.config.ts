import { defineConfig } from 'drizzle-kit'

// Drizzle Kit config: generates SQL migrations from src/schema.ts into ./drizzle.
// The server applies pending migrations on boot (see db.ts initDb).
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://senior:senior@localhost:5433/senior_bro',
  },
})
