import { useEffect, useState } from 'react'
import {
  api,
  type AdminUserRow,
  type CompanyPack,
  type InviteCode,
  type ModelOption,
  type PromptCatalogEntry,
  type PromptVersion,
} from '../api'

const PROVIDERS = ['anthropic', 'openai', 'arvan', 'mock'] as const

const blankForm = {
  label: '',
  provider: 'anthropic' as string,
  model: 'claude-opus-4-8',
  base_url: '',
  apiKey: '',
  enabled: true,
  is_default: false,
  price_in: 0,
  price_out: 0,
}

export function Admin({ onBack }: { onBack: () => void }) {
  const [models, setModels] = useState<ModelOption[]>([])
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [form, setForm] = useState({ ...blankForm })
  const [invite, setInvite] = useState({ token_credit: 500_000, note: '', expires_in_days: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [m, u, i] = await Promise.all([
        api.adminListModels(),
        api.adminListUsers(),
        api.adminListInvites(),
      ])
      setModels(m)
      setUsers(u)
      setInvites(i)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const addModel = async () => {
    setBusy(true)
    setError('')
    try {
      await api.adminCreateModel({
        label: form.label,
        provider: form.provider,
        model: form.model,
        base_url: form.provider === 'arvan' ? form.base_url || undefined : undefined,
        apiKey: form.apiKey || undefined,
        enabled: form.enabled,
        is_default: form.is_default,
        price_in: form.price_in,
        price_out: form.price_out,
      })
      setForm({ ...blankForm })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (m: ModelOption) => {
    await api.adminUpdateModel(m.id, { enabled: !m.enabled }).catch(() => undefined)
    await load()
  }
  const makeDefault = async (m: ModelOption) => {
    await api.adminUpdateModel(m.id, { is_default: true }).catch(() => undefined)
    await load()
  }
  const remove = async (m: ModelOption) => {
    await api.adminDeleteModel(m.id).catch(() => undefined)
    await load()
  }
  const setQuota = async (u: AdminUserRow) => {
    const raw = window.prompt(
      `Token quota for ${u.email ?? u.id} (blank = unlimited)`,
      String(u.token_quota ?? ''),
    )
    if (raw === null) return
    const trimmed = raw.trim()
    await api.adminSetQuota(u.id, trimmed === '' ? null : Number(trimmed)).catch(() => undefined)
    await load()
  }

  const mintInvite = async () => {
    setBusy(true)
    setError('')
    try {
      const days = invite.expires_in_days.trim()
      await api.adminCreateInvite({
        token_credit: invite.token_credit,
        note: invite.note.trim() || undefined,
        expires_in_days: days === '' ? null : Number(days),
      })
      setInvite({ token_credit: 500_000, note: '', expires_in_days: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const revokeInvite = async (code: string) => {
    await api.adminRevokeInvite(code).catch(() => undefined)
    await load()
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ marginBottom: 0 }}>🛠️ Admin</h1>
        <button className="ghost" onClick={onBack}>
          ← back
        </button>
      </div>
      <p className="sub">
        Curate the models users can pick, manage their API keys, set per-user token quotas, and watch usage.
        Everything here takes effect live — no redeploy.
      </p>
      {error && <div className="error">{error}</div>}

      <h2>Models &amp; keys</h2>
      <div className="card">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Label</th>
              <th>Provider · model</th>
              <th>Key</th>
              <th>$/Mtok (in/out)</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--muted)' }}>
                  No models yet — add one below.
                </td>
              </tr>
            )}
            {models.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.label} {m.is_default && <span className="badge resolved">default</span>}
                </td>
                <td>
                  {m.provider} · {m.model}
                </td>
                <td>{m.has_key ? '🔑' : '—'}</td>
                <td>
                  {m.price_in} / {m.price_out}
                </td>
                <td>{m.enabled ? 'enabled' : 'disabled'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="ghost small" onClick={() => void toggle(m)}>
                    {m.enabled ? 'disable' : 'enable'}
                  </button>{' '}
                  {!m.is_default && (
                    <button className="ghost small" onClick={() => void makeDefault(m)}>
                      make default
                    </button>
                  )}{' '}
                  <button className="ghost small" onClick={() => void remove(m)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Add a model</h2>
      <div className="card">
        <div className="form-grid">
          <label>
            Label
            <input
              value={form.label}
              placeholder="e.g. House Claude"
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </label>
          <label>
            Provider
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {PROVIDERS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Model id
            <input
              value={form.model}
              placeholder={form.provider === 'arvan' ? 'Claude-Haiku-4-5-006zc' : 'claude-opus-4-8'}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </label>
          {form.provider === 'arvan' && (
            <label>
              Gateway base URL
              <input
                value={form.base_url}
                placeholder="https://arvancloudai.ir/gateway/models/<Model>/<token>/v1"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              />
            </label>
          )}
          <label>
            API key {form.provider === 'mock' && <span style={{ color: 'var(--muted)' }}>(not needed)</span>}
            <input
              type="password"
              value={form.apiKey}
              placeholder="stored encrypted"
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </label>
          <label>
            $ / 1M input
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.price_in}
              onChange={(e) => setForm({ ...form, price_in: Number(e.target.value) })}
            />
          </label>
          <label>
            $ / 1M output
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.price_out}
              onChange={(e) => setForm({ ...form, price_out: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="row" style={{ gap: 16, marginTop: 8 }}>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />{' '}
            enabled
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            />{' '}
            default
          </label>
        </div>
        <div className="mt">
          <button disabled={busy || !form.label || !form.model} onClick={() => void addModel()}>
            {busy ? 'Validating key…' : 'Add model'}
          </button>
        </div>
      </div>

      <h2>Users &amp; usage</h2>
      <div className="card">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Tokens used</th>
              <th>Quota</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email ?? `#${u.id}`}</td>
                <td>{u.role}</td>
                <td>{u.total_tokens.toLocaleString()}</td>
                <td>{u.token_quota === null ? '∞' : u.token_quota.toLocaleString()}</td>
                <td>${u.cost_usd.toFixed(4)}</td>
                <td>
                  <button className="ghost small" onClick={() => void setQuota(u)}>
                    set quota
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Invite codes</h2>
      <p className="sub">
        Mint a single-use code carrying token credit. Redeeming it grants the credit and upgrades the user to
        the paid host plan — no card needed (D11).
      </p>
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
      <div className="card">
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
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
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

      <PromptsSection />
      <PacksSection />
    </>
  )
}

/** ~90 days without an update → flag a generated pack as stale (refresh candidate). */
const STALE_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Company packs review queue (D10 / Phase 15). Packs are auto-generated on demand and used
 * immediately; this is post-hoc quality control — edit, publish/unpublish, regenerate (re-draft
 * from the model, web-search-augmented on Anthropic), or delete. Seeds + generated packs both show.
 */
function PacksSection() {
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
    if (
      !window.confirm(
        `Delete the ${p.company} pack? Profiles using it will fall back to a generic interview.`,
      )
    )
      return
    await api.adminDeletePack(p.id).catch((e: unknown) => setError(String(e)))
    if (editing?.id === p.id) setEditing(null)
    await load()
  }

  return (
    <>
      <h2>Company packs</h2>
      <p className="sub">
        Interview playbooks per company. Unknown companies are researched on demand and cached here (reused
        across all users). Edit, publish/unpublish, regenerate a stale one, or delete. 🔎 = drafted with live
        web search.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card">
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
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
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
                    <div style={{ color: 'var(--muted)', fontSize: '0.85em' }}>{p.summary}</div>
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
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{editing.company}</strong>
            <span style={{ color: 'var(--muted)', fontSize: '0.85em' }}>
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
    </>
  )
}

/**
 * Admin-managed, versioned system prompts (D12 / Phase 14). Pick a prompt, edit its
 * body, save → a new active version; or re-activate any past version to roll back.
 * The fixed guardrail frame (D13) lives in code and wraps the interview/coaching
 * bodies — it isn't editable here.
 */
function PromptsSection() {
  const [catalog, setCatalog] = useState<PromptCatalogEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const meta = catalog.find((p) => p.key === selected) ?? null
  const activeVersion = versions.find((v) => v.active) ?? null
  const dirty = activeVersion ? draft !== activeVersion.body : draft.length > 0

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
    <>
      <h2>System prompts</h2>
      <p className="sub">
        Edit and version the prompts that drive calibration, interviews, coaching and scoring. Saving creates
        a new active version; you can roll back to any earlier one. Keep the <code>{'{{PLACEHOLDER}}'}</code>{' '}
        tokens — they&apos;re filled with live data. The fixed anti-jailbreak guardrail wraps the
        interview/coaching prompts and isn&apos;t editable.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card">
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
                  <div style={{ color: 'var(--muted)', fontSize: '0.85em' }}>{p.description}</div>
                </td>
                <td>
                  v{p.active_version ?? '—'}{' '}
                  <span style={{ color: 'var(--muted)' }}>/ {p.version_count}</span>
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
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{meta.label}</strong>
            <span style={{ color: 'var(--muted)', fontSize: '0.85em' }}>
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
                  <td>
                    {!v.active && (
                      <button className="ghost small" onClick={() => void activate(v.version)}>
                        roll back to v{v.version}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
