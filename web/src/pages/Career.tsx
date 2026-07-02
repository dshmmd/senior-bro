import { useState } from 'react'
import { api, type Opportunity, type Profile, type ResumeReview } from '../api'

/**
 * Phase 5 — résumé & opportunity pipeline. Two evidence-driven tools on one page:
 *  - Résumé boost: what the user's interviews prove that their résumé undersells.
 *  - Job matches: live openings match-scored to the profile, each adoptable as the interview target.
 */
export function Career({
  profile,
  onBack,
  onTargeted,
}: {
  profile: Profile
  onBack: () => void
  onTargeted: () => void
}) {
  const [review, setReview] = useState<ResumeReview | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [opps, setOpps] = useState<Opportunity[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [location, setLocation] = useState('')
  const [targeting, setTargeting] = useState<string | null>(null)
  const [error, setError] = useState('')

  const runReview = () => {
    setReviewing(true)
    setError('')
    api
      .resumeReview(profile.id)
      .then(setReview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setReviewing(false))
  }

  const findJobs = () => {
    setFinding(true)
    setError('')
    api
      .discoverOpportunities(profile.id, location.trim() || undefined)
      .then((r) => setOpps(r.opportunities))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setFinding(false))
  }

  const target = (o: Opportunity) => {
    setTargeting(o.company)
    setError('')
    api
      .targetOpportunity(profile.id, o.company, o.title)
      .then(onTargeted)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setTargeting(null))
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: '12px 0' }}>Career tools</h1>
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <h2>📄 Résumé boost</h2>
      <div className="card">
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 0 }}>
          We look at what you&apos;ve actually <b>demonstrated</b> in interviews (not just claimed) and
          suggest honest résumé improvements where you undersell yourself.
        </p>
        <button disabled={reviewing} onClick={runReview}>
          {reviewing ? 'Reviewing…' : review ? 'Re-review' : 'Review my résumé'}
        </button>
        {review && (
          <div className="mt">
            <p>
              <b>{review.summary}</b>
            </p>
            {review.suggestions.map((s, i) => (
              <div key={i} className="card" style={{ background: 'var(--bg-2, transparent)' }}>
                <b>{s.area}</b>
                <p style={{ fontSize: 14, color: 'var(--muted)' }}>{s.insight}</p>
                <p style={{ fontSize: 14 }}>➕ {s.suggested_bullet}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2>🎯 Job matches</h2>
      <div className="card">
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 0 }}>
          Openings matched to your shown level and stack. Pick one to make it your interview target.
        </p>
        <div className="composer" style={{ marginBottom: 8 }}>
          <input
            value={location}
            placeholder="Preferred location (optional, e.g. Berlin / Remote)"
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && findJobs()}
          />
          <button disabled={finding} onClick={findJobs}>
            {finding ? 'Searching…' : 'Find openings'}
          </button>
        </div>
        {opps?.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No openings came back — try a broader location.</p>
        )}
        {opps?.map((o, i) => (
          <div key={i} className="card" style={{ background: 'var(--bg-2, transparent)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <b>
                {o.title} · {o.company}
              </b>
              <span className="badge senior">{o.match_score}% match</span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>
              📍 {o.location} — {o.why}
            </p>
            <div className="row">
              <button disabled={targeting === o.company} onClick={() => target(o)}>
                {targeting === o.company ? 'Targeting…' : 'Target this →'}
              </button>
              {o.url && (
                <a href={o.url} target="_blank" rel="noreferrer">
                  <button className="secondary">View posting</button>
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
