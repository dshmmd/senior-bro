import { useEffect, useRef, useState } from 'react'
import { api, type InterviewReport, type Profile } from '../api'
import { Listener, Speaker, stopSpeaking } from '../voice'
import { ReportCard } from './Report'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const stripToken = (text: string) => text.replace('[INTERVIEW_COMPLETE]', '')

export function Interview({
  profile,
  mode,
  kind,
  weaknessId,
  onExit,
}: {
  profile: Profile
  mode: 'voice' | 'text'
  kind: 'full' | 'coaching'
  weaknessId?: number
  onExit: () => void
}) {
  const [interviewId, setInterviewId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [partial, setPartial] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(true)
  const [done, setDone] = useState(false)
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const listener = useRef(new Listener())
  const speaker = useRef(new Speaker())
  const bottom = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  const onDelta = (t: string) => {
    setThinking(false)
    setPartial((p) => stripToken((p ?? '') + t))
    if (mode === 'voice') speaker.current.push(t)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    api
      .startInterview(profile.id, mode, kind, weaknessId, onDelta)
      .then((r) => {
        setInterviewId(r.interview_id)
        setMessages([{ role: 'assistant', content: r.message }])
        if (mode === 'voice') speaker.current.flush()
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setPartial(null)
        setThinking(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, mode, kind, weaknessId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking, interim, partial])

  useEffect(() => () => stopSpeaking(), [])

  const send = async (text: string) => {
    if (!text.trim() || interviewId === null || thinking || partial !== null) return
    speaker.current.cancel()
    setMessages((m) => [...m, { role: 'user', content: text.trim() }])
    setDraft('')
    setInterim('')
    setThinking(true)
    try {
      const r = await api.sendMessage(interviewId, text.trim(), onDelta)
      setMessages((m) => [...m, { role: 'assistant', content: r.message }])
      if (mode === 'voice') speaker.current.flush()
      if (r.done) setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPartial(null)
      setThinking(false)
    }
  }

  const toggleMic = () => {
    if (listening) {
      const text = listener.current.stop()
      setListening(false)
      void send(text)
    } else {
      speaker.current.cancel() // barge-in: talking interrupts the interviewer
      setError('')
      try {
        listener.current.start(setInterim)
        setListening(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const finish = async () => {
    if (interviewId === null) return
    speaker.current.cancel()
    if (listening) {
      listener.current.stop()
      setListening(false)
    }
    setEvaluating(true)
    try {
      setReport(await api.finishInterview(interviewId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEvaluating(false)
    }
  }

  if (report)
    return (
      <>
        <h1>Your interview report</h1>
        <ReportCard report={report} />
        <div className="mt">
          <button onClick={onExit}>Back to dashboard →</button>
        </div>
      </>
    )

  const busy = thinking || partial !== null

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: '12px 0' }}>
          {kind === 'coaching'
            ? '🎯 Coaching drill'
            : mode === 'voice'
              ? '🎙️ Voice interview'
              : '⌨️ Interview'}
        </h1>
        <div className="row">
          <button
            className="danger"
            disabled={evaluating || messages.length < 2}
            onClick={() => void finish()}
          >
            {evaluating ? 'Evaluating…' : done ? 'Get my report' : 'End & evaluate'}
          </button>
          <button className="secondary" onClick={onExit}>
            Quit
          </button>
        </div>
      </div>

      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {interim && (
          <div className="msg user" style={{ opacity: 0.6 }}>
            {interim}
          </div>
        )}
        {partial !== null && (
          <div className="msg assistant">
            {partial}
            <span className="caret">▍</span>
          </div>
        )}
        {thinking && partial === null && (
          <div className="msg assistant thinking">interviewer is thinking…</div>
        )}
        {evaluating && <div className="msg assistant thinking">compiling your evaluation report…</div>}
        <div ref={bottom} />
      </div>

      {error && <div className="error">{error}</div>}

      {!done && mode === 'voice' && (
        <div className="voicebar">
          <button className={`mic ${listening ? 'live' : ''}`} disabled={busy} onClick={toggleMic}>
            {listening ? '■' : '🎤'}
          </button>
          <div className="hint">
            {listening
              ? 'Listening — tap to send your answer'
              : busy
                ? ''
                : 'Tap the mic and speak your answer'}
          </div>
        </div>
      )}

      {!done && mode === 'text' && (
        <div className="composer">
          <textarea
            value={draft}
            placeholder="Type your answer… (Enter to send, Shift+Enter for newline)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(draft)
              }
            }}
          />
          <button disabled={busy || !draft.trim()} onClick={() => void send(draft)}>
            Send
          </button>
        </div>
      )}

      {done && (
        <div className="card">
          🏁 The interviewer has wrapped up. Hit <b>Get my report</b> for your full evaluation.
        </div>
      )}
    </>
  )
}
