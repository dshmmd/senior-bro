// Admin · Invite codes (D11): mint single-use token-credit codes, list + revoke.
import { useEffect, useState } from 'react'
import { api, type InviteCode } from '../../api'
import { useToast } from '../../components/Toast'
import { AdminShell } from './AdminShell'

export function AdminInvites() {
  const toast = useToast()
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [invite, setInvite] = useState({ token_credit: 500_000, note: '', expires_in_days: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () =>
    api
      .adminListInvites()
      .then(setInvites)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  useEffect(() => {
    void load()
  }, [])

  const mintInvite = async () => {
    setBusy(true)
    setError('')
    try {
      const days = invite.expires_in_days.trim()
      const created = await api.adminCreateInvite({
        token_credit: invite.token_credit,
        note: invite.note.trim() || undefined,
        expires_in_days: days === '' ? null : Number(days),
      })
      setInvite({ token_credit: 500_000, note: '', expires_in_days: '' })
      toast.success(`Minted ${created.code}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const revokeInvite = async (code: string) => {
    await api.adminRevokeInvite(code).catch(toast.error)
    await load()
  }

  return (
    <AdminShell title="Invites">
      <p className="sub">
        Mint a single-use code carrying token credit. Redeeming it grants the credit and upgrades the user to
        the paid host plan — no card needed (D11).
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            Token credit
            <input
              type="number"
              min={1}
              value={invite.token_credit}
              onChange={(e) => setInvite({ ...invite, token_credit: Number(e.target.value) })}
            />
          </label>
          <label>
            Note (optional)
            <input
              value={invite.note}
              placeholder="e.g. beta tester"
              onChange={(e) => setInvite({ ...invite, note: e.target.value })}
            />
          </label>
          <label>
            Expires in days (blank = never)
            <input
              type="number"
              min={1}
              value={invite.expires_in_days}
              onChange={(e) => setInvite({ ...invite, expires_in_days: e.target.value })}
            />
          </label>
          <button disabled={busy || invite.token_credit < 1} onClick={() => void mintInvite()}>
            Mint code
          </button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Credit</th>
              <th>Status</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No invite codes yet.
                </td>
              </tr>
            )}
            {invites.map((iv) => {
              const status = iv.revoked
                ? 'revoked'
                : iv.redeemed_by !== null
                  ? `redeemed by #${iv.redeemed_by}`
                  : iv.expires_at !== null && new Date(iv.expires_at) < new Date()
                    ? 'expired'
                    : 'active'
              return (
                <tr key={iv.code}>
                  <td>
                    <code>{iv.code}</code>
                  </td>
                  <td>{iv.token_credit.toLocaleString()}</td>
                  <td>{status}</td>
                  <td>{iv.note ?? '—'}</td>
                  <td>
                    {status === 'active' && (
                      <button className="ghost small" onClick={() => void revokeInvite(iv.code)}>
                        revoke
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}
