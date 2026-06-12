import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 'mock' is for tests/dev only — deterministic canned replies, never shown in the UI. */
export type Provider = 'anthropic' | 'openai' | 'mock'

export interface AppConfig {
  provider: Provider
  apiKey: string
  model: string
}

export const DATA_DIR = path.join(os.homedir(), '.senior-bro')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
  mock: 'mock-1',
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadConfig(): AppConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw) as Partial<AppConfig>
    if (!cfg.provider || !cfg.apiKey) return null
    return { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model ?? DEFAULT_MODELS[cfg.provider] }
  } catch {
    return null
  }
}

export function saveConfig(cfg: AppConfig): void {
  ensureDataDir()
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}
