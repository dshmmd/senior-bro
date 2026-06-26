import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Providers:
 * - anthropic / openai : bring-your-own API key (pay-as-you-go credits).
 * - claude-cli / codex-cli : use the local, already-logged-in CLI, which bills the
 *   user's *subscription* (Claude Pro/Max, ChatGPT/Codex) instead of API credits.
 *   No API key needed. Local mode only — the CLI runs on the user's own machine.
 * - arvan : ArvanCloud AIaaS (D19) — OpenAI-compatible body/response, but the endpoint is a
 *   per-model gateway URL (token in the path → stored as `baseUrl`) and auth is `apikey <key>`,
 *   not `Bearer`. Reuses the OpenAI-compatible request path; a host (admin-curated) provider.
 * - mock : deterministic canned replies for tests/dev. Never shown in the UI.
 */
export type Provider = 'anthropic' | 'openai' | 'arvan' | 'claude-cli' | 'codex-cli' | 'mock'

/** Providers that authenticate via a local CLI subscription rather than an API key. */
export const CLI_PROVIDERS: Provider[] = ['claude-cli', 'codex-cli']
export const isCliProvider = (p: Provider): boolean => CLI_PROVIDERS.includes(p)

export interface AppConfig {
  provider: Provider
  apiKey: string // '' for CLI providers
  model: string // '' means "let the CLI/subscription pick its default"
  // OpenAI-compatible custom endpoint (D19, Arvan): everything up to `/v1` (the per-model
  // gateway token lives in this path); `/chat/completions` is appended at call time.
  baseUrl?: string
}

export const DATA_DIR = path.join(os.homedir(), '.senior-bro')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
  arvan: '', // the admin enters the exact Arvan body-model id (e.g. 'Claude-Haiku-4-5-006zc')
  'claude-cli': '', // CLI default (whatever the subscription affords)
  'codex-cli': '',
  mock: 'mock-1',
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadConfig(): AppConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw) as Partial<AppConfig>
    if (!cfg.provider) return null
    // API-key providers require a key; CLI providers don't.
    if (!isCliProvider(cfg.provider) && !cfg.apiKey) return null
    return {
      provider: cfg.provider,
      apiKey: cfg.apiKey ?? '',
      model: cfg.model ?? DEFAULT_MODELS[cfg.provider],
    }
  } catch {
    return null
  }
}

export function saveConfig(cfg: AppConfig): void {
  ensureDataDir()
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}
