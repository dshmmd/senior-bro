import { useState } from 'react'
import { api } from '../api'

/**
 * Hosted-mode sign-in. Passwordless: enter an email, receive a magic link.
 * In dev/staging (no mailbox wired) the server returns the link directly, so we
 * surface a one-click "sign in" shortcut.
 */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.requestMagicLink(email.trim())
      setSent(true)
      setDevLink(res.link ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const followDevLink = async () => {
    if (!devLink) return
    const token = new URL(devLink).searchParams.get('magic')
    if (!token) return
    setBusy(true)
    try {
      await api.verifyMagicLink(token)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 460, margin: '8vh auto' }}>
      <h1 style={{ marginTop: 0 }}>Sign in 🎙️</h1>
      <p className="sub">
        Senior Bro is passwordless. Enter your email and we'll send a one-time sign-in link — no password to
        remember.
      </p>

      {!sent ? (
        <>
          <label>Email</label>
          <input
            type="email"
            value={email}
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email.includes('@')) void send()
            }}
          />
          {error && <div className="error">{error}</div>}
          <div className="mt">
            <button disabled={busy || !email.includes('@')} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Email me a link →'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            ✉️ Check <b>{email}</b> for a sign-in link. It expires in 20 minutes.
          </p>
          {devLink && (
            <div className="mt">
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                Dev mode — no mailbox is wired, so use this shortcut:
              </p>
              <button disabled={busy} onClick={() => void followDevLink()}>
                {busy ? 'Signing in…' : 'Sign in now (dev) →'}
              </button>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="mt">
            <button
              className="ghost"
              onClick={() => {
                setSent(false)
                setDevLink(null)
              }}
            >
              ← use a different email
            </button>
          </div>
        </>
      )}
    </div>
  )
}
