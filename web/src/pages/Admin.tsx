import { useEffect, useState } from 'react'
import { api, type AdminUserRow, type InviteCode, type ModelOption } from '../api'

const PROVIDERS = ['anthropic', 'openai', 'mock'] as const

const blankForm = {
  label: '',
  provider: 'anthropic' as string,
  model: 'claude-opus-4-8',
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
              placeholder="claude-opus-4-8"
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </label>
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
    </>
  )
}
