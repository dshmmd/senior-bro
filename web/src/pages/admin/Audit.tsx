// Admin · Admin log (RF-9 / R26): the audit trail of admin actions — who changed
// what, when (model CRUD, routing, quotas, suspensions, invites, prompts, packs).
import { useEffect, useState } from 'react'
import { api, type AdminEvent } from '../../api'
import { AdminShell } from './AdminShell'

export function AdminAudit() {
  const [rows, setRows] = useState<AdminEvent[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .adminEvents(500)
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <AdminShell title="Admin log">
      <p className="sub">Every admin action, newest first — the accountability trail for this deploy.</p>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No admin actions recorded yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.created_at.slice(0, 19).replace('T', ' ')}</td>
                <td>{r.admin_email ?? (r.admin_id !== null ? `#${r.admin_id}` : '—')}</td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}
