import { useEffect, useState } from 'react'
import { api, type Profile, type StudyPlan as StudyPlanData } from '../api'

/**
 * Phase 7 — post-interview study plan. Turns the profile's demonstrated gaps into a prioritized
 * plan; items tied to a weakness launch a coaching drill in one tap.
 */
export function StudyPlan({
  profile,
  onBack,
  onDrill,
}: {
  profile: Profile
  onBack: () => void
  onDrill: (weaknessId: number) => void
}) {
  const [plan, setPlan] = useState<StudyPlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .studyPlan(profile.id)
      .then(setPlan)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [profile.id])

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: '12px 0' }}>📚 Your study plan</h1>
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
      </div>

      {loading && <div className="card msg thinking">Building your plan from what you&apos;ve shown…</div>}
      {error && <div className="error">{error}</div>}

      {plan && (
        <>
          <p className="sub">{plan.overview}</p>
          {plan.items.map((it, i) => (
            <div className="card" key={i}>
              <b>
                {i + 1}. {it.topic}
              </b>
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>{it.focus}</p>
              <p style={{ fontSize: 14 }}>▶️ {it.practice}</p>
              {it.weakness_id !== null && (
                <button onClick={() => onDrill(it.weakness_id!)}>Drill this weakness →</button>
              )}
            </div>
          ))}
          {plan.items.length === 0 && (
            <div className="card" style={{ color: 'var(--muted)' }}>
              Nothing to plan yet — finish an interview and your gaps will shape a plan here.
            </div>
          )}
        </>
      )}
    </>
  )
}
