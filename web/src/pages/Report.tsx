import { useEffect, useState } from 'react'
import { type InterviewReport } from '../api'

export function ReportCard({ report }: { report: InterviewReport }) {
  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="score-ring">{report.overall_score}<span style={{ fontSize: 18, color: 'var(--muted)' }}>/100</span></div>
            <span className={`badge ${report.level_estimate}`}>{report.level_estimate} level performance</span>
          </div>
        </div>
        <div className="mt">
          {report.dimensions.map((d) => (
            <div key={d.name} style={{ padding: '8px 0' }}>
              <div className="dim" style={{ border: 'none', padding: 0 }}>
                <span className="name">{d.name}</span>
                <span className="comment">{d.comment}</span>
                <b>{d.score}/10</b>
              </div>
              <div className="bar"><div style={{ width: `${d.score * 10}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      {report.strengths.length > 0 && (
        <div className="card">
          <b>💪 Strengths</b>
          <ul>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}

      {report.weaknesses.length > 0 && (
        <div className="card">
          <b>🎯 Weaknesses to work on</b> <span style={{ color: 'var(--muted)', fontSize: 13 }}>(saved — drill them from the dashboard)</span>
          {report.weaknesses.map((w, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <b>{w.title}</b>
              <p style={{ margin: '4px 0', color: 'var(--muted)', fontSize: 14 }}>{w.detail}</p>
              <p style={{ margin: 0, fontSize: 14 }}>💡 {w.fix}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <b>🧭 Coach's advice</b>
        <p>{report.advice}</p>
      </div>
    </>
  )
}

export function ReportView({ interviewId, onBack }: { interviewId: number; onBack: () => void }) {
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [transcript, setTranscript] = useState<{ role: string; content: string }[]>([])
  const [showTranscript, setShowTranscript] = useState(false)

  useEffect(() => {
    fetch(`/api/interviews/${interviewId}`)
      .then((r) => r.json())
      .then((d: { report: InterviewReport | null; transcript: { role: string; content: string }[] }) => {
        setReport(d.report)
        setTranscript(d.transcript)
      })
      .catch(() => {})
  }, [interviewId])

  if (!report) return <div className="card msg thinking">Loading report…</div>

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Interview #{interviewId}</h1>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>
      <ReportCard report={report} />
      <button className="secondary mt" onClick={() => setShowTranscript(!showTranscript)}>
        {showTranscript ? 'Hide transcript' : 'Show transcript'}
      </button>
      {showTranscript && (
        <div className="chat mt">
          {transcript.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>{m.content}</div>
          ))}
        </div>
      )}
    </>
  )
}
