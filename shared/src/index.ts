/**
 * The API contract (RF-4): one source of truth for the shapes the server sends and
 * the web client consumes. The server pins its responses with `satisfies` on the
 * high-drift surfaces; `web/src/api.ts` imports (and re-exports) these types.
 *
 * Rule: a field only belongs here if the server actually sends it. The server may
 * send a superset (extra fields pass `satisfies` on non-literals), but anything the
 * web *reads* must be declared here — changing a shape unilaterally on either side
 * breaks `npm run typecheck`.
 */

// ── core domain ───────────────────────────────────────────────────────

export type PlanKind = 'free-intro' | 'host' | 'byok' | 'local'
export type InterviewDomain = 'technical' | 'hr'
export type InterviewMode = 'voice' | 'text'
export type InterviewKind = 'full' | 'coaching'

export interface SkillPackSummary {
  id: string
  company: string
  roles: string[]
  summary: string
  source: 'seed' | 'generated' | 'tier'
}

export interface SkillClaim {
  id: number
  skill: string
  status: 'unverified' | 'demonstrated' | 'weak'
  evidence: string | null
  source_interview_id: number | null
}

export interface Profile {
  id: number
  role: string
  company: string | null
  skill_pack: string | null
  technologies: string[]
  years_experience: number
  notes: string | null
  level: string | null
  level_summary: string | null
  weaknesses?: Weakness[]
  skill_claims?: SkillClaim[]
}

export interface ProfileListItem {
  id: number
  role: string
  company: string | null
  level: string | null
}

export interface Weakness {
  id: number
  title: string
  detail: string
  fix: string
  status: 'open' | 'improving' | 'resolved'
}

export interface InterviewReport {
  overall_score: number
  level_estimate: string
  dimensions: { name: string; score: number; comment: string }[]
  strengths: string[]
  weaknesses: { title: string; detail: string; fix: string }[]
  advice: string
}

export interface InterviewSummary {
  id: number
  mode: InterviewMode
  kind: InterviewKind
  domain: InterviewDomain
  status: 'active' | 'finished'
  created_at: string
  turns: number
  overall_score: number | null
  level_estimate: string | null
}

export interface InterviewDetail {
  id: number
  profile_id: number
  mode: InterviewMode
  kind: InterviewKind
  domain: InterviewDomain
  status: 'active' | 'finished'
  transcript: { role: 'user' | 'assistant'; content: string }[]
  report: InterviewReport | null
  created_at: string
  finished_at: string | null
}

// ── gamification (D7 / R34) ───────────────────────────────────────────

export interface DimensionProgress {
  name: string
  best: number
  avg: number
  count: number
  lit: number
  crystallized: boolean
}

export interface Medal {
  id: string
  title: string
  icon: string
  detail: string
  earned: boolean
}

export interface Progress {
  interviews_total: number
  dimensions: DimensionProgress[]
  weaknesses: { open: number; improving: number; resolved: number; total: number; items: Weakness[] }
  streak: { current: number; longest: number; days: { date: string; count: number }[] }
  level_trail: { label: string; reached: boolean; current: boolean }[]
  medals: Medal[]
  overall_completion: number
}

/** One interview domain's constellation (R34). Only unlocked domains (≥1 finished interview) appear. */
export interface DomainProgress {
  domain: InterviewDomain
  label: string
  progress: Progress
}

export interface ProgressResponse {
  domains: DomainProgress[]
}

// ── personalization (D2 / D6) ─────────────────────────────────────────

export interface UserEvent {
  id: number
  profile_id: number
  kind: string
  detail: string
  interview_id: number | null
  created_at: string
}

export interface UserModelInfo {
  profile: { id: number; role: string; company: string | null; level: string | null }
  summary: string
  edited: boolean
  updated_at: string | null
  events: UserEvent[]
}

// ── career tools (Phase 5) + study plan (Phase 7) ─────────────────────

export interface ResumeSuggestion {
  area: string
  insight: string
  suggested_bullet: string
}
export interface ResumeReview {
  summary: string
  suggestions: ResumeSuggestion[]
}
export interface Opportunity {
  title: string
  company: string
  location: string
  match_score: number
  why: string
  url: string | null
}

export interface StudyPlanItem {
  topic: string
  focus: string
  practice: string
  weakness_id: number | null
}
export interface StudyPlan {
  overview: string
  items: StudyPlanItem[]
}

// ── health, models, usage, plans ──────────────────────────────────────

export interface Health {
  ok: boolean
  mode: 'local' | 'hosted'
  authed: boolean
  user: { email: string | null; role: 'user' | 'admin' } | null
  plan: PlanKind | null
  configured: boolean
  has_model: boolean
  credit_left: number | null
  first_impressions_used: number
  first_impressions_limit: number
  interview_ready: boolean
}

export interface ModelOption {
  id: number
  label: string
  provider: string
  model: string
  base_url: string | null
  enabled: boolean
  is_default: boolean
  price_in: number
  price_out: number
  has_key: boolean
  capability_tier: string | null
}

export interface UsageInfo {
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    cost_usd: number
    events: number
  }
  plan: PlanKind
  token_quota: number | null
  tokens_used: number
  credit_left: number | null
  first_impressions_used: number
  first_impressions_limit: number
  capability_tier: string | null
}

// ── admin console ─────────────────────────────────────────────────────

export interface InviteCode {
  code: string
  token_credit: number
  note: string | null
  revoked: boolean
  redeemed_by: number | null
  redeemed_at: string | null
  expires_at: string | null
  created_at: string
}

export interface FeatureDef {
  key: string
  label: string
  hint: string
}

export interface PromptCatalogEntry {
  key: string
  label: string
  description: string
  placeholders: string[]
  guardrailed: boolean
  active_version: number | null
  version_count: number
}

export interface PromptVersion {
  id: number
  prompt_key: string
  version: number
  body: string
  author: string
  active: boolean
  created_at: string
}

export interface CompanyPack {
  id: number
  slug: string
  company: string
  roles: string[]
  summary: string
  body: string
  status: 'published' | 'draft' | 'archived'
  source: 'seed' | 'generated' | 'tier'
  model: string | null
  searched: boolean
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface AdminUserRow {
  id: number
  email: string | null
  role: 'user' | 'admin'
  plan: PlanKind
  suspended: boolean
  model_id: number | null
  token_quota: number | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  events: number
}

/** A feature's routing row (R35) + kill switch (RF-9). */
export interface FeatureAssignment {
  model_id: number | null
  disabled: boolean
}

/** One metered model call, admin-auditable (RF-9 / R25). */
export interface UsageEventRow {
  id: number
  user_id: number
  email: string | null
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  created_at: string
}

/** One admin action in the audit log (RF-9 / R26). */
export interface AdminEvent {
  id: number
  admin_id: number | null
  admin_email: string | null
  action: string
  detail: string
  created_at: string
}
