import { useCallback, useEffect, useState } from 'react'
import { api, type Profile } from './api'
import { Setup } from './pages/Setup'
import { ProfileSetup } from './pages/ProfileSetup'
import { Calibration } from './pages/Calibration'
import { Dashboard } from './pages/Dashboard'
import { Interview } from './pages/Interview'

export type View =
  | { name: 'loading' }
  | { name: 'setup' }
  | { name: 'profile' }
  | { name: 'calibration' }
  | { name: 'dashboard' }
  | { name: 'interview'; mode: 'voice' | 'text'; kind: 'full' | 'coaching'; weaknessId?: number }

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' })
  const [profile, setProfile] = useState<Profile | null>(null)

  const refresh = useCallback(async () => {
    const health = await api.health().catch(() => null)
    if (!health) {
      setView({ name: 'loading' })
      return
    }
    if (!health.configured) {
      setView({ name: 'setup' })
      return
    }
    const p = await api.getProfile()
    setProfile(p)
    if (!p) setView({ name: 'profile' })
    else if (!p.level) setView({ name: 'calibration' })
    else setView({ name: 'dashboard' })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <>
      <div className="topbar">
        <div className="logo" onClick={() => void refresh()}>
          🎙️ Senior <span>Bro</span>
        </div>
        <div className="spacer" />
        {profile && (
          <div className="pill">
            {profile.role}
            {profile.level ? ` · ${profile.level}` : ''}
          </div>
        )}
        <div className="pill clickable" style={{ cursor: 'pointer' }} onClick={() => setView({ name: 'setup' })}>
          ⚙ settings
        </div>
      </div>
      <div className="shell">
        {view.name === 'loading' && (
          <div className="card">
            Connecting to the Senior Bro server… make sure it's running (<code>npm run dev</code>).
            <div className="mt">
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          </div>
        )}
        {view.name === 'setup' && <Setup onDone={() => void refresh()} />}
        {view.name === 'profile' && <ProfileSetup onDone={() => void refresh()} />}
        {view.name === 'calibration' && profile && (
          <Calibration profile={profile} onDone={() => void refresh()} />
        )}
        {view.name === 'dashboard' && profile && (
          <Dashboard
            profile={profile}
            onStartInterview={(mode, kind, weaknessId) =>
              setView({ name: 'interview', mode, kind, weaknessId })
            }
            onNewProfile={() => setView({ name: 'profile' })}
            onRecalibrate={() => setView({ name: 'calibration' })}
          />
        )}
        {view.name === 'interview' && profile && (
          <Interview
            profile={profile}
            mode={view.mode}
            kind={view.kind}
            weaknessId={view.weaknessId}
            onExit={() => void refresh()}
          />
        )}
      </div>
    </>
  )
}
