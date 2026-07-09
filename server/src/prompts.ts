/**
 * Prompt ops (D12 / Phase 14) — barrel over the split modules (RF-3 slice 2):
 *
 *  - `prompts/seeds.ts`     the seed bodies (`PROMPT_SEEDS`) — the default versions code
 *                           ships; admins edit live versions in the DB (admin UI).
 *  - `prompts/guardrail.ts` the fixed, non-editable guardrail frame (`wrapGuardrail`, D13).
 *  - `prompts/render.ts`    pure `render*` fillers: active body (from `db.activePromptBody`)
 *                           + dynamic data → final prompt. Code-injected blocks (claims R23,
 *                           user-model D2, teaching Phase 7) apply on every prompt version.
 *
 * Import path is unchanged (`./prompts.js`) so routes/services/tests don't move.
 */
export * from './prompts/seeds.js'
export * from './prompts/guardrail.js'
export * from './prompts/render.js'
