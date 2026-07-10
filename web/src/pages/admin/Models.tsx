// Admin · Models & keys (R13/R26a): the curated model catalog — add/rotate/price/
// enable/default/delete, all live. Split out of the old 830-line Admin.tsx (RF-9).
import { useEffect, useState } from 'react'
import { api, type ModelOption } from '../../api'
import { useConfirm } from '../../components/Confirm'
import { useToast } from '../../components/Toast'
import { AdminShell } from './AdminShell'

// Arvan first — it's the production gateway (D19); the rest stay for dev/testing.
const PROVIDERS = ['arvan', 'anthropic', 'openai', 'mock'] as const

const blankForm = {
  label: '',
  provider: 'arvan' as string,
  model: '',
  base_url: '',
  apiKey: '',
  enabled: true,
  is_default: false,
  price_in: 0,
  price_out: 0,
}

export function AdminModels() {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const [models, setModels] = useState<ModelOption[]>([])
  const [form, setForm] = useState({ ...blankForm })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () =>
    api
      .adminListModels()
      .then(setModels)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
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
      toast.success('Model added')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (m: ModelOption) => {
    await api.adminUpdateModel(m.id, { enabled: !m.enabled }).catch(toast.error)
    await load()
  }
  const makeDefault = async (m: ModelOption) => {
    await api.adminUpdateModel(m.id, { is_default: true }).catch(toast.error)
    await load()
  }
  const remove = async (m: ModelOption) => {
    const ok = await confirmDialog({
      title: `Remove "${m.label}"?`,
      body: 'Users who selected it fall back to choosing another model.',
      confirmLabel: 'Remove model',
      danger: true,
    })
    if (!ok) return
    await api.adminDeleteModel(m.id).catch(toast.error)
    await load()
  }

  return (
    <AdminShell title="Models & keys">
      <p className="sub">
        Curate the models users can pick, manage their API keys and per-Mtok prices. Everything takes effect
        live — no redeploy.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Label</th>
              <th>Provider · model</th>
              <th>Key</th>
              <th>Price/Mtok (in/out)</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
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
                  {m.capability_tier && (
                    <>
                      {' '}
                      <span className="badge" title="Probed capability tier (D3)">
                        {m.capability_tier}
                      </span>
                    </>
                  )}
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
            API key {form.provider === 'mock' && <span className="muted">(not needed)</span>}
            <input
              type="password"
              value={form.apiKey}
              placeholder="stored encrypted"
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </label>
          <label>
            Price / 1M input
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.price_in}
              onChange={(e) => setForm({ ...form, price_in: Number(e.target.value) })}
            />
          </label>
          <label>
            Price / 1M output
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
    </AdminShell>
  )
}
