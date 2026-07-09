// Admin · System prompts (D12 / R26b): edit + version + roll back, now with a
// side-by-side **diff/compare** between any two versions (RF-9 slice 2).
import { useEffect, useState } from 'react'
import { api, type PromptCatalogEntry, type PromptVersion } from '../../api'
import { diffLines } from '../../diff'
import { AdminShell } from './AdminShell'

export function AdminPrompts() {
  const [catalog, setCatalog] = useState<PromptCatalogEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Diff/compare: the version selected as the comparison base (vs. the active one).
  const [compareWith, setCompareWith] = useState<number | null>(null)

  const meta = catalog.find((p) => p.key === selected) ?? null
  const activeVersion = versions.find((v) => v.active) ?? null
  const dirty = activeVersion ? draft !== activeVersion.body : draft.length > 0
  const compareVersion = versions.find((v) => v.version === compareWith) ?? null

  const loadCatalog = async () => {
    try {
      setCatalog(await api.adminListPrompts())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openPrompt = async (key: string) => {
    setError('')
    setSelected(key)
    setCompareWith(null)
    try {
      const vs = await api.adminPromptVersions(key)
      setVersions(vs)
      setDraft(vs.find((v) => v.active)?.body ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void loadCatalog()
  }, [])

  const save = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await api.adminSavePrompt(selected, draft)
      await Promise.all([openPrompt(selected), loadCatalog()])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const activate = async (version: number) => {
    if (!selected) return
    setError('')
    try {
      await api.adminActivatePrompt(selected, version)
      await Promise.all([openPrompt(selected), loadCatalog()])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <AdminShell title="Prompts">
      <p className="sub">
        Edit and version the prompts that drive calibration, interviews, coaching and scoring. Saving creates
        a new active version; roll back to any earlier one, or <b>compare</b> two versions to see exactly what
        changed. Keep the <code>{'{{PLACEHOLDER}}'}</code> tokens — they&apos;re filled with live data. The
        fixed anti-jailbreak guardrail wraps the interview/coaching prompts and isn&apos;t editable.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Prompt</th>
              <th>Active version</th>
              <th>Guardrail</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((p) => (
              <tr key={p.key}>
                <td>
                  {p.label}
                  <div className="muted fs-xs">{p.description}</div>
                </td>
                <td>
                  v{p.active_version ?? '—'} <span className="muted">/ {p.version_count}</span>
                </td>
                <td>{p.guardrailed ? '🛡️' : '—'}</td>
                <td>
                  <button className="ghost small" onClick={() => void openPrompt(p.key)}>
                    {selected === p.key ? 'editing' : 'edit'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && meta && (
        <div className="card">
          <div className="between">
            <strong>{meta.label}</strong>
            <span className="muted fs-xs">
              placeholders: {meta.placeholders.map((p) => `{{${p}}}`).join(' ') || 'none'}
            </span>
          </div>
          <textarea
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: '100%', minHeight: 260, marginTop: 8, fontFamily: 'monospace', fontSize: 13 }}
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button disabled={busy || !dirty || draft.trim() === ''} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save as new version'}
            </button>
            {activeVersion && dirty && (
              <button className="ghost" onClick={() => setDraft(activeVersion.body)}>
                Revert edits
              </button>
            )}
          </div>

          <h3 style={{ marginBottom: 4 }}>Version history</h3>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Version</th>
                <th>Author</th>
                <th>Saved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>
                    v{v.version} {v.active && <span className="badge resolved">active</span>}
                  </td>
                  <td>{v.author}</td>
                  <td>{new Date(v.created_at).toLocaleString()}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!v.active && (
                      <>
                        <button className="ghost small" onClick={() => void activate(v.version)}>
                          activate v{v.version}
                        </button>{' '}
                        <button
                          className="ghost small"
                          onClick={() => setCompareWith(compareWith === v.version ? null : v.version)}
                        >
                          {compareWith === v.version ? 'hide diff' : 'compare'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {compareVersion && activeVersion && (
            <>
              <h3 style={{ marginBottom: 4 }}>
                Diff: v{compareVersion.version} → v{activeVersion.version}{' '}
                <span className="muted fs-sm">(red = removed since, green = added since)</span>
              </h3>
              <div className="diff-view">
                {diffLines(compareVersion.body, activeVersion.body).map((l, i) => (
                  <div key={i} className={`diff-line ${l.type}`}>
                    <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                    {l.text || ' '}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </AdminShell>
  )
}
