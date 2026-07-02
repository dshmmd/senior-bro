/**
 * Capability tiers (D3 / Phase 4). Different models — a $5 Haiku/Mini key, a mid Sonnet/4o key, an
 * Opus/GPT-5 key — have very different ceilings. To keep the SAME UX promise across them (no silent
 * quality cliff), we classify a model into one of three tiers once and then size token budgets +
 * inject a short prompt "model note" per tier, so a small model is nudged to stay tight and complete
 * while a strong one is invited to probe deeper — both within the same structure and reply limits.
 *
 * Tier is resolved as: the stored (probed) tier if present, else a name-based classification. The
 * one-shot probe (below) can only *downgrade* a capable-looking name to `fast` when the model fails a
 * trivial strict-JSON instruction-following check — so a mislabeled/limited endpoint is caught.
 */
import { chat, extractJson, type ChatMessage } from './providers.js'
import type { AppConfig } from './config.js'

export type Tier = 'fast' | 'standard' | 'deep'

export interface TierSpec {
  label: string
  /** max_tokens for the conversational interview/coaching turns. */
  interviewMax: number
  /** max_tokens for the end-of-interview evaluation (strict JSON). */
  evalMax: number
  /** Extra guidance appended inside the interview/coaching brief (empty for the neutral tier). */
  guidance: string
}

export const TIERS: Record<Tier, TierSpec> = {
  fast: {
    label: 'Fast',
    interviewMax: 1200,
    evalMax: 3500,
    guidance:
      '\n\nMODEL NOTE: you are a smaller/faster model. Compensate with discipline — one focused question at a time, tight and concrete, no rambling. Always finish the required output completely: never omit the [INTERVIEW_COMPLETE] token when wrapping up, and keep any JSON valid and closed.',
  },
  standard: { label: 'Standard', interviewMax: 4096, evalMax: 8192, guidance: '' },
  deep: {
    label: 'Deep',
    interviewMax: 4096,
    evalMax: 8192,
    guidance:
      '\n\nMODEL NOTE: you are a strong model. Use it to probe depth, edge cases and nuance in follow-ups — but keep the same one-question-at-a-time structure and reply-length limits.',
  },
}

export const isTier = (v: unknown): v is Tier => v === 'fast' || v === 'standard' || v === 'deep'

// Name heuristics — small/cheap families vs. flagship/deep-reasoning families. Order matters:
// a fast marker wins (e.g. "gpt-4o-mini" is fast, not standard).
const FAST = /(haiku|mini|flash|nano|lite|small|instant|gemma|phi|[-_ ](1|1\.5|3|7|8)b)\b/i
const DEEP = /(opus|o1|o3|gpt-5|ultra|deep|reason|[-_ ](70|72|405)b)\b/i

/** Classify a model by name alone (the fallback + the ceiling the probe may lower to `fast`). */
export function classifyByName(model: string): Tier {
  const m = model.toLowerCase()
  if (FAST.test(m)) return 'fast'
  if (DEEP.test(m)) return 'deep'
  return 'standard'
}

/**
 * Probe a configured model once. Starts from the name classification, then runs a trivial
 * strict-JSON instruction-following check: if the model can't return `{"ok":true,"n":3}`, it's
 * treated as `fast` regardless of name. A network/other failure trusts the name (can't tell).
 */
export async function probeTier(cfg: AppConfig): Promise<Tier> {
  const named = classifyByName(cfg.model)
  try {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Return exactly {"ok": true, "n": 3} and nothing else.' },
    ]
    const { text } = await chat(
      cfg,
      'You are a capability probe. Respond with ONLY strict JSON.',
      messages,
      64,
    )
    const parsed = extractJson<{ ok?: unknown; n?: unknown }>(text)
    const passed = parsed.ok === true && parsed.n === 3
    return passed ? named : 'fast'
  } catch {
    return named
  }
}
