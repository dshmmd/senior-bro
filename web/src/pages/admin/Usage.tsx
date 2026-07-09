// Admin · Usage audit (RF-9 / R25): every metered model call — who, when, which
// model, tokens in/out, cost. Filterable by user (?user=ID), exportable as CSV.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api, type UsageEventRow } from '../../api'
import { AdminShell } from './AdminShell'

function toCsv(rows: UsageEventRow[]): string {
  const head = 'id,created_at,user_id,email,provider,model,input_tokens,output_tokens,cost_usd'
  const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [
    head,
    ...rows.map((r) =>
      [
        r.id,
        r.created_at,
        r.user_id,
        r.email,
        r.provider,
        r.model,
        r.input_tokens,
        r.output_tokens,
        r.cost_usd,
      ]
        .map(esc)
        .join(','),
    ),
  ].join('\n')
}

export function AdminUsage() {
  const [params, setParams] = useSearchParams()
  const userFilter = params.get('user')
  const [rows, setRows] = useState<UsageEventRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .adminUsageEvents(userFilter ? Number(userFilter) : undefined, 500)
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [userFilter])

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `usage-events${userFilter ? `-user-${userFilter}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0)
  const totalTokens = rows.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0)

  return (
    <AdminShell title="Usage audit">
      <p className="sub">
        Per-call metering audit (R25): who spent what, when, on which model. Newest first, capped at 500.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginBottom: 8 }}>
        {userFilter && (
          <button className="secondary" onClick={() => setParams({})}>
            ✕ clear user filter (#{userFilter})
          </button>
        )}
        <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>
          Export CSV
        </button>
        <span className="muted fs-sm">
          {rows.length} calls · {totalTokens.toLocaleString()} tokens · ${totalCost.toFixed(4)}
        </span>
      </div>
      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Provider · model</th>
              <th>Tokens (in/out)</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No metered calls yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.created_at.slice(0, 19).replace('T', ' ')}</td>
                <td>{r.email ?? `#${r.user_id}`}</td>
                <td>
                  {r.provider} · {r.model}
                </td>
                <td>
                  {r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}
                </td>
                <td>${r.cost_usd.toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}
