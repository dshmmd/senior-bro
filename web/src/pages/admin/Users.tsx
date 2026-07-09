// Admin · Users (RF-9): usage/cost per user, quota editing (inline, no window.prompt),
// suspend/unsuspend, and a jump into the per-event usage audit.
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type AdminUserRow } from '../../api'
import { useConfirm } from '../../components/Confirm'
import { useToast } from '../../components/Toast'
import { AdminShell } from './AdminShell'

export function AdminUsers() {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [error, setError] = useState('')
  // Inline quota editor: which user id is being edited + the draft value.
  const [editing, setEditing] = useState<number | null>(null)
  const [quotaDraft, setQuotaDraft] = useState('')

  const load = () =>
    api
      .adminListUsers()
      .then(setUsers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  useEffect(() => {
    void load()
  }, [])

  const saveQuota = async (u: AdminUserRow) => {
    const trimmed = quotaDraft.trim()
    const quota = trimmed === '' ? null : Number(trimmed)
    if (quota !== null && (!Number.isInteger(quota) || quota < 0)) {
      toast.push('error', 'Quota must be a whole number of tokens (or blank for unlimited)')
      return
    }
    await api.adminSetQuota(u.id, quota).catch(toast.error)
    setEditing(null)
    await load()
  }

  const setSuspended = async (u: AdminUserRow, suspended: boolean) => {
    if (suspended) {
      const ok = await confirmDialog({
        title: `Suspend ${u.email ?? `#${u.id}`}?`,
        body: 'They are blocked from every request until un-suspended. Their data stays intact.',
        confirmLabel: 'Suspend',
        danger: true,
      })
      if (!ok) return
    }
    await api.adminSuspendUser(u.id, suspended).catch(toast.error)
    await load()
  }

  return (
    <AdminShell title="Users">
      <p className="sub">
        Per-user usage/cost, token quotas, and account suspension. "Usage →" opens the per-call audit for that
        user.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Role · plan</th>
              <th>Tokens used</th>
              <th>Quota</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={u.suspended ? { opacity: 0.6 } : undefined}>
                <td>
                  {u.email ?? `#${u.id}`} {u.suspended && <span className="badge open">suspended</span>}
                </td>
                <td>
                  {u.role} · {u.plan}
                </td>
                <td>{u.total_tokens.toLocaleString()}</td>
                <td>
                  {editing === u.id ? (
                    <span className="row" style={{ gap: 4 }}>
                      <input
                        style={{ width: 110 }}
                        value={quotaDraft}
                        placeholder="unlimited"
                        onChange={(e) => setQuotaDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveQuota(u)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        autoFocus
                      />
                      <button className="ghost small" onClick={() => void saveQuota(u)}>
                        save
                      </button>
                    </span>
                  ) : (
                    <>
                      {u.token_quota === null ? '∞' : u.token_quota.toLocaleString()}{' '}
                      <button
                        className="ghost small"
                        onClick={() => {
                          setEditing(u.id)
                          setQuotaDraft(u.token_quota === null ? '' : String(u.token_quota))
                        }}
                      >
                        edit
                      </button>
                    </>
                  )}
                </td>
                <td>${u.cost_usd.toFixed(4)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link className="ghost small" to={`/admin/usage?user=${u.id}`}>
                    usage →
                  </Link>{' '}
                  {u.role !== 'admin' && (
                    <button className="ghost small" onClick={() => void setSuspended(u, !u.suspended)}>
                      {u.suspended ? 'un-suspend' : 'suspend'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}
