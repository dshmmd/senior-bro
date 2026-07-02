import { useEffect, useState } from 'react'
import {
  api,
  type InterviewDomain,
  type InterviewSummary,
  type Profile,
  type ProfileListItem,
  type Weakness,
} from '../api'
import { voiceSupported } from '../voice'
import { ReportView } from './Report'

export function Dashboard({
  profile,
  email,
  onStartInterview,
  onResumeInterview,
  onNewProfile,
  onProfileSwitched,
  onRecalibrate,
  onOpenProgress,
  onOpenCareer,
}: {
  profile: Profile
  email: string | null
  onStartInterview: (
    mode: 'voice' | 'text',
    kind: 'full' | 'coaching',
    domain: InterviewDomain,
    weaknessId?: number,
  ) => void
  onResumeInterview: (id: number, mode: 'voice' | 'text', kind: 'full' | 'coaching') => void
  onNewProfile: () => void
  onProfileSwitched: () => void
  onRecalibrate: () => void
  onOpenProgress: () => void
  onOpenCareer: () => void
}) {
  const [history, setHistory] = useState<InterviewSummary[]>([])
  const [weaknesses, setWeaknesses] = useState<Weakness[]>([])
  const [profiles, setProfiles] = useState<ProfileListItem[]>([])
  const [openReport, setOpenReport] = useState<number | null>(null)
  // Which interview domain the Start cards launch (R33 / D22).
  const [domain, setDomain] = useState<InterviewDomain>('technical')
  const canVoice = voiceSupported()

  const reloadHistory = () =>
    api
      .listInterviews()
      .then(setHistory)
      .catch(() => undefined)

  useEffect(() => {
    void reloadHistory()
    api
      .listWeaknesses()
      .then(setWeaknesses)
      .catch(() => undefined)
    api
      .listProfiles()
      .then((r) => setProfiles(r.profiles))
      .catch(() => undefined)
  }, [])

  // R24: switch which target role/profile the user is working in.
  const switchProfile = (id: number) => {
    if (id === profile.id) return
    void api
      .selectProfile(id)
      .then(onProfileSwitched)
      .catch(() => undefined)
  }

  const open = weaknesses.filter((w) => w.status !== 'resolved')
  // Evidence-gated skills (R23): shown vs. merely claimed.
  const claims = profile.skill_claims ?? []
  // The most recent unfinished interview is the one we offer to resume (D14).
  const resumable = history.find((h) => h.status === 'active') ?? null
  // "Returning" = they've been here and run interviews before (drives the greeting).
  const returning = history.length > 0

  const discard = (id: number) => {
    void api
      .abandonInterview(id)
      .then(reloadHistory)
      .catch(() => undefined)
  }

  // R36: delete a position + all its history. Frees a free-tier "first impression" slot (R32).
  const deleteProfile = (id: number, label: string) => {
    if (
      !window.confirm(
        `Delete "${label}" and all of its interviews, weaknesses and progress? This can't be undone, but it frees a free-tier slot.`,
      )
    )
      return
    void api
      .deleteProfile(id)
      .then(() => {
        setProfiles((ps) => ps.filter((p) => p.id !== id))
        onProfileSwitched()
      })
      .catch(() => undefined)
  }

  if (openReport !== null) return <ReportView interviewId={openReport} onBack={() => setOpenReport(null)} />

  return (
    <>
      <h1>{returning ? 'Welcome back' : 'Ready when you are'}</h1>
      <p className="sub">
        {profile.role}
        {profile.company ? ` @ ${profile.company}` : ''} ·{' '}
        {profile.level && <span className={`badge ${profile.level}`}>{profile.level}</span>}
        {email ? ` · ${email}` : ''}
      </p>

      {profiles.length > 1 && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Profiles:</span>
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
                onClick={() => deleteProfile(p.id, p.role)}
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
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>
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

      <div className="card clickable" onClick={onOpenProgress} style={{ borderColor: 'var(--accent)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b>🌌 Your constellation</b>
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>
              Light up every skill, heal your weaknesses, earn medals — track it all here.
            </div>
          </div>
          <span style={{ fontSize: 22 }}>→</span>
        </div>
      </div>

      {/* Phase 5: résumé boost + job matches driven by interview evidence. */}
      <div className="card clickable" onClick={onOpenCareer}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b>🚀 Career tools</b>
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>
              Boost your résumé from what you&apos;ve proven, and find matched job openings to target.
            </div>
          </div>
          <span style={{ fontSize: 22 }}>→</span>
        </div>
      </div>

      {claims.length > 0 && (
        <div className="card">
          <b>Your skills — shown vs. claimed</b>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
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

      <h2>Start a mock interview</h2>
      {/* R33 / D22: pick the interview domain; the cards below launch it in that domain. */}
      <div className="row" style={{ gap: 8, marginBottom: 4, alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>Kind:</span>
        <button className={domain === 'technical' ? '' : 'secondary'} onClick={() => setDomain('technical')}>
          🧠 Technical
        </button>
        <button className={domain === 'hr' ? '' : 'secondary'} onClick={() => setDomain('hr')}>
          🤝 HR / Behavioral
        </button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
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
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
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
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            Classic chat format. Good for code-heavy answers.
          </p>
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
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>{w.detail}</p>
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
                    void api
                      .setWeaknessStatus(w.id, 'resolved')
                      .then(() => api.listWeaknesses().then(setWeaknesses))
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
                      h.status === 'finished' ? setOpenReport(h.id) : onResumeInterview(h.id, h.mode, h.kind)
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
