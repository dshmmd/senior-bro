import { useEffect, useState } from 'react'
import { api, type UserModelInfo } from '../api'
import { useConfirm } from '../components/Confirm'

/** A friendly label + icon for each event kind in the activity timeline. */
const EVENT_META: Record<string, { icon: string; label: string }> = {
  profile_created: { icon: '🧭', label: 'Set a target role' },
  calibration: { icon: '📏', label: 'Level check' },
  interview_started: { icon: '🎬', label: 'Started an interview' },
  interview_finished: { icon: '🏁', label: 'Finished an interview' },
  preference: { icon: '🎚', label: 'Steered the interview' },
}

/**
 * "What we know about you" (D2 / D6 / Phase 4). Shows the LLM-distilled learner model that
 * personalizes interviews, lets the user correct it by hand or delete it, and lists recent activity
 * so the personalization is transparent and auditable.
 */
export function Memory({ onBack }: { onBack: () => void }) {
  const confirm = useConfirm()
  const [data, setData] = useState<UserModelInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () =>
    api
      .getMyModel()
      .then((d) => {
        setData(d)
        setDraft(d?.summary ?? '')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))

  useEffect(() => {
    void load()
  }, [])

  const save = async () => {
    if (!draft.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.saveMyModel(draft.trim())
      setEditing(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    const ok = await confirm({
      title: 'Forget everything we know about you?',
      body: 'The learner model for this profile is deleted and personalization starts over. This cannot be undone.',
      confirmLabel: 'Forget it all',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      await api.clearMyModel()
      setEditing(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="card">Loading what we know about you…</div>
  if (!data)
    return (
      <>
        <h1>What we know about you</h1>
        <div className="card">Set up a target role first — then this fills in as you practice.</div>
        <div className="mt">
          <button onClick={onBack}>← Back</button>
        </div>
      </>
    )

  const hasModel = data.summary.trim().length > 0

  return (
    <>
      <h1>🧠 What we know about you</h1>
      <p className="sub">
        {data.profile.role}
        {data.profile.company ? ` @ ${data.profile.company}` : ''} · this private picture personalizes your
        interviews — difficulty, pace and focus. You're in control: correct it or wipe it anytime.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <b>Your learner model</b>
          {data.updated_at && (
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              {data.edited ? 'edited by you' : 'auto-updated'} · {data.updated_at.slice(0, 16)}
            </span>
          )}
        </div>

        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              style={{ width: '100%', marginTop: 10 }}
              placeholder="Describe how you learn, your strengths, what to focus on…"
            />
            <div className="row mt">
              <button disabled={busy || !draft.trim()} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setEditing(false)
                  setDraft(data.summary)
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {hasModel ? (
              <p style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{data.summary}</p>
            ) : (
              <p style={{ color: 'var(--muted)', marginTop: 10 }}>
                Nothing yet — finish a mock interview and we'll start building this from how you do.
              </p>
            )}
            <div className="row mt">
              <button className="secondary" onClick={() => setEditing(true)}>
                {hasModel ? 'Correct it' : 'Write it myself'}
              </button>
              {hasModel && (
                <button className="danger" disabled={busy} onClick={() => void clear()}>
                  Forget everything
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {data.events.length > 0 && (
        <>
          <h2>Recent activity</h2>
          <div className="card">
            {data.events.map((e) => {
              const meta = EVENT_META[e.kind] ?? { icon: '•', label: e.kind }
              return (
                <div
                  key={e.id}
                  className="row"
                  style={{ justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}
                >
                  <span>
                    {meta.icon} {meta.label}
                    {e.detail ? <span style={{ color: 'var(--muted)' }}> — {e.detail}</span> : null}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{e.created_at.slice(0, 16)}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="mt">
        <button onClick={onBack}>← Back</button>
      </div>
    </>
  )
}
