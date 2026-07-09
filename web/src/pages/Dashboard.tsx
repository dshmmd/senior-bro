import { useState } from 'react'
import { api, type InterviewDomain, type Profile } from '../api'
import { voiceSupported } from '../voice'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { NavCard } from '../components/Card'
import { useInterviews, useProfiles, useWeaknesses } from '../queries'
import { useQuery } from '@tanstack/react-query'
import { interviewsLabel } from '../strings'
import { useQueryClient } from '@tanstack/react-query'

export function Dashboard({
  profile,
  email,
  hosted,
  interviewReady,
  creditLeft,
  firstImpressionsUsed,
  firstImpressionsLimit,
  interviewEstimate,
  onStartInterview,
  onResumeInterview,
  onOpenReport,
  onNewProfile,
  onProfileSwitched,
  onRecalibrate,
  onOpenProgress,
  onOpenCareer,
  onOpenStudyPlan,
}: {
  profile: Profile
  email: string | null
  hosted: boolean
  interviewReady: boolean
  creditLeft: number | null
  firstImpressionsUsed: number
  firstImpressionsLimit: number
  interviewEstimate: number
  onStartInterview: (
    mode: 'voice' | 'text',
    kind: 'full' | 'coaching',
    domain: InterviewDomain,
    weaknessId?: number,
  ) => void
  onResumeInterview: (id: number, mode: 'voice' | 'text', kind: 'full' | 'coaching') => void
  onOpenReport: (id: number) => void
  onNewProfile: () => void
  onProfileSwitched: () => void
  onRecalibrate: () => void
  onOpenProgress: () => void
  onOpenCareer: () => void
  onOpenStudyPlan: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const interviews = useInterviews()
  const weaknessesQ = useWeaknesses()
  const profilesQ = useProfiles()
  // RF-8: streak nudge — the daily-practice fire lives on the dashboard header.
  const progressQ = useQuery({ queryKey: ['progress'], queryFn: api.progress })
  const streak = Math.max(0, ...(progressQ.data?.domains.map((d) => d.progress.streak.current) ?? [0]))
  // Which interview domain the Start cards launch (R33 / D22).
  const [domain, setDomain] = useState<InterviewDomain>('technical')
  const canVoice = voiceSupported()

  const history = interviews.data ?? []
  const weaknesses = weaknessesQ.data ?? []
  const profiles = profilesQ.data?.profiles ?? []

  // R24: switch which target role/profile the user is working in.
  const switchProfile = (id: number) => {
    if (id === profile.id) return
    api.selectProfile(id).then(onProfileSwitched).catch(toast.error)
  }

  const open = weaknesses.filter((w) => w.status !== 'resolved')
  // Evidence-gated skills (R23): shown vs. merely claimed.
  const claims = profile.skill_claims ?? []
  // The most recent unfinished interview is the one we offer to resume (D14).
  const resumable = history.find((h) => h.status === 'active') ?? null
  // "Returning" = they've been here and run interviews before (drives the greeting).
  const returning = history.length > 0

  const discard = (id: number) => {
    api
      .abandonInterview(id)
      .then(() => qc.invalidateQueries({ queryKey: ['interviews'] }))
      .catch(toast.error)
  }

  // R36: delete a position + all its history. Frees a free-tier "first impression" slot (R32).
  const deleteProfile = async (id: number, label: string) => {
    const ok = await confirm({
      title: `Delete "${label}"?`,
      body: "All of its interviews, weaknesses and progress go with it. This can't be undone, but it frees a free-tier slot.",
      confirmLabel: 'Delete position',
      danger: true,
    })
    if (!ok) return
    api
      .deleteProfile(id)
      .then(() => {
        toast.success(`Deleted "${label}"`)
        onProfileSwitched()
      })
      .catch(toast.error)
  }

  return (
    <>
      <h1>
        {returning ? 'Welcome back' : 'Ready when you are'}
        {streak > 1 && (
          <span className="badge senior" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
            🔥 {streak}-day streak
          </span>
        )}
      </h1>
      <p className="sub">
        {profile.role}
        {profile.company ? ` @ ${profile.company}` : ''} ·{' '}
        {profile.level && <span className={`badge ${profile.level}`}>{profile.level}</span>}
        {email ? ` · ${email}` : ''}
      </p>

      {profiles.length > 1 && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span className="muted fs-sm">Profiles:</span>
          {profiles.map((p) => (
            <span key={p.id} className="row" style={{ gap: 2, alignItems: 'center' }}>
              <button
                className={p.id === profile.id ? '' : 'secondary'}
                onClick={() => switchProfile(p.id)}
                title={p.company ?? undefined}
              >
                {p.role}
                {p.level ? ` · ${p.level}` : ''}
              </button>
              <button
                className="ghost"
                title="Delete this position and its history"
                aria-label={`Delete ${p.role}`}
                onClick={() => void deleteProfile(p.id, p.role)}
                style={{ padding: '2px 6px' }}
              >
                ✕
              </button>
            </span>
          ))}
          <button className="ghost" onClick={onNewProfile}>
            + New
          </button>
        </div>
      )}

      {resumable && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <b>⏸️ You have an interview in progress</b>
              <div className="muted fs-md">
                {resumable.kind === 'coaching' ? 'Coaching drill' : 'Mock interview'} · {resumable.mode} ·{' '}
                {resumable.turns} turn{resumable.turns === 1 ? '' : 's'} · started{' '}
                {resumable.created_at.slice(0, 16)}. Pick up exactly where you left off.
              </div>
            </div>
            <div className="row">
              <button onClick={() => onResumeInterview(resumable.id, resumable.mode, resumable.kind)}>
                Resume →
              </button>
              <button className="secondary" onClick={() => discard(resumable.id)}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <NavCard
        accent
        title="🌌 Your constellation"
        hint="Light up every skill, heal your weaknesses, earn medals — track it all here."
        onClick={onOpenProgress}
      />

      {/* Phase 7: post-interview study plan from the user's demonstrated gaps. */}
      {history.some((h) => h.status === 'finished') && (
        <NavCard
          title="📚 Study plan"
          hint="A prioritized plan from your gaps — drill each straight from the list."
          onClick={onOpenStudyPlan}
        />
      )}

      {/* Phase 5: résumé boost + job matches driven by interview evidence. */}
      <NavCard
        title="🚀 Career tools"
        hint="Boost your résumé from what you've proven, and find matched job openings to target."
        onClick={onOpenCareer}
      />

      {claims.length > 0 && (
        <div className="card">
          <b>Your skills — shown vs. claimed</b>
          <div className="muted fs-sm" style={{ marginTop: 2 }}>
            We only count a skill once you&apos;ve proven it in an interview — not just listed it.
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {claims.map((c) => {
              const badge =
                c.status === 'demonstrated'
                  ? { cls: 'badge resolved', label: '✓ shown' }
                  : c.status === 'weak'
                    ? { cls: 'badge open', label: 'needs work' }
                    : { cls: 'badge', label: 'claimed — unproven' }
              return (
                <span
                  key={c.id}
                  className={badge.cls}
                  title={c.evidence ?? 'Not yet demonstrated in an interview'}
                  style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
                >
                  {c.skill} · {badge.label}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Cost clarity (hosted): free first impressions vs. metered interviews, and whether the
          user can start one right now. Local mode is unrestricted, so this is hosted-only. */}
      {hosted && (
        <div className="card" style={{ borderColor: interviewReady ? undefined : 'var(--accent)' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <b>{interviewReady ? '✅ Ready to interview' : '💳 Add practice interviews to start'}</b>
              <div className="muted fs-sm" style={{ marginTop: 2 }}>
                Your{' '}
                <b>
                  {firstImpressionsUsed}/{firstImpressionsLimit}
                </b>{' '}
                free first steps (résumé, company research, placement chat) are used up as you add positions.
                Practice interviews come from your bundle
                {creditLeft !== null ? ` — ${interviewsLabel(creditLeft, interviewEstimate)} left` : ''}.
                Voice is always included.
              </div>
            </div>
            {!interviewReady && (
              <span className="badge open" style={{ alignSelf: 'center' }}>
                set up to start
              </span>
            )}
          </div>
        </div>
      )}

      <h2>Start a mock interview</h2>
      {hosted && !interviewReady && (
        <p className="muted fs-sm" style={{ marginTop: 0 }}>
          Starting an interview will open setup (add a bundle + pick your interviewer).
        </p>
      )}
      {/* R33 / D22: pick the interview domain; the cards below launch it in that domain. */}
      <div className="row" style={{ gap: 8, marginBottom: 4, alignItems: 'center' }}>
        <span className="muted fs-sm">Kind:</span>
        <button className={domain === 'technical' ? '' : 'secondary'} onClick={() => setDomain('technical')}>
          🧠 Technical
        </button>
        <button className={domain === 'hr' ? '' : 'secondary'} onClick={() => setDomain('hr')}>
          🤝 HR / Behavioral
        </button>
      </div>
      <p className="muted fs-sm" style={{ marginTop: 0 }}>
        {domain === 'hr'
          ? 'Culture fit, motivation, teamwork and conflict — STAR-style behavioral questions.'
          : 'Coding depth, system design and technical trade-offs, calibrated to your level.'}
      </p>
      <div className="row">
        <div
          className="card clickable"
          style={{ flex: 1 }}
          onClick={() => canVoice && onStartInterview('voice', 'full', domain)}
        >
          <b>🎙️ Voice interview</b>
          <p className="muted fs-md">
            {canVoice
              ? 'Talk out loud like the real thing. The interviewer speaks back.'
              : 'Not supported in this browser — try Chrome, Edge, or Safari.'}
          </p>
        </div>
        <div
          className="card clickable"
          style={{ flex: 1 }}
          onClick={() => onStartInterview('text', 'full', domain)}
        >
          <b>⌨️ Text interview</b>
          <p className="muted fs-md">Classic chat format. Good for code-heavy answers.</p>
        </div>
      </div>

      {open.length > 0 && (
        <>
          <h2>Fix your weaknesses ({open.length} open)</h2>
          {open.map((w) => (
            <div className="card" key={w.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{w.title}</b>
                <span className={`badge ${w.status}`}>{w.status}</span>
              </div>
              <p className="muted fs-md">{w.detail}</p>
              {w.fix && <p style={{ fontSize: 14 }}>💡 {w.fix}</p>}
              <div className="row">
                <button onClick={() => onStartInterview('text', 'coaching', 'technical', w.id)}>
                  Drill this (text)
                </button>
                {canVoice && (
                  <button
                    className="secondary"
                    onClick={() => onStartInterview('voice', 'coaching', 'technical', w.id)}
                  >
                    Drill with voice
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => {
                    api
                      .setWeaknessStatus(w.id, 'resolved')
                      .then(() => qc.invalidateQueries({ queryKey: ['weaknesses'] }))
                      .catch(toast.error)
                  }}
                >
                  Mark resolved
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {history.length > 0 && (
        <>
          <h2>History</h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Mode</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Level</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr
                    key={h.id}
                    className="clickable"
                    onClick={() =>
                      h.status === 'finished' ? onOpenReport(h.id) : onResumeInterview(h.id, h.mode, h.kind)
                    }
                  >
                    <td>{h.id}</td>
                    <td>{h.kind === 'coaching' ? 'coaching' : h.domain === 'hr' ? 'HR' : 'technical'}</td>
                    <td>{h.mode}</td>
                    <td>{h.created_at.slice(0, 16)}</td>
                    <td>
                      {h.status === 'active' ? (
                        <span className="badge improving">in progress</span>
                      ) : (
                        (h.overall_score ?? '—')
                      )}
                    </td>
                    <td>
                      {h.status === 'active' ? (
                        'resume →'
                      ) : h.level_estimate ? (
                        <span className={`badge ${h.level_estimate}`}>{h.level_estimate}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="row mt">
        <button className="secondary" onClick={onRecalibrate}>
          Re-run level check
        </button>
        <button className="secondary" onClick={onNewProfile}>
          New target role
        </button>
      </div>
    </>
  )
}
