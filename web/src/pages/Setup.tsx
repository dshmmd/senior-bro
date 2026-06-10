import { useState } from 'react'
import { api } from '../api'

const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    hint: 'Recommended. Get a key at console.anthropic.com → API Keys.',
    defaultModel: 'claude-opus-4-8',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    hint: 'Get a key at platform.openai.com → API Keys.',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
]

export function Setup({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = useState(PROVIDERS[0]!)
  const [model, setModel] = useState(PROVIDERS[0]!.defaultModel)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api.saveConfig(provider.id, apiKey, model)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Welcome 👋</h1>
      <p className="sub">
        Senior Bro runs entirely on your machine and uses <b>your own AI key</b>. Nothing is sent
        anywhere except directly to the AI provider you choose.
      </p>

      <h2>1. Pick your AI provider</h2>
      <div className="row">
        {PROVIDERS.map((p) => (
          <div
            key={p.id}
            className="card clickable"
            style={{ flex: 1, borderColor: provider.id === p.id ? 'var(--accent)' : undefined }}
            onClick={() => {
              setProvider(p)
              setModel(p.defaultModel)
            }}
          >
            <b>{p.name}</b>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{p.hint}</div>
          </div>
        ))}
      </div>

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
          <button disabled={busy || apiKey.trim().length < 8} onClick={() => void save()}>
            {busy ? 'Validating key…' : 'Save & continue →'}
          </button>
        </div>
      </div>
    </>
  )
}
