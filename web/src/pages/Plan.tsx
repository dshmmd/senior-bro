import { useEffect, useState } from 'react'
import { api, type ModelOption, type UsageInfo } from '../api'
import { useToast } from '../components/Toast'
import { TIER_LABELS, costPerInterview, interviewsLabel } from '../strings'

// Token packs the mocked checkout sells — shown to the user as interview bundles (RF-7).
const PACKS = [
  { tokens: 100_000, name: 'Starter' },
  { tokens: 500_000, name: 'Regular' },
  { tokens: 1_000_000, name: 'Marathon' },
]

/**
 * Interview-start gate (D11 / Phase 13; reworked). The free tier is 3 "first impressions"
 * (résumé, company research, level check). Interviews are metered — but the user buys and
 * sees **practice interviews**, never tokens (RF-7, owner decision).
 */
export function Plan({ onDone }: { onDone: () => void }) {
  const toast = useToast()
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
        .catch((err: unknown) => {
          toast.error(err)
          return []
        }),
    )
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const perInterview = usage?.interview_estimate_tokens ?? 25_000
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
      return `Payment confirmed (test mode) — ${interviewsLabel(r.granted, perInterview)} added. Now pick your interviewer below.`
    })

  const redeem = () =>
    run(async () => {
      const r = await api.redeemCode(code.trim())
      setCode('')
      return `Invite redeemed — ${interviewsLabel(r.granted, perInterview)} added. Now pick your interviewer below.`
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
      <h1>Set up your interviews</h1>
      <p className="sub">
        Your <b>3 free first steps</b> cover reading your résumé, researching your target company, and your
        placement chat. Practice interviews come in bundles — add one, then pick the interviewer that runs
        them.
      </p>

      {usage && (
        <div className="card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {usage.plan === 'free-intro' && (
            <div>
              <div className="muted fs-xs">Free first steps</div>
              <b>
                {usage.first_impressions_used} / {usage.first_impressions_limit} used
              </b>
            </div>
          )}
          <div>
            <div className="muted fs-xs">Interviews left</div>
            <b>{usage.credit_left !== null ? interviewsLabel(usage.credit_left, perInterview) : '—'}</b>
          </div>
        </div>
      )}

      {note && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          ✓ {note}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <h2>Add practice interviews</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Payment is in <b>test mode</b> for now — picking a bundle adds it instantly, free.
        </p>
        <div className="row">
          {PACKS.map((p) => (
            <button key={p.tokens} disabled={busy} onClick={() => void pay(p.tokens)}>
              {p.name} · {interviewsLabel(p.tokens, perInterview)}
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

      <h2>Pick your interviewer</h2>
      <div className="card">
        {!hasCredit && (
          <p className="muted" style={{ marginTop: 0 }}>
            Add a bundle above first — then choose who interviews you.
          </p>
        )}
        <div className="provider-grid" style={{ opacity: hasCredit ? 1 : 0.5 }}>
          {models.map((m) => {
            const tier = m.capability_tier ? TIER_LABELS[m.capability_tier] : null
            const cost = costPerInterview(m.price_in, m.price_out, perInterview)
            return (
              <div
                key={m.id}
                className="card clickable"
                onClick={() => hasCredit && void pick(m)}
                style={{ cursor: hasCredit ? 'pointer' : 'not-allowed' }}
              >
                <div className="between">
                  <b>{m.label}</b>
                  {m.is_default && <span className="badge resolved">recommended</span>}
                </div>
                <div className="muted fs-sm" style={{ marginTop: 4 }}>
                  {tier ? `${tier.label} — ${tier.hint}` : 'Balanced quality'}
                  {cost > 0 && (
                    <>
                      <br />
                      uses your bundle at ≈ ${cost.toFixed(2)} per interview
                    </>
                  )}
                </div>
              </div>
            )
          })}
          {models.length === 0 && (
            <p className="muted">No interviewers are available yet — please check back soon.</p>
          )}
        </div>
      </div>
    </>
  )
}
