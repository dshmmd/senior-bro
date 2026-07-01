import { useEffect, useState } from 'react'
import { api, type ModelOption, type UsageInfo } from '../api'

const PACKS = [100_000, 500_000, 1_000_000]
const fmt = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`)

/**
 * Plan gate (D11 / Phase 13). Shown after the free level-check when the user has no
 * usable setup yet. Two ways forward: a paid 'host' plan (mocked checkout or an invite
 * code grants token credit, then pick a provided model) or free BYO-key.
 */
export function Plan({ onDone, onChooseByok }: { onDone: () => void; onChooseByok: () => void }) {
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    setUsage(await api.usage().catch(() => null))
    setModels(
      await api
        .models()
        .then((r) => r.models)
        .catch(() => []),
    )
  }
  useEffect(() => {
    void load()
  }, [])

  const creditLeft = usage?.credit_left ?? 0
  const hasCredit = creditLeft > 0

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      setNote(await fn())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pay = (tokens: number) =>
    run(async () => {
      const r = await api.planCheckout(tokens)
      return `Payment confirmed (mock) — ${fmt(r.granted)} tokens of credit added. Now pick a model.`
    })

  const redeem = () =>
    run(async () => {
      const r = await api.redeemCode(code.trim())
      setCode('')
      return `Invite redeemed — ${fmt(r.granted)} tokens of credit added. Now pick a model.`
    })

  const pick = async (m: ModelOption) => {
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

  return (
    <>
      <h1>Choose how to continue</h1>
      <p className="sub">
        Your free first impression is done 🎉 To run full interviews, pick a plan. You can switch later in
        settings.
      </p>

      {usage && (
        <div className="card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Plan</div>
            <b>{usage.plan}</b>
          </div>
          {usage.plan === 'free-intro' && (
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Free first impressions</div>
              <b>
                {usage.first_impressions_used} / {usage.first_impressions_limit} used
              </b>
            </div>
          )}
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Credit left</div>
            <b>{usage.credit_left !== null ? `${fmt(usage.credit_left)} tokens` : '—'}</b>
          </div>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Tokens used</div>
            <b>{usage.tokens_used.toLocaleString()}</b>
          </div>
        </div>
      )}

      {note && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          ✓ {note}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <h2>💳 Host models — paid</h2>
      <div className="card">
        {hasCredit && (
          <>
            <p style={{ marginTop: 0 }}>
              You have <b>{fmt(creditLeft)}</b> tokens of credit. Pick a model to start:
            </p>
            <div className="provider-grid">
              {models.map((m) => (
                <div key={m.id} className="card clickable" onClick={() => void pick(m)}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <b>{m.label}</b>
                    {m.is_default && <span className="badge resolved">recommended</span>}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                    {m.provider} · {m.model}
                  </div>
                </div>
              ))}
              {models.length === 0 && (
                <p style={{ color: 'var(--muted)' }}>No models available yet — ask the admin to add one.</p>
              )}
            </div>
            <h3 style={{ marginBottom: 4 }}>Need more credit?</h3>
          </>
        )}
        <p style={{ marginTop: 0 }}>
          Metered by tokens. Payment is <b>mocked</b> for now — pick a pack to add credit instantly.
        </p>
        <div className="row">
          {PACKS.map((p) => (
            <button key={p} disabled={busy} onClick={() => void pay(p)}>
              Pay (mock) · {fmt(p)} tokens
            </button>
          ))}
        </div>
        <h3 style={{ marginBottom: 4 }}>Have an invite code?</h3>
        <div className="row">
          <input
            value={code}
            placeholder="SB-XXXXXXXX"
            onChange={(e) => setCode(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="secondary"
            disabled={busy || code.trim().length < 3}
            onClick={() => void redeem()}
          >
            Redeem
          </button>
        </div>
      </div>

      <h2>🔑 Bring your own key — free</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Use your own Claude or OpenAI API key. Your provider bills you directly; we don't meter it.
        </p>
        <button className="secondary" onClick={onChooseByok}>
          Set up my own key →
        </button>
      </div>
    </>
  )
}
