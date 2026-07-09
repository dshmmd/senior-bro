// App shell (RF-5): real URL routing (React Router), central query cache, and the
// account/entitlement gates. Every view has a URL — refresh, browser Back, and
// deep links all work; pages stay presentational and get callbacks wired to
// navigation here.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { api, type InterviewDomain } from './api'
import { queryClient, useHealth, useInvalidateSession, useProfile } from './queries'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/Confirm'
import { Skeleton } from './components/Skeleton'
import { Icon } from './components/Icon'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { AdminOverview } from './pages/admin/Overview'
import { AdminModels } from './pages/admin/Models'
import { AdminFeatures } from './pages/admin/Features'
import { AdminPrompts } from './pages/admin/Prompts'
import { AdminPacks } from './pages/admin/Packs'
import { AdminUsers } from './pages/admin/Users'
import { AdminInvites } from './pages/admin/Invites'
import { AdminUsage } from './pages/admin/Usage'
import { AdminAudit } from './pages/admin/Audit'
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
import { ReportView } from './pages/Report'

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

const magicToken = () => new URLSearchParams(window.location.search).get('magic')

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Entry />} />
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<Shell />}>
                <Route path="/setup" element={<SetupRoute />} />
                <Route path="/profile" element={<Gate need="none" children={<ProfileRoute />} />} />
                <Route
                  path="/calibration"
                  element={<Gate need="profile" children={<CalibrationRoute />} />}
                />
                <Route path="/plan" element={<Gate need="none" children={<PlanRoute />} />} />
                <Route path="/dashboard" element={<Gate need="level" children={<DashboardRoute />} />} />
                <Route path="/progress" element={<Gate need="level" children={<ProgressRoute />} />} />
                <Route path="/career" element={<Gate need="level" children={<CareerRoute />} />} />
                <Route path="/study" element={<Gate need="level" children={<StudyRoute />} />} />
                <Route path="/memory" element={<Gate need="level" children={<MemoryRoute />} />} />
                <Route path="/admin" element={<AdminGuard children={<AdminOverview />} />} />
                <Route path="/admin/models" element={<AdminGuard children={<AdminModels />} />} />
                <Route path="/admin/features" element={<AdminGuard children={<AdminFeatures />} />} />
                <Route path="/admin/prompts" element={<AdminGuard children={<AdminPrompts />} />} />
                <Route path="/admin/packs" element={<AdminGuard children={<AdminPacks />} />} />
                <Route path="/admin/users" element={<AdminGuard children={<AdminUsers />} />} />
                <Route path="/admin/invites" element={<AdminGuard children={<AdminInvites />} />} />
                <Route path="/admin/usage" element={<AdminGuard children={<AdminUsage />} />} />
                <Route path="/admin/audit" element={<AdminGuard children={<AdminAudit />} />} />
                <Route path="/report/:id" element={<Gate need="level" children={<ReportRoute />} />} />
                <Route
                  path="/interview/new"
                  element={<Gate need="level" children={<InterviewNewRoute />} />}
                />
                <Route
                  path="/interview/:id"
                  element={<Gate need="level" children={<InterviewResumeRoute />} />}
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}

/**
 * `/` — the front door. Handles a magic-link token, then routes returning users
 * into the app and first-timers to the landing page.
 */
