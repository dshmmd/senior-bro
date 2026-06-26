import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
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

// Evidence-gated skill claims (R23 / Phase 17). Every skill the candidate self-reports starts
// as an `unverified` claim; an interview evaluation that finds evidence flips it to
// `demonstrated` or `weak`. The profile/level reflect *shown* ability, not self-report — so the
// interviewer is told to probe unverified claims rather than take them as fact. Unique per
// (profile, skill) so re-stating a skill upserts instead of duplicating.
export const skillClaims = pgTable(
  'skill_claims',
  {
    id: serial('id').primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    skill: text('skill').notNull(),
    // 'unverified' (claimed, not yet shown) | 'demonstrated' (shown in an interview) | 'weak'.
    status: text('status').notNull().default('unverified'),
    evidence: text('evidence'),
    sourceInterviewId: integer('source_interview_id').references(() => interviews.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('skill_claims_profile_skill_idx').on(t.profileId, t.skill)],
)

// Personalization engine (D2 / Phase 4). Per-profile, because the interviewer prompt, weaknesses
// and skill claims are all per-profile — a learner's model for a "Senior Backend @ Stripe" target
// differs from a "PM" one. `user_events` is the append-only activity log the distiller reads;
// `user_models` is the single LLM-distilled (or user-corrected) document injected into prompts so
// the coach "knows the candidate" (D2), and which the user can read/correct/delete (D6).
export const userEvents = pgTable(
  'user_events',
  {
    id: serial('id').primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    // e.g. 'profile_created' | 'calibration' | 'interview_started' | 'interview_finished' | 'preference'.
    kind: text('kind').notNull(),
    detail: text('detail').notNull().default(''),
    // Optional link to the interview the event happened in (preferences, lifecycle); nulls out if dropped.
    interviewId: integer('interview_id').references(() => interviews.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('user_events_profile_id_idx').on(t.profileId)],
)

export const userModels = pgTable('user_models', {
  // One model per profile → profile id is the primary key (1:1).
  profileId: integer('profile_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull().default(''),
  // True once the user hand-edits their model (vs. an LLM distillation); reset on the next distill,
  // which merges the correction in (the prior body is fed back to the distiller).
  edited: boolean('edited').notNull().default(false),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
})

export const models = pgTable('models', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  // OpenAI-compatible custom endpoint base (D19, Arvan): the per-model gateway URL up to `/v1`.
  baseUrl: text('base_url'),
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

// Admin-managed, versioned system prompts (D12 / Phase 14). Each `promptKey`
// (e.g. 'interview.system') has many rows — one per saved version. Exactly one row
// per key is `active`; rendering reads the active body. Code ships a seed version
// (author 'seed', version 1); admins add versions in the UI and can roll back by
// re-activating an older one. The fixed guardrail frame lives in code, NOT here —
// admins edit only the body that sits *inside* the frame (D13).
export const prompts = pgTable(
  'prompts',
  {
    id: serial('id').primaryKey(),
    promptKey: text('prompt_key').notNull(),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    author: text('author').notNull().default('seed'),
    active: boolean('active').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index('prompts_key_idx').on(table.promptKey)],
)

// Dynamic company interview packs (D10 / Phase 15). Replaces the "one company = one
// hand-written file" model: when a user names a company we don't have, the model drafts
// a pack (web-search-augmented on capable providers) and we cache it here, reused across
// all users. The 4 static `skills/*.md` are seeded in as `source: 'seed'`. `slug` is the
// normalized company name (lowercased alnum) so "Stripe"/"stripe Inc" hit the same row.
// Admins review/edit/publish/regenerate; `status` gates which packs onboarding offers.
export const companyPacks = pgTable(
  'company_packs',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    company: text('company').notNull(),
    roles: text('roles').notNull().default('[]'),
    summary: text('summary').notNull().default(''),
    body: text('body').notNull(),
    // 'published' = usable in onboarding/interviews; 'draft' = admin-only; 'archived' = hidden.
    status: text('status').notNull().default('published'),
    // 'seed' = shipped markdown; 'generated' = model-drafted on demand.
    source: text('source').notNull().default('generated'),
    // Provenance for generated packs: which model drafted it + whether live search was used.
    model: text('model'),
    searched: boolean('searched').notNull().default(false),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  },
  (table) => [index('company_packs_status_idx').on(table.status)],
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
