import { useEffect, useState } from 'react'
import { api, type InterviewSummary, type Profile, type Weakness } from '../api'
import { voiceSupported } from '../voice'
import { ReportView } from './Report'

export function Dashboard({
  profile,
  email,
  onStartInterview,
  onResumeInterview,
  onNewProfile,
  onRecalibrate,
  onOpenProgress,
}: {
  profile: Profile
  email: string | null
  onStartInterview: (mode: 'voice' | 'text', kind: 'full' | 'coaching', weaknessId?: number) => void
  onResumeInterview: (id: number, mode: 'voice' | 'text', kind: 'full' | 'coaching') => void
  onNewProfile: () => void
  onRecalibrate: () => void
  onOpenProgress: () => void
}) {
  const [history, setHistory] = useState<InterviewSummary[]>([])
  const [weaknesses, setWeaknesses] = useState<Weakness[]>([])
  const [openReport, setOpenReport] = useState<number | null>(null)
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
  }, [])

  const open = weaknesses.filter((w) => w.status !== 'resolved')
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

      <h2>Start a mock interview</h2>
      <div className="row">
        <div
          className="card clickable"
          style={{ flex: 1 }}
          onClick={() => canVoice && onStartInterview('voice', 'full')}
        >
          <b>🎙️ Voice interview</b>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {canVoice
              ? 'Talk out loud like the real thing. The interviewer speaks back.'
              : 'Not supported in this browser — try Chrome, Edge, or Safari.'}
          </p>
        </div>
        <div className="card clickable" style={{ flex: 1 }} onClick={() => onStartInterview('text', 'full')}>
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
                <button onClick={() => onStartInterview('text', 'coaching', w.id)}>Drill this (text)</button>
                {canVoice && (
                  <button className="secondary" onClick={() => onStartInterview('voice', 'coaching', w.id)}>
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
                    <td>{h.kind}</td>
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
