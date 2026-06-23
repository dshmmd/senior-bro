import { useEffect, useRef, useState } from 'react'
import { api, type Progress as ProgressData } from '../api'
import { createConstellation, type Constellation } from '../progress/constellation'
import '../progress.css'

function HeatStrip({ days }: { days: { date: string; count: number }[] }) {
  return (
    <div className="heatstrip">
      {days.map((d) => (
        <span
          key={d.date}
          className={`heatcell lvl${Math.min(d.count, 3)}`}
          title={`${d.date}: ${d.count} interview${d.count === 1 ? '' : 's'}`}
        />
      ))}
    </div>
  )
}

export function Progress({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<ProgressData | null>(null)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Constellation | null>(null)

  useEffect(() => {
    api
      .progress()
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!data || !canvasRef.current) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    sceneRef.current = createConstellation(canvasRef.current, data, reduced)
    return () => sceneRef.current?.destroy()
  }, [data])

  if (loading) return <div className="card msg thinking">Charting your constellation…</div>

  if (!data || data.interviews_total === 0)
    return (
      <>
        <h1>Your constellation</h1>
        <div className="card">
          Your skill map is still dark. Finish your first interview and watch the stars switch on — each
          dimension you do well lights a cluster, and mastering one crystallizes it into a medal.
          <div className="mt">
            <button onClick={onBack}>Back to dashboard →</button>
          </div>
        </div>
      </>
    )

  const earnedMedals = data.medals.filter((m) => m.earned)
  const lockedMedals = data.medals.filter((m) => !m.earned)
  const pct = Math.round(data.overall_completion * 100)
  const allResolved =
    data.weaknesses.total > 0 && data.weaknesses.open === 0 && data.weaknesses.improving === 0

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: '12px 0' }}>Your constellation</h1>
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
      </div>

      {allResolved && (
        <div className="finale">🏆 Every weakness conquered — your sky is complete. Legendary.</div>
      )}

      <div className="constellation-wrap">
        <canvas ref={canvasRef} className="constellation" />
        <div className="completion-badge">
          <b>{pct}%</b>
          <span>sky lit</span>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <b>{data.interviews_total}</b>
          <span>interviews</span>
        </div>
        <div className="stat">
          <b>🔥 {data.streak.current}</b>
          <span>day streak</span>
        </div>
        <div className="stat">
          <b>{data.weaknesses.resolved}</b>
          <span>weaknesses fixed</span>
        </div>
        <div className="stat">
          <b>{earnedMedals.length}</b>
          <span>medals earned</span>
        </div>
      </div>

      <h2>Level trail</h2>
      <div className="trail">
        {data.level_trail.map((l, i) => (
          <div
            key={l.label}
            className={`trail-stop ${l.reached ? 'reached' : ''} ${l.current ? 'current' : ''}`}
          >
            <span className="dot" />
            <span className="trail-label">{l.label}</span>
            {i < data.level_trail.length - 1 && (
              <span className={`trail-line ${l.reached ? 'reached' : ''}`} />
            )}
          </div>
        ))}
      </div>

      <h2>Practice activity</h2>
      <div className="card">
        <HeatStrip days={data.streak.days} />
        <div className="heat-legend">
          last 12 weeks · longest streak {data.streak.longest} day{data.streak.longest === 1 ? '' : 's'}
        </div>
      </div>

      <h2>Medals {earnedMedals.length > 0 && <span className="badge senior">{earnedMedals.length}</span>}</h2>
      <div className="medal-grid">
        {[...earnedMedals, ...lockedMedals].map((m) => (
          <div key={m.id} className={`medal ${m.earned ? 'earned' : 'locked'}`} title={m.detail}>
            <div className="medal-icon">{m.earned ? m.icon : '🔒'}</div>
            <b>{m.title}</b>
            <p>{m.detail}</p>
          </div>
        ))}
      </div>

      <h2>Weakness rifts</h2>
      <div className="card">
        {data.weaknesses.total === 0 ? (
          <span style={{ color: 'var(--muted)' }}>
            No weaknesses detected yet — they appear here after evaluations.
          </span>
        ) : (
          <div className="rift-bar">
            <div className="rift open" style={{ flex: data.weaknesses.open || 0.001 }}>
              {data.weaknesses.open > 0 && `${data.weaknesses.open} open`}
            </div>
            <div className="rift improving" style={{ flex: data.weaknesses.improving || 0.001 }}>
              {data.weaknesses.improving > 0 && `${data.weaknesses.improving} improving`}
            </div>
            <div className="rift resolved" style={{ flex: data.weaknesses.resolved || 0.001 }}>
              {data.weaknesses.resolved > 0 && `${data.weaknesses.resolved} healed`}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
