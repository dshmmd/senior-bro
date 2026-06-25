# 2026-06-25 — Phase 11: Postgres + Drizzle (datastore foundation)

Replaced `node:sqlite` with **PostgreSQL in Docker**, data access via **Drizzle ORM**
(D9, Q5/Q7 answered). One DB for local-dev + hosted; scalability north star. This is
the foundation the rest of the re-planning (Phases 12–16) builds on. See
[[2026-06-25-owner-replanning-d9-d15]].

## Infra
- `docker-compose.yml`: `postgres:16-alpine`, host port **5433**→5432, named volume
  `sb_pgdata`, healthcheck. `.env.example` has `DATABASE_URL`.
- Makefile: `db-up` (waits healthy), `db-down`, `db-reset` (drops volume), `db-generate`
  (drizzle-kit), `db-migrate`. `dev`/`start`/`smoke`/`e2e`/`check` all depend on `db-up`.
- CI (`.github/workflows/ci.yml`): a `postgres:16` **service** + `DATABASE_URL` env.

## Data layer
- `server/src/schema.ts`: Drizzle `pgTable` defs for all 9 tables (users, sessions,
  magic_links, profiles, calibrations, interviews, weaknesses, models, usage_events).
  JSON-ish columns stay TEXT (technologies/transcript/questions/result/report); timestamps
  use `mode:'string'` so created_at/finished_at come back as strings (interfaces unchanged).
- `server/drizzle.config.ts` + generated `server/drizzle/0000_init.sql` (committed). The
  server applies pending migrations on boot via `migrate()` (`new URL('../drizzle', import.meta.url)`
  resolves to `server/drizzle` from both `src` and `dist`).
- `server/src/db.ts` fully rewritten onto Drizzle. **All query functions are now async**
  but keep the **same names + snake_case return shapes**, so routes/web didn't change shape.
  `initDb()` connects (pg `Pool`) → migrate → `seed()` (local owner id=1 via
  `onConflictDoNothing` + `setval` to fix the serial sequence; back-fill profiles.user_id;
  import legacy config.json).
- **Async ripple**: `auth.ts` (`requireUser`/`currentUser`/`startSession`/`endSession`),
  `admin.ts` (`requireAdmin`), `index.ts` (`await initDb()`), and every `routes.ts` handler
  + helper (`resolveCall`/`requireCall`/`enforceQuota`/`runModel`/`ownProfile`/`ownInterview`/
  `systemFor`) now `await` db calls. `persist` helpers awaited so writes finish before responding.

## Gotchas hit
- **pg SUM/COUNT return bigint as strings** → cast aggregates in SQL (`::int` / `::float8`)
  so `tokensUsed`/`usageSummary` return real numbers (also satisfies the no-unnecessary-`Number()` lint).
- **drizzle-kit (hoisted to root) couldn't resolve drizzle-orm (nested in server/)** →
  added `drizzle-orm` as a root devDep so the generator resolves it.
- **Playwright starts `webServer` BEFORE `globalSetup`** → DB prep must run before Playwright,
  not in globalSetup. Moved isolation to `e2e/prepare.mjs` (creates+wipes `senior_bro_test`),
  wired as `"e2e": "node e2e/prepare.mjs && playwright test"`; deleted `e2e/global-setup.ts`.
- `CREATE DATABASE` can't run inside a transaction (don't combine with other stmts in one `psql -c`).
- eslint: `server/drizzle.config.ts` → disableTypeChecked block; `e2e/*.mjs` → allowDefaultProject.

## Migration of existing data
- `scripts/import-sqlite.mjs`: legacy `~/.senior-bro/data.db` → Postgres, ids preserved,
  `ON CONFLICT DO NOTHING`, sequences bumped, encrypted `api_key_enc` copied verbatim
  (decrypts because local mode reuses `~/.senior-bro/secret.key`). Ran it: imported the
  owner's 1 profile / 1 interview / 3 weaknesses / 2 calibrations / config.

## Verified
- `make check` (lint+typecheck+build+smoke on PG) green; `make e2e` green (full local flow
  incl. date-driven constellation, on a fresh wiped test DB).
- Hosted curl on a throwaway PG DB: admin promote → create model → user select → calibration
  metered (153+78 tokens, cost ≈ $0.001629) → quota 50 → `200` then `402`. All good.

## Known follow-up
- `cost_usd` is `real` (float) → minor precision drift; fine since billing is token-denominated
  (D11/Q3). Revisit with `numeric` only if real money math needs it.
- Root has a duplicate `drizzle-orm` devDep purely for drizzle-kit resolution (tooling only).
