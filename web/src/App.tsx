import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { api, type InterviewDomain, type Profile } from './api'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { Admin } from './pages/Admin'
import { Setup } from './pages/Setup'
import { ProfileSetup } from './pages/ProfileSetup'
import { Calibration } from './pages/Calibration'
import { Dashboard } from './pages/Dashboard'
import { Interview } from './pages/Interview'
import { Progress } from './pages/Progress'
import { Career } from './pages/Career'
import { StudyPlan } from './pages/StudyPlan'
import { Memory } from './pages/Memory'
import { Plan } from './pages/Plan'

export type View =
  | { name: 'landing' }
  | { name: 'loading' }
  | { name: 'login' }
  | { name: 'admin' }
  | { name: 'setup' }
  | { name: 'profile' }
  | { name: 'calibration' }
  | { name: 'plan' }
  | { name: 'dashboard' }
  | { name: 'progress' }
  | { name: 'career' }
  | { name: 'study' }
  | { name: 'memory' }
  | {
      name: 'interview'
      mode: 'voice' | 'text'
      kind: 'full' | 'coaching'
      domain: InterviewDomain
      weaknessId?: number
      resumeId?: number
    }

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

const hasMagicToken = () => new URLSearchParams(window.location.search).has('magic')

export function App() {
  const [view, setView] = useState<View>(() =>
    hasMagicToken() || localStorage.getItem('sb-entered') ? { name: 'loading' } : { name: 'landing' },
  )
  const [profile, setProfile] = useState<Profile | null>(null)
  const [account, setAccount] = useState<{
    hosted: boolean
    email: string | null
    role: 'user' | 'admin' | null
  }>({ hosted: false, email: null, role: null })

  const refresh = useCallback(async () => {
    const health = await api.health().catch(() => null)
    if (!health) {
      setView({ name: 'loading' })
      return
    }
    const hosted = health.mode === 'hosted'
    setAccount({
      hosted,
      email: health.user?.email ?? null,
      role: health.user?.role ?? null,
    })
    if (hosted && !health.authed) {
      setView({ name: 'login' })
      return
    }
    // Local mode keeps the original gate: a provider must be configured up front.
    // Hosted mode defers it — the free level-check needs no key, then a plan is chosen.
    if (!hosted && !health.configured) {
      setView({ name: 'setup' })
      return
    }
    const p = await api.getProfile()
    setProfile(p)
    if (!p) setView({ name: 'profile' })
    else if (!p.level) setView({ name: 'calibration' })
    // After the free level-check, a hosted user with no usable setup (no own key and no
    // selected host model) must choose a plan before interviews unlock (D11).
    else if (hosted && !health.configured && !health.has_model) setView({ name: 'plan' })
    else setView({ name: 'dashboard' })
  }, [])

  useEffect(() => {
    // Arriving from a magic link: verify the token, then drop into the app.
    if (hasMagicToken()) {
      const token = new URLSearchParams(window.location.search).get('magic')!
      localStorage.setItem('sb-entered', '1')
      void api
        .verifyMagicLink(token)
        .catch(() => undefined)
        .finally(() => {
          window.history.replaceState({}, '', window.location.pathname)
          void refresh()
        })
      return
    }
    if (localStorage.getItem('sb-entered')) void refresh()
  }, [refresh])

  const enterApp = () => {
    localStorage.setItem('sb-entered', '1')
    setView({ name: 'loading' })
    void refresh()
  }

  const logout = async () => {
    await api.logout().catch(() => undefined)
    setProfile(null)
    setView({ name: 'login' })
  }

  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)

  if (view.name === 'landing') return <Landing onEnter={enterApp} />
  if (view.name === 'login') return <Login onSignedIn={() => void refresh()} />

  return (
    <>
      {!online && (
        <div className="offline-banner">
          ⚠ You're offline — answers can't reach the interviewer right now.
        </div>
      )}
      <div className="topbar">
        <div
          className="logo"
          onClick={() => {
            localStorage.removeItem('sb-entered')
            setView({ name: 'landing' })
          }}
        >
          🎙️ Senior <span>Bro</span>
        </div>
        <div className="spacer" />
        {profile && (
          <div className="pill">
            {profile.role}
            {profile.level ? ` · ${profile.level}` : ''}
          </div>
        )}
        {account.hosted && (
          <div
            className="pill clickable"
            style={{ cursor: 'pointer' }}
            onClick={() => setView({ name: 'plan' })}
          >
            💳 plan
          </div>
        )}
        {profile?.level && (
          <div
            className="pill clickable"
            style={{ cursor: 'pointer' }}
            onClick={() => setView({ name: 'memory' })}
          >
            🧠 you
          </div>
        )}
        {account.role === 'admin' && (
          <div
            className="pill clickable"
            style={{ cursor: 'pointer' }}
            onClick={() => setView({ name: 'admin' })}
          >
            🛠️ admin
          </div>
        )}
        <div
          className="pill clickable"
          style={{ cursor: 'pointer' }}
          onClick={() => setView({ name: 'setup' })}
        >
          ⚙ settings
        </div>
        {account.hosted && (
          <div className="pill clickable" style={{ cursor: 'pointer' }} onClick={() => void logout()}>
            {account.email ? `↩ ${account.email}` : '↩ sign out'}
          </div>
        )}
      </div>
      <div className="shell">
        {/* R21: a Back so users never get stuck on a settings/onboarding screen. Shown only
            when there's a real dashboard to return to (profile is calibrated) — so it's never
            a dead end during first-run onboarding. */}
        {profile?.level && ['setup', 'plan', 'profile', 'calibration'].includes(view.name) && (
          <button className="ghost" onClick={() => setView({ name: 'dashboard' })}>
            ← Back
          </button>
        )}
        {view.name === 'loading' && (
          <div className="card">
            Connecting to the Senior Bro server… make sure it's running (<code>npm run dev</code>).
            <div className="mt">
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          </div>
        )}
        {view.name === 'admin' && <Admin onBack={() => setView({ name: 'dashboard' })} />}
        {view.name === 'setup' && <Setup hosted={account.hosted} onDone={() => void refresh()} />}
        {view.name === 'profile' && <ProfileSetup onDone={() => void refresh()} />}
        {view.name === 'calibration' && profile && (
          <Calibration profile={profile} onDone={() => void refresh()} />
        )}
        {view.name === 'plan' && (
          <Plan onDone={() => void refresh()} onChooseByok={() => setView({ name: 'setup' })} />
        )}
        {view.name === 'dashboard' && profile && (
          <Dashboard
            profile={profile}
            email={account.email}
            onStartInterview={(mode, kind, domain, weaknessId) =>
              setView({ name: 'interview', mode, kind, domain, weaknessId })
            }
            onResumeInterview={(id, mode, kind) =>
              setView({ name: 'interview', mode, kind, domain: 'technical', resumeId: id })
            }
            onNewProfile={() => setView({ name: 'profile' })}
            onProfileSwitched={() => void refresh()}
            onRecalibrate={() => setView({ name: 'calibration' })}
            onOpenProgress={() => setView({ name: 'progress' })}
            onOpenCareer={() => setView({ name: 'career' })}
            onOpenStudyPlan={() => setView({ name: 'study' })}
          />
        )}
        {view.name === 'progress' && <Progress onBack={() => setView({ name: 'dashboard' })} />}
        {view.name === 'career' && profile && (
          <Career
            profile={profile}
            onBack={() => setView({ name: 'dashboard' })}
            onTargeted={() => void refresh()}
          />
        )}
        {view.name === 'study' && profile && (
          <StudyPlan
            profile={profile}
            onBack={() => setView({ name: 'dashboard' })}
            onDrill={(weaknessId) =>
              setView({ name: 'interview', mode: 'text', kind: 'coaching', domain: 'technical', weaknessId })
            }
          />
        )}
        {view.name === 'memory' && <Memory onBack={() => setView({ name: 'dashboard' })} />}
        {view.name === 'interview' && profile && (
          <Interview
            profile={profile}
            mode={view.mode}
            kind={view.kind}
            domain={view.domain}
            weaknessId={view.weaknessId}
            resumeId={view.resumeId}
            onExit={() => void refresh()}
          />
        )}
      </div>
    </>
  )
}
