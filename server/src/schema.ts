import { boolean, integer, pgTable, real, serial, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Drizzle schema (D9 / Phase 11). Mirrors the original node:sqlite tables 1:1 so
 * the rest of the app keeps the same row shapes. JSON-ish columns (technologies,
 * transcript, questions, result, report) stay as TEXT holding JSON strings — db.ts
 * parses/stringifies them, exactly as before. Timestamps use `mode: 'string'` so
 * created_at/finished_at come back as strings (matching the existing interfaces).
 */
const createdAt = () => timestamp('created_at', { mode: 'string' }).notNull().defaultNow()

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique(),
  role: text('role').notNull().default('user'),
  provider: text('provider'),
  model: text('model'),
  apiKeyEnc: text('api_key_enc'),
  modelId: integer('model_id'),
  tokenQuota: integer('token_quota'),
  createdAt: createdAt(),
})

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id').notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
})

export const magicLinks = pgTable('magic_links', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: createdAt(),
})

export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  role: text('role').notNull(),
  company: text('company'),
  skillPack: text('skill_pack'),
  technologies: text('technologies').notNull().default('[]'),
  yearsExperience: integer('years_experience').notNull().default(0),
  notes: text('notes'),
  level: text('level'),
  levelSummary: text('level_summary'),
  createdAt: createdAt(),
})

export const calibrations = pgTable('calibrations', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull(),
  questions: text('questions').notNull(),
  result: text('result'),
  createdAt: createdAt(),
})

export const interviews = pgTable('interviews', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull(),
  mode: text('mode').notNull().default('text'),
  kind: text('kind').notNull().default('full'),
  status: text('status').notNull().default('active'),
  transcript: text('transcript').notNull().default('[]'),
  report: text('report'),
  createdAt: createdAt(),
  finishedAt: timestamp('finished_at', { mode: 'string' }),
})

export const weaknesses = pgTable('weaknesses', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  fix: text('fix').notNull().default(''),
  status: text('status').notNull().default('open'),
  sourceInterviewId: integer('source_interview_id'),
  createdAt: createdAt(),
})

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

export const usageEvents = pgTable('usage_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  modelId: integer('model_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: createdAt(),
})
