import { useEffect, useState } from 'react'
import { api, type InterviewSummary, type Profile, type Weakness } from '../api'
import { voiceSupported } from '../voice'
import { ReportView } from './Report'

export function Dashboard({
  profile,
  onStartInterview,
  onNewProfile,
  onRecalibrate,
}: {
  profile: Profile
  onStartInterview: (mode: 'voice' | 'text', kind: 'full' | 'coaching', weaknessId?: number) => void
  onNewProfile: () => void
  onRecalibrate: () => void
}) {
  const [history, setHistory] = useState<InterviewSummary[]>([])
  const [weaknesses, setWeaknesses] = useState<Weakness[]>([])
  const [openReport, setOpenReport] = useState<number | null>(null)
  const canVoice = voiceSupported()

  useEffect(() => {
    api.listInterviews().then(setHistory).catch(() => {})
    api.listWeaknesses().then(setWeaknesses).catch(() => {})
  }, [])

  const open = weaknesses.filter((w) => w.status !== 'resolved')

  if (openReport !== null) return <ReportView interviewId={openReport} onBack={() => setOpenReport(null)} />

  return (
    <>
      <h1>Ready when you are</h1>
      <p className="sub">
        {profile.role}
        {profile.company ? ` @ ${profile.company}` : ''} ·{' '}
        {profile.level && <span className={`badge ${profile.level}`}>{profile.level}</span>}
      </p>

      <h2>Start a mock interview</h2>
      <div className="row">
        <div className="card clickable" style={{ flex: 1 }} onClick={() => canVoice && onStartInterview('voice', 'full')}>
          <b>🎙️ Voice interview</b>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {canVoice
              ? 'Talk out loud like the real thing. The interviewer speaks back.'
              : 'Not supported in this browser — try Chrome, Edge, or Safari.'}
          </p>
        </div>
        <div className="card clickable" style={{ flex: 1 }} onClick={() => onStartInterview('text', 'full')}>
          <b>⌨️ Text interview</b>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Classic chat format. Good for code-heavy answers.</p>
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
                    void api.setWeaknessStatus(w.id, 'resolved').then(() => api.listWeaknesses().then(setWeaknesses))
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
                <tr><th>#</th><th>Type</th><th>Mode</th><th>Date</th><th>Score</th><th>Level</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr
                    key={h.id}
                    className={h.status === 'finished' ? 'clickable' : ''}
                    onClick={() => h.status === 'finished' && setOpenReport(h.id)}
                  >
                    <td>{h.id}</td>
                    <td>{h.kind}</td>
                    <td>{h.mode}</td>
                    <td>{h.created_at.slice(0, 16)}</td>
                    <td>{h.overall_score ?? '—'}</td>
                    <td>{h.level_estimate ? <span className={`badge ${h.level_estimate}`}>{h.level_estimate}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="row mt">
        <button className="secondary" onClick={onRecalibrate}>Re-run level check</button>
        <button className="secondary" onClick={onNewProfile}>New target role</button>
      </div>
    </>
  )
}
