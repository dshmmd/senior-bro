import { useEffect, useState } from 'react'
import { api, type ModelOption } from '../api'

interface ProviderOption {
  id: string
  name: string
  hint: string
  kind: 'key' | 'cli'
  defaultModel: string
  models: string[]
}

// Bring-your-own-API-key is retired — hosted users run on provided models (metered against their
// balance); local users use a subscription CLI they already pay for. Only the CLI options remain,
// and they're local-only (a hosted deploy can't proxy a customer's personal CLI login — D8).
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
]

export function Setup({ onDone, hosted = false }: { onDone: () => void; hosted?: boolean }) {
  // Hosted users can't proxy a personal CLI subscription (D8), and BYOK is retired — so hosted has
  // no self-provider options at all; it only picks a provided (metered) model. Local keeps its CLIs.
  const providerOptions = hosted ? [] : PROVIDERS
  const [provider, setProvider] = useState<ProviderOption | null>(providerOptions[0] ?? null)
  const [model, setModel] = useState(providerOptions[0]?.defaultModel ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [curated, setCurated] = useState<ModelOption[]>([])

  useEffect(() => {
    void api
      .models()
      .then((r) => setCurated(r.models))
      .catch(() => undefined)
  }, [])

  const pickCurated = async (m: ModelOption) => {
    setBusy(true)
    setError('')
    try {
      await api.selectModel(m.id)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const save = async () => {
    if (!provider) return
    setBusy(true)
    setError('')
    try {
      await api.saveConfig(provider.id, '', model)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Choose your interviewer</h1>
      <p className="sub">
        {hosted
          ? 'Pick the model that runs your interviews. Your first 3 “first impressions” (résumé, company research, level check) are free — interviews are metered against your balance. You can change this anytime.'
          : 'Senior Bro runs entirely on your machine. Use a subscription you already pay for — no API credits required. Nothing leaves your machine except the calls to your chosen AI.'}
      </p>

      {curated.length > 0 && (
        <>
          <h2>Provided models</h2>
          <div className="provider-grid">
            {curated.map((m) => (
              <div key={m.id} className="card clickable" onClick={() => void pickCurated(m)}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{m.label}</b>
                  {m.is_default && <span className="badge resolved">recommended</span>}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                  {m.provider} · {m.model}
                  {m.capability_tier ? ` · ${m.capability_tier}` : ''}
                  {m.price_in > 0 || m.price_out > 0 ? ` — $${m.price_in}/$${m.price_out} per 1M tokens` : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {curated.length === 0 && hosted && (
        <div className="card">No models are available yet — ask the admin to add one.</div>
      )}

      {/* Local mode only: connect a subscription CLI (no API key, no balance). */}
      {provider && (
        <>
          <h2>
            {curated.length > 0 ? 'Or use a local subscription (no key)' : 'How do you want to power it?'}
          </h2>
          <div className="provider-grid">
            {providerOptions.map((p) => (
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
                  <span className="badge resolved">no key</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{p.hint}</div>
              </div>
            ))}
          </div>

          <h2>Make sure you're signed in</h2>
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
      )}

      {error && !provider && <div className="error">{error}</div>}
    </>
  )
}
