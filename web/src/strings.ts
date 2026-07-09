// User-facing vocabulary (RF-7) — the i18n seam. A deployment ships ONE locale
// (owner decision: EN or FA per deploy, never both at runtime); translating means
// swapping this module (and later a matching theme), not hunting strings in JSX.
//
// House rules (REFACTOR.md §3.2): no "token", "model", "provider", "BYOK",
// "calibration" or other engineer-vocabulary outside the Admin console. Users buy
// and spend **practice interviews**; the level check is a **placement chat**.

/** Translate a raw token amount into the user-facing "≈ N practice interviews". */
export function interviewsFor(tokens: number, perInterview: number): number {
  return Math.max(0, Math.floor(tokens / Math.max(1, perInterview)))
}

/** "≈ 20 practice interviews" (or a friendly zero). */
export function interviewsLabel(tokens: number, perInterview: number): string {
  const n = interviewsFor(tokens, perInterview)
  if (n === 0) return 'less than 1 practice interview'
  return `≈ ${n} practice interview${n === 1 ? '' : 's'}`
}

/** Plain-language capability tiers (D3) — quality-vs-cost words, not ML jargon. */
export const TIER_LABELS: Record<string, { label: string; hint: string }> = {
  fast: { label: 'Quick', hint: 'Fastest and cheapest — great for warm-ups' },
  standard: { label: 'Balanced', hint: 'Solid quality at a fair price' },
  deep: { label: 'Deepest', hint: 'The most thorough interviewer we offer' },
}

/** Rough $ cost of one practice interview on a given per-Mtok price pair. */
export function costPerInterview(priceIn: number, priceOut: number, perInterview: number): number {
  // A session is roughly 70% input (prompt + history) / 30% output.
  return (perInterview * (0.7 * priceIn + 0.3 * priceOut)) / 1_000_000
}
