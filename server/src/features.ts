/**
 * Per-feature model routing registry (R35 / D23). Each "feature" is a distinct kind of model
 * call the platform funds; an admin may assign a specific curated model to each (mirrors the D12
 * versioned-prompt `prompt_key` pattern), so cheap/fast models can power cheap actions and stronger
 * models the ones where quality matters. An unassigned feature falls back to the single global
 * default model (`models.is_default`), so existing behavior needs zero admin action.
 *
 * Routing applies only to platform-funded calls (free-intro onboarding + a host user's curated
 * model). It never overrides a BYOK user's own key — that's their key and their cost.
 *
 * Keep this list to features that are actually wired to a call site (no dead admin knobs). New
 * interview kinds (e.g. `interview.hr`, Phase 24) add a row here when they land.
 */
export interface FeatureDef {
  key: string
  label: string
  hint: string
}

export const FEATURES: readonly FeatureDef[] = [
  {
    key: 'resume.parse',
    label: 'Résumé parsing',
    hint: 'Extract a profile from an uploaded CV (onboarding).',
  },
  { key: 'calibration', label: 'Calibration quiz', hint: 'Generate + grade the free level-check questions.' },
  {
    key: 'company.pack',
    label: 'Company pack research',
    hint: 'Draft an interview pack for a target company.',
  },
  {
    key: 'interview.technical',
    label: 'Technical interview',
    hint: 'Run + evaluate the technical mock interview.',
  },
  {
    key: 'interview.hr',
    label: 'HR / behavioral interview',
    hint: 'Run + evaluate the HR/behavioral mock interview (Phase 24).',
  },
  {
    key: 'personalization.distill',
    label: 'User-model distillation',
    hint: 'Summarize what we know about the candidate after each interview.',
  },
  {
    key: 'resume.improve',
    label: 'Résumé improvement',
    hint: 'Suggest résumé improvements from interview evidence (Phase 5).',
  },
  {
    key: 'opportunity.discover',
    label: 'Opportunity discovery',
    hint: 'Find + match-score live job openings for the candidate (Phase 5).',
  },
  {
    key: 'study.plan',
    label: 'Study plan',
    hint: 'Build a post-interview study plan from the candidate’s gaps (Phase 7).',
  },
  {
    key: 'voice.transcribe',
    label: 'Voice transcription',
    hint:
      'Server-side speech-to-text for voice interviews (R30). Must be a transcription-capable ' +
      'model (e.g. GPT-4o-Transcribe), not a chat model — unassigned falls back to the browser’s ' +
      'built-in dictation instead of a global default.',
  },
] as const

export type FeatureKey = (typeof FEATURES)[number]['key']

export const FEATURE_KEYS: readonly string[] = FEATURES.map((f) => f.key)

export const isFeatureKey = (k: string): k is FeatureKey => FEATURE_KEYS.includes(k)
