/**
 * Data layer barrel (RF-3 slice 2) — the former 1,300-line db.ts split into
 * per-domain query modules under `db/`. Import path is unchanged
 * (`import * as db from './db.js'`) so routes/services/scripts don't move.
 *
 *  - db/client.ts          shared pool + drizzle handle (+ `future()` helper) — internal
 *  - db/init.ts            initDb(): connect + migrate + seed (owner, prompts, packs)
 *  - db/users.ts           users, sessions, magic links, BYOK config, plan/quota/credit
 *  - db/profiles.ts        profiles (R24/R36), first impressions (R32), calibrations
 *  - db/interviews.ts      interviews + weaknesses
 *  - db/claims.ts          evidence-gated skill claims (R23)
 *  - db/personalization.ts user events + distilled user model (D2)
 *  - db/models.ts          admin model catalog + per-feature routing (R13/R35)
 *  - db/billing.ts         usage metering + invite codes (D4/D11/R25)
 *  - db/prompts.ts         versioned prompt bodies (D12)
 *  - db/packs.ts           company packs (D10)
 */
export * from './db/init.js'
export * from './db/users.js'
export * from './db/profiles.js'
export * from './db/interviews.js'
export * from './db/claims.js'
export * from './db/personalization.js'
export * from './db/models.js'
export * from './db/billing.js'
export * from './db/admin-log.js'
export * from './db/prompts.js'
export * from './db/packs.js'
