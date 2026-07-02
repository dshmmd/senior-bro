/**
 * Interview domains (R33 / R34 / D22). A "domain" is the *subject matter* of a full interview —
 * technical (today's flow) or HR/behavioral (culture-fit) — as opposed to `interviews.kind`, which
 * is the lifecycle (`full`/`coaching`). Each domain is a registry entry, so shipping a new one
 * (e.g. `product`, `leadership`) is a row here + a seed prompt, never a code branch rewrite.
 *
 * Each domain maps to:
 *  - `promptKey`: its versioned system prompt (rides the D12 prompt infra). Technical reuses the
 *    original `interview.system` key so existing admin edits/versions are preserved untouched; new
 *    domains get their own key (`interview.hr.system`).
 *  - `feature`: its per-feature model-routing key (R35). Unassigned → global default.
 */
import type { FeatureKey } from './features.js'
import type { PromptKey } from './prompts.js'

export type DomainKey = 'technical' | 'hr'

export interface DomainDef {
  key: DomainKey
  label: string
  blurb: string
  promptKey: PromptKey
  feature: FeatureKey
}

export const DOMAINS: readonly DomainDef[] = [
  {
    key: 'technical',
    label: 'Technical',
    blurb: 'Coding, system design, and deep technical questions.',
    promptKey: 'interview.system',
    feature: 'interview.technical',
  },
  {
    key: 'hr',
    label: 'HR / Behavioral',
    blurb: 'Culture fit, motivation, teamwork, and handling conflict.',
    promptKey: 'interview.hr.system',
    feature: 'interview.hr',
  },
] as const

export const DOMAIN_KEYS: readonly DomainKey[] = DOMAINS.map((d) => d.key)

export const isDomainKey = (k: string): k is DomainKey => (DOMAIN_KEYS as readonly string[]).includes(k)

export function domainDef(key: string): DomainDef {
  return DOMAINS.find((d) => d.key === key) ?? DOMAINS[0]!
}

/**
 * HR "general behavioral" question pool (R33). A session samples a random subset of these (see
 * `sampleHrTopics`) so no two HR interviews feel identical, while the fixed opening/closing and the
 * company-values pool (drawn from the target's company pack) stay outside this list.
 */
export const HR_GENERAL_TOPICS: readonly string[] = [
  'A time you had a conflict with a coworker and how you resolved it',
  'A project you led end-to-end and what the outcome was',
  'A significant failure or mistake and what you learned from it',
  'How you handle competing priorities and tight deadlines',
  'A time you gave or received difficult feedback',
  'Adapting to a major change in direction, team, or scope',
  'What motivates you and what kind of work energizes you',
  'Working with a difficult stakeholder, manager, or customer',
  'A time you disagreed with a decision and what you did about it',
  'Going above and beyond for a teammate or a customer',
  'How you operate when the problem is ambiguous and under-defined',
  'A time you mentored someone or helped a peer grow',
] as const

/** How many general topics an HR session draws. */
export const HR_TOPIC_SAMPLE = 5

/**
 * Deterministically sample `count` general HR topics using a seed (the interview id). Deterministic
 * so the same interview yields the same set every turn (and after resume) — `systemFor` rebuilds the
 * prompt on every message, and a re-shuffle each time would swap the questions mid-interview.
 */
export function sampleHrTopics(seed: number, count = HR_TOPIC_SAMPLE): string[] {
  const pool = [...HR_GENERAL_TOPICS]
  // Mulberry32-style seeded PRNG → Fisher–Yates shuffle. Small, dependency-free, stable.
  let s = seed >>> 0 || 1
  const rand = () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool.slice(0, Math.min(count, pool.length))
}
