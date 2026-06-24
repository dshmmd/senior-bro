/**
 * Deployment mode. The same codebase runs two ways:
 *
 * - `local`  (default): single-user, no auth. The machine owner is an implicit
 *   user (id = LOCAL_USER_ID). This preserves the v0.x behavior exactly — no
 *   login screen, config lives where it always did. CLI subscription providers
 *   (claude-cli/codex-cli) are allowed because the CLI runs on the owner's box.
 * - `hosted`: multi-user. Magic-link email accounts, session cookies, per-user
 *   data isolation and per-user encrypted provider keys. CLI subscription
 *   providers are rejected (we can't proxy a customer's login — see D8).
 *
 * Toggle with `SENIORBRO_MODE=hosted`.
 */
export type Mode = 'local' | 'hosted'

export const MODE: Mode = process.env.SENIORBRO_MODE === 'hosted' ? 'hosted' : 'local'
export const isHosted = MODE === 'hosted'
export const isLocal = MODE === 'local'

/** The implicit owner in local mode; also the seed admin user. */
export const LOCAL_USER_ID = 1