function Entry() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  const magic = magicToken()

  useEffect(() => {
    if (!magic) return
    localStorage.setItem('sb-entered', '1')
    void api
      .verifyMagicLink(magic)
      .catch(() => undefined) // an invalid link just falls through to the login screen
      .finally(() => {
        window.history.replaceState({}, '', '/')
        void invalidate().then(() => navigate('/dashboard', { replace: true }))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (magic) return <Connecting />
  if (localStorage.getItem('sb-entered')) return <Navigate to="/dashboard" replace />
  return (
    <Landing
      onEnter={() => {
        localStorage.setItem('sb-entered', '1')
        void navigate('/dashboard')
      }}
    />
  )
}

function LoginRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  return (
    <Login
      onSignedIn={() => {
        localStorage.setItem('sb-entered', '1')
        void invalidate().then(() => navigate('/dashboard'))
      }}
    />
  )
}

function Connecting() {
  const invalidate = useInvalidateSession()
  return (
    <div className="shell">
      <div className="card">
        Connecting to the Senior Bro server… make sure it's running (<code>npm run dev</code>).
        <div className="mt">
          <button onClick={() => void invalidate()}>Retry</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Account/entitlement gate for app routes (deep-link safe): waits for health,
 * bounces unauthenticated hosted users to /login, unconfigured local users to
 * /setup, and profile-less / uncalibrated users to the onboarding step they need.
 */
function Gate({ need, children }: { need: 'none' | 'profile' | 'level'; children: ReactNode }) {
  const health = useHealth()
  const wantProfile = need !== 'none'
  const profile = useProfile(
    health.data !== undefined && (health.data.mode === 'local' || health.data.authed),
  )

  if (health.isPending) return <Skeleton lines={2} />
  if (health.isError) return <Connecting />
  const h = health.data
  const hosted = h.mode === 'hosted'
  if (hosted && !h.authed) return <Navigate to="/login" replace />
  // Local mode needs something configured up front (a CLI subscription or a selected
  // provided model); hosted defers everything to interview-start.
  if (!hosted && !h.configured && !h.has_model && need !== 'none') return <Navigate to="/setup" replace />
  if (!wantProfile) return <>{children}</>
  if (profile.isPending) return <Skeleton lines={3} />
  const p = profile.data ?? null
  if (!p) return <Navigate to="/profile" replace />
  if (need === 'level' && !p.level) return <Navigate to="/calibration" replace />
  return <>{children}</>
}

/** The persistent chrome: topbar, offline banner, R21 back button, and the page outlet. */
function Shell() {
  const navigate = useNavigate()
  const location = useLocation()
  const health = useHealth()
  const profile = useProfile(health.data !== undefined)
  const invalidate = useInvalidateSession()
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)

  const h = health.data
  const hosted = h?.mode === 'hosted'
  const p = profile.data ?? null

  const logout = async () => {
    await api.logout().catch(() => undefined)
    await invalidate()
    void navigate('/login')
  }

  // R21: never dead-end on settings/onboarding screens once a calibrated profile exists.
  const backable = ['/setup', '/plan', '/profile', '/calibration'].includes(location.pathname)

  return (
    <>
      {!online && (
        <div className="offline-banner">
          ⚠ You're offline — answers can't reach the interviewer right now.
        </div>
      )}
      <div className="topbar">
        <button
          className="logo"
          onClick={() => {
            localStorage.removeItem('sb-entered')
            void navigate('/')
          }}
        >
          🎙️ Senior <span>Bro</span>
        </button>
        <div className="spacer" />
        {p && (
          <span className="pill">
            {p.role}
            {p.level ? ` · ${p.level}` : ''}
          </span>
        )}
        {hosted && (
          <button className="pill clickable" onClick={() => void navigate('/plan')}>
            <Icon name="wallet" size={13} /> Plan
          </button>
        )}
        {p?.level && (
          <button className="pill clickable" onClick={() => void navigate('/memory')}>
            <Icon name="brain" size={13} /> You
          </button>
        )}
        {h?.user?.role === 'admin' && (
          <button className="pill clickable" onClick={() => void navigate('/admin')}>
            <Icon name="tools" size={13} /> Admin
          </button>
        )}
        <button className="pill clickable" onClick={() => void navigate('/setup')}>
          <Icon name="gear" size={13} /> Settings
        </button>
        {hosted && (
          <button
            className="pill clickable"
            title={h.user?.email ? `Signed in as ${h.user.email}` : undefined}
            onClick={() => void logout()}
          >
            <Icon name="exit" size={13} /> {h.user?.email ?? 'Sign out'}
          </button>
        )}
      </div>
      <div className="shell">
        {p?.level && backable && (
          <button className="ghost" onClick={() => void navigate('/dashboard')}>
            <Icon name="back" size={13} /> Back
          </button>
        )}
        <Outlet />
      </div>
    </>
  )
}

// ── route wrappers: supply navigation + invalidation to the presentational pages ──

function SetupRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  const health = useHealth()
  if (health.isPending) return <Skeleton lines={2} />
  if (health.isError) return <Connecting />
  if (health.data.mode === 'hosted' && !health.data.authed) return <Navigate to="/login" replace />
  return (
    <Setup
      hosted={health.data.mode === 'hosted'}
      onDone={() => void invalidate().then(() => navigate('/dashboard'))}
    />
  )
}

function ProfileRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  return <ProfileSetup onDone={() => void invalidate().then(() => navigate('/calibration'))} />
}

function CalibrationRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  const profile = useProfile()
  if (profile.isPending || !profile.data) return <Skeleton lines={3} />
  return (
    <Calibration profile={profile.data} onDone={() => void invalidate().then(() => navigate('/dashboard'))} />
  )
}

function PlanRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  return <Plan onDone={() => void invalidate().then(() => navigate('/dashboard'))} />
}

/** Interview-start gate: metered hosted users without a model/balance go to the plan chooser. */
function useStartInterview() {
  const navigate = useNavigate()
  const health = useHealth()
  return (
    mode: 'voice' | 'text',
    kind: 'full' | 'coaching',
    domain: InterviewDomain,
    weaknessId?: number,
  ) => {
    const h = health.data
    if (h?.mode === 'hosted' && !h.interview_ready) {
      void navigate('/plan')
      return
    }
    const params = new URLSearchParams({ mode, kind, domain })
    if (weaknessId !== undefined) params.set('weakness', String(weaknessId))
    void navigate(`/interview/new?${params.toString()}`)
  }
}

function DashboardRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  const health = useHealth()
  const profile = useProfile()
  const startInterview = useStartInterview()
  const h = health.data
  if (!h || profile.isPending || !profile.data) return <Skeleton lines={4} />
  return (
    <Dashboard
      profile={profile.data}
      email={h.user?.email ?? null}
      hosted={h.mode === 'hosted'}
      interviewReady={h.interview_ready}
      creditLeft={h.credit_left}
      firstImpressionsUsed={h.first_impressions_used}
      firstImpressionsLimit={h.first_impressions_limit}
      interviewEstimate={h.interview_estimate_tokens}
      onStartInterview={startInterview}
      onResumeInterview={(id, mode, kind) => void navigate(`/interview/${id}?mode=${mode}&kind=${kind}`)}
      onOpenReport={(id) => void navigate(`/report/${id}`)}
      onNewProfile={() => void navigate('/profile')}
      onProfileSwitched={() => void invalidate()}
      onRecalibrate={() => void navigate('/calibration')}
      onOpenProgress={() => void navigate('/progress')}
      onOpenCareer={() => void navigate('/career')}
      onOpenStudyPlan={() => void navigate('/study')}
    />
  )
}

function ProgressRoute() {
  const navigate = useNavigate()
  return <Progress onBack={() => void navigate('/dashboard')} />
}

function CareerRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  const profile = useProfile()
  if (profile.isPending || !profile.data) return <Skeleton lines={3} />
  return (
    <Career
      profile={profile.data}
      onBack={() => void navigate('/dashboard')}
      onTargeted={() => void invalidate()}
    />
  )
}

function StudyRoute() {
  const navigate = useNavigate()
  const profile = useProfile()
  const startInterview = useStartInterview()
  if (profile.isPending || !profile.data) return <Skeleton lines={3} />
  return (
    <StudyPlan
      profile={profile.data}
      onBack={() => void navigate('/dashboard')}
      onDrill={(weaknessId) => startInterview('text', 'coaching', 'technical', weaknessId)}
    />
  )
}

function MemoryRoute() {
  const navigate = useNavigate()
  return <Memory onBack={() => void navigate('/dashboard')} />
}

/** Admin-only gate (RF-9): hosted non-admins bounce to the dashboard; local owner is admin. */
function AdminGuard({ children }: { children: ReactNode }) {
  const health = useHealth()
  if (health.isPending) return <Skeleton lines={3} />
  if (health.data?.user?.role !== 'admin' && health.data?.mode === 'hosted')
    return <Navigate to="/dashboard" replace />
  return <Gate need="none">{children}</Gate>
}

function ReportRoute() {
  const navigate = useNavigate()
  const { id } = useParams()
  const interviewId = Number(id)
  if (!Number.isInteger(interviewId) || interviewId <= 0) return <Navigate to="/dashboard" replace />
  return <ReportView interviewId={interviewId} onBack={() => void navigate('/dashboard')} />
}

const asMode = (v: string | null): 'voice' | 'text' => (v === 'voice' ? 'voice' : 'text')
const asKind = (v: string | null): 'full' | 'coaching' => (v === 'coaching' ? 'coaching' : 'full')
const asDomain = (v: string | null): InterviewDomain => (v === 'hr' ? 'hr' : 'technical')

function InterviewNewRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  const profile = useProfile()
  const [params] = useSearchParams()
  if (profile.isPending || !profile.data) return <Skeleton lines={3} />
  const weakness = params.get('weakness')
  return (
    <Interview
      profile={profile.data}
      mode={asMode(params.get('mode'))}
      kind={asKind(params.get('kind'))}
      domain={asDomain(params.get('domain'))}
      weaknessId={weakness ? Number(weakness) : undefined}
      onExit={() => void invalidate().then(() => navigate('/dashboard'))}
      onProgress={() => void invalidate().then(() => navigate('/progress'))}
    />
  )
}

function InterviewResumeRoute() {
  const navigate = useNavigate()
  const invalidate = useInvalidateSession()
  const profile = useProfile()
  const { id } = useParams()
  const [params] = useSearchParams()
  const resumeId = Number(id)
  if (!Number.isInteger(resumeId) || resumeId <= 0) return <Navigate to="/dashboard" replace />
  if (profile.isPending || !profile.data) return <Skeleton lines={3} />
  return (
    <Interview
      profile={profile.data}
      mode={asMode(params.get('mode'))}
      kind={asKind(params.get('kind'))}
      domain={asDomain(params.get('domain'))}
      resumeId={resumeId}
      onExit={() => void invalidate().then(() => navigate('/dashboard'))}
      onProgress={() => void invalidate().then(() => navigate('/progress'))}
    />
  )
}
