// Admin · Feature routing (R35/D23) + kill switches (RF-9): pick which model powers
// each feature, or disable a feature entirely without a redeploy.
import { useEffect, useState } from 'react'
import { api, type FeatureAssignment, type FeatureDef, type ModelOption } from '../../api'
import { useToast } from '../../components/Toast'
import { AdminShell } from './AdminShell'

export function AdminFeatures() {
  const toast = useToast()
  const [features, setFeatures] = useState<FeatureDef[]>([])
  const [assignments, setAssignments] = useState<Record<string, FeatureAssignment>>({})
  const [models, setModels] = useState<ModelOption[]>([])
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [f, m] = await Promise.all([api.adminFeatureModels(), api.adminListModels()])
      setFeatures(f.features)
      setAssignments(f.assignments)
      setModels(m)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const assign = async (key: string, value: string) => {
    await api.adminSetFeatureModel(key, { model_id: value === '' ? null : Number(value) }).catch(toast.error)
    await load()
  }

  const setKilled = async (key: string, disabled: boolean) => {
    await api.adminSetFeatureModel(key, { disabled }).catch(toast.error)
    if (disabled) toast.info(`"${key}" is now disabled for platform-funded calls`)
    await load()
  }

  return (
    <AdminShell title="Feature routing">
      <p className="sub">
        Pick which model powers each feature — cheap/fast models suit onboarding, stronger ones the interview
        itself. <b>Global default</b> uses the default model from Models &amp; keys. The kill switch disables
        a feature instantly (users get a clear "temporarily disabled" message; no tokens burn) — for when a
        provider or feature misbehaves.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Model</th>
              <th>Kill switch</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => {
              const a = assignments[f.key] ?? { model_id: null, disabled: false }
              return (
                <tr key={f.key} style={a.disabled ? { opacity: 0.75 } : undefined}>
                  <td>
                    <b>{f.label}</b> {a.disabled && <span className="badge open">disabled</span>}
                    <div className="muted fs-xs">{f.hint}</div>
                  </td>
                  <td>
                    <select value={a.model_id ?? ''} onChange={(e) => void assign(f.key, e.target.value)}>
                      <option value="">Global default</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id} disabled={!m.enabled}>
                          {m.label}
                          {m.enabled ? '' : ' (disabled)'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className={a.disabled ? '' : 'danger'}
                      onClick={() => void setKilled(f.key, !a.disabled)}
                    >
                      {a.disabled ? 'Re-enable' : 'Disable'}
                    </button>
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
