import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/**
 * Drizzle schema (D9 / Phase 11). Mirrors the original node:sqlite tables 1:1 so
 * the rest of the app keeps the same row shapes. JSON-ish columns (technologies,
 * transcript, questions, result, report) stay as TEXT holding JSON strings — db.ts
 * parses/stringifies them, exactly as before. Timestamps use `mode: 'string'` so
 * created_at/finished_at come back as strings (matching the existing interfaces).
 *
 * Phase 12 (D14) added real foreign keys + lookup indexes so per-user ownership is
 * enforced at the database, not just the route guards. `onDelete` is chosen per edge:
 * child rows that only make sense under a parent cascade; historical/optional links
 * (usage events' model, a weakness' source interview) null out instead of blocking.
 */
const createdAt = () => timestamp('created_at', { mode: 'string' }).notNull().defaultNow()

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique(),
  role: text('role').notNull().default('user'),
  provider: text('provider'),
  model: text('model'),
  apiKeyEnc: text('api_key_enc'),
  // The currently-selected curated model; nulled (not blocked) if that model is deleted.
  modelId: integer('model_id').references(() => models.id, { onDelete: 'set null' }),
  // Plan & entitlement (D11 / Phase 13). 'free-intro' = level-check only; 'host' = paid host
  // models (token_quota is the credit allowance); 'byok'/'local' = free. Local owner = 'local'.
  plan: text('plan').notNull().default('free-intro'),
  tokenQuota: integer('token_quota'),
  // The profile the user is currently working in (R24). Null → fall back to their latest.
  // The `: AnyPgColumn` return annotation breaks the users↔profiles circular-FK type cycle
  // (without it, Drizzle's inference collapses both tables to `any`).
  activeProfileId: integer('active_profile_id').references((): AnyPgColumn => profiles.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
})

export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export const magicLinks = pgTable('magic_links', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: createdAt(),
})

export const profiles = pgTable(
  'profiles',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    company: text('company'),
    skillPack: text('skill_pack'),
    technologies: text('technologies').notNull().default('[]'),
    yearsExperience: integer('years_experience').notNull().default(0),
    notes: text('notes'),
    level: text('level'),
    levelSummary: text('level_summary'),
    createdAt: createdAt(),
  },
  (t) => [index('profiles_user_id_idx').on(t.userId)],
)

export const calibrations = pgTable(
  'calibrations',
  {
    id: serial('id').primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    questions: text('questions').notNull(),
    result: text('result'),
    createdAt: createdAt(),
  },
  (t) => [index('calibrations_profile_id_idx').on(t.profileId)],
)

export const interviews = pgTable(
  'interviews',
  {
    id: serial('id').primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('text'),
    kind: text('kind').notNull().default('full'),
    status: text('status').notNull().default('active'),
    transcript: text('transcript').notNull().default('[]'),
    report: text('report'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { mode: 'string' }),
  },
  (t) => [index('interviews_profile_id_idx').on(t.profileId)],
)

export const weaknesses = pgTable(
  'weaknesses',
  {
    id: serial('id').primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    fix: text('fix').notNull().default(''),
    status: text('status').notNull().default('open'),
    sourceInterviewId: integer('source_interview_id').references(() => interviews.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('weaknesses_profile_id_idx').on(t.profileId)],
)

export const models = pgTable('models', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  apiKeyEnc: text('api_key_enc'),
  enabled: boolean('enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  priceIn: real('price_in').notNull().default(0),
  priceOut: real('price_out').notNull().default(0),
  createdAt: createdAt(),
})

export const usageEvents = pgTable(
  'usage_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Keep historical usage even if the catalog model is later removed.
    modelId: integer('model_id').references(() => models.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('usage_events_user_id_idx').on(t.userId)],
)

// Admin-minted invite codes (D11 / Phase 13). Each carries a token-denominated credit
// (Q3); redeeming adds it to the redeemer's quota and upgrades them to the 'host' plan.
// Single-use: `redeemedBy`/`redeemedAt` are set once; `revoked` blocks an unused code.
export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  tokenCredit: integer('token_credit').notNull(),
  note: text('note'),
  revoked: boolean('revoked').notNull().default(false),
  redeemedBy: integer('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
  redeemedAt: timestamp('redeemed_at', { mode: 'string' }),
  expiresAt: timestamp('expires_at', { mode: 'string' }),
  createdAt: createdAt(),
})
