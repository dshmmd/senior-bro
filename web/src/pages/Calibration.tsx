import { useEffect, useRef, useState } from 'react'
import { api, type Profile } from '../api'

export function Calibration({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [calibrationId, setCalibrationId] = useState<number | null>(null)
  const [questions, setQuestions] = useState<string[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [current, setCurrent] = useState(0)
  const [draft, setDraft] = useState('')
  const [result, setResult] = useState<{ level: string; summary: string } | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    api
      .startCalibration(profile.id)
      .then((r) => {
        setCalibrationId(r.calibration_id)
        setQuestions(r.questions)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }, [profile.id])

  const next = async () => {
    const updated = [...answers, draft.trim() || '(skipped)']
    setAnswers(updated)
    setDraft('')
    if (updated.length < questions.length) {
      setCurrent(updated.length)
      return
    }
    setBusy(true)
    try {
      const r = await api.submitCalibration(calibrationId!, updated)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (error)
    return (
      <div className="card">
        <div className="error">{error}</div>
        <div className="mt">
          <button onClick={onDone}>Back</button>
        </div>
      </div>
    )

  if (result)
    return (
      <>
        <h1>Level check complete</h1>
        <div className="card">
          <span className={`badge ${result.level}`}>{result.level}</span>
          <p>{result.summary}</p>
          <button onClick={onDone}>Go to dashboard →</button>
        </div>
      </>
    )

  if (busy || questions.length === 0)
    return (
      <div className="card msg thinking">
        {questions.length ? 'Grading your answers…' : 'Generating your calibration questions…'}
      </div>
    )

  return (
    <>
      <h1>Quick level check</h1>
      <p className="sub">
        5 short questions so interviews match your real level. 2-4 sentences each is plenty.
      </p>
      <div className="step-dots">
        {questions.map((_, i) => (
          <i key={i} className={i <= current ? 'on' : ''} />
        ))}
      </div>
      <div className="card">
        <b>
          Question {current + 1} of {questions.length}
        </b>
        <p>{questions[current]}</p>
        <textarea
          value={draft}
          autoFocus
          placeholder="Your answer… (or leave blank to skip)"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="mt">
          <button onClick={() => void next()}>
            {current + 1 === questions.length ? 'Submit for grading' : 'Next question →'}
          </button>
        </div>
      </div>
    </>
  )
}
