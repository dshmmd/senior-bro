import { useState } from 'react'
import { api } from '../api'

interface ProviderOption {
  id: string
  name: string
  hint: string
  kind: 'key' | 'cli'
  defaultModel: string
  models: string[]
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'claude-cli',
    name: 'Claude subscription (no API key)',
    hint: 'Use your Claude Pro/Max plan via the local `claude` CLI. Free with your subscription — no API credits needed.',
    kind: 'cli',
    defaultModel: '',
    models: ['', 'sonnet', 'opus', 'haiku'],
  },
  {
    id: 'codex-cli',
    name: 'ChatGPT/Codex subscription (no API key)',
    hint: 'Use your ChatGPT/Codex plan via the local `codex` CLI. Free with your subscription.',
    kind: 'cli',
    defaultModel: '',
    models: ['', 'gpt-5', 'gpt-5-codex'],
  },
  {
    id: 'anthropic',
    name: 'Claude API key',
    hint: 'Pay-as-you-go. Get a key at console.anthropic.com → API Keys.',
    kind: 'key',
    defaultModel: 'claude-opus-4-8',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    name: 'OpenAI API key',
    hint: 'Pay-as-you-go. Get a key at platform.openai.com → API Keys.',
    kind: 'key',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
]

export function Setup({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = useState<ProviderOption>(PROVIDERS[0]!)
  const [model, setModel] = useState(PROVIDERS[0]!.defaultModel)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isCli = provider.kind === 'cli'

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api.saveConfig(provider.id, isCli ? '' : apiKey, model)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const canSave = isCli || apiKey.trim().length >= 8

  return (
    <>
      <h1>Welcome 👋</h1>
      <p className="sub">
        Senior Bro runs entirely on your machine. Use a subscription you already pay for — no API credits
        required — or bring your own API key. Nothing leaves your machine except the calls to your chosen AI.
      </p>

      <h2>1. How do you want to power it?</h2>
      <div className="provider-grid">
        {PROVIDERS.map((p) => (
          <div
            key={p.id}
            className="card clickable"
            style={{ borderColor: provider.id === p.id ? 'var(--accent)' : undefined }}
            onClick={() => {
              setProvider(p)
              setModel(p.defaultModel)
              setError('')
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <b>{p.name}</b>
              {p.kind === 'cli' && <span className="badge resolved">no key</span>}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{p.hint}</div>
          </div>
        ))}
      </div>

      {isCli ? (
        <>
          <h2>2. Make sure you're signed in</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              In a terminal, run <code>{provider.id === 'claude-cli' ? 'claude' : 'codex'}</code> once and
              sign in with your subscription. Then come back here — Senior Bro will use that login. No API key
              is stored or required.
            </p>
            <label>Model (optional — leave as default to let your subscription choose)</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {provider.models.map((m) => (
                <option key={m} value={m}>
                  {m === '' ? 'Subscription default' : m}
                </option>
              ))}
            </select>
            {error && <div className="error">{error}</div>}
            <div className="mt">
              <button disabled={busy} onClick={() => void save()}>
                {busy ? 'Checking your CLI…' : 'Connect & continue →'}
              </button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 12 }}>
              The first check can take 10–30s while the CLI warms up.
            </p>
          </div>
        </>
      ) : (
        <>
          <h2>2. Paste your API key</h2>
          <div className="card">
            <label>API key (stored only in ~/.senior-bro/config.json on your machine)</label>
            <input
              type="password"
              value={apiKey}
              placeholder={provider.id === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {provider.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            {error && <div className="error">{error}</div>}
            <div className="mt">
              <button disabled={busy || !canSave} onClick={() => void save()}>
                {busy ? 'Validating key…' : 'Save & continue →'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
