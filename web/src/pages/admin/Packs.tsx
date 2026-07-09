// Admin · Company packs review queue (D10 / Phase 15): post-hoc quality control —
// edit, publish/unpublish, regenerate a stale pack, or delete.
import { useEffect, useState } from 'react'
import { api, type CompanyPack } from '../../api'
import { useConfirm } from '../../components/Confirm'
import { AdminShell } from './AdminShell'

/** ~90 days without an update → flag a generated pack as stale (refresh candidate). */
const STALE_MS = 90 * 24 * 60 * 60 * 1000

export function AdminPacks() {
  const confirmDialog = useConfirm()
  const [packs, setPacks] = useState<CompanyPack[]>([])
  const [editing, setEditing] = useState<CompanyPack | null>(null)
  const [draftBody, setDraftBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setPacks(await api.adminListPacks())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const open = (p: CompanyPack) => {
    setEditing(p)
    setDraftBody(p.body)
    setError('')
  }

  const saveBody = async () => {
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await api.adminUpdatePack(editing.id, { body: draftBody })
      setEditing(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (p: CompanyPack, status: CompanyPack['status']) => {
    await api.adminUpdatePack(p.id, { status }).catch((e: unknown) => setError(String(e)))
    await load()
  }
  const regenerate = async (p: CompanyPack) => {
    setBusy(true)
    setError('')
    try {
      await api.adminRegeneratePack(p.id)
      if (editing?.id === p.id) setEditing(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (p: CompanyPack) => {
    const ok = await confirmDialog({
      title: `Delete the ${p.company} pack?`,
      body: 'Profiles using it will fall back to a generic interview.',
      confirmLabel: 'Delete pack',
      danger: true,
    })
    if (!ok) return
    await api.adminDeletePack(p.id).catch((e: unknown) => setError(String(e)))
    if (editing?.id === p.id) setEditing(null)
    await load()
  }

  return (
    <AdminShell title="Company packs">
      <p className="sub">
        Interview playbooks per company. Unknown companies are researched on demand and cached here (reused
        across all users). Edit, publish/unpublish, regenerate a stale one, or delete. 🔎 = drafted with live
        web search.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Company</th>
              <th>Source</th>
              <th>Status</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packs.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No packs yet.
                </td>
              </tr>
            )}
            {packs.map((p) => {
              const stale =
                p.source === 'generated' && Date.now() - new Date(p.updated_at).getTime() > STALE_MS
              return (
                <tr key={p.id}>
                  <td>
                    {p.company} {p.searched && '🔎'}
                    <div className="muted" style={{ fontSize: '0.85em' }}>
                      {p.summary}
                    </div>
                  </td>
                  <td>{p.source}</td>
                  <td>
                    {p.status}
                    {stale && <span className="badge open"> stale</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(p.updated_at).toLocaleDateString()}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="ghost small" onClick={() => open(p)}>
                      {editing?.id === p.id ? 'editing' : 'edit'}
                    </button>{' '}
                    {p.status === 'published' ? (
                      <button className="ghost small" onClick={() => void setStatus(p, 'draft')}>
                        unpublish
                      </button>
                    ) : (
                      <button className="ghost small" onClick={() => void setStatus(p, 'published')}>
                        publish
                      </button>
                    )}{' '}
                    <button className="ghost small" disabled={busy} onClick={() => void regenerate(p)}>
                      regenerate
                    </button>{' '}
                    <button className="ghost small" onClick={() => void remove(p)}>
                      delete
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="card">
          <div className="between">
            <strong>{editing.company}</strong>
            <span className="muted" style={{ fontSize: '0.85em' }}>
              roles: {editing.roles.join(', ') || '—'}
              {editing.model ? ` · ${editing.model}` : ''}
            </span>
          </div>
          <textarea
            value={draftBody}
            spellCheck={false}
            onChange={(e) => setDraftBody(e.target.value)}
            style={{ width: '100%', minHeight: 260, marginTop: 8, fontFamily: 'monospace', fontSize: 13 }}
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button
              disabled={busy || draftBody.trim() === '' || draftBody === editing.body}
              onClick={() => void saveBody()}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  )
}
