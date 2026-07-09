import { useEffect, useRef, useState } from 'react'
import { api, type InterviewDomain, type InterviewReport, type Profile } from '../api'
import { Listener, Recorder, Speaker, recordingSupported, stopSpeaking } from '../voice'
import { ReportCard } from './Report'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const stripToken = (text: string) => text.replace('[INTERVIEW_COMPLETE]', '')

/**
 * One-tap steering chips (Phase 4). Each sends a short request the interviewer honors now, and a
 * `preference` label the server logs as an event so the user-model distiller learns recurring asks.
 */
const STEER_CHIPS: { label: string; phrase: string; pref: string }[] = [
  {
    label: '🔥 Harder',
    phrase: 'That felt easy — please push me with a harder question.',
    pref: 'wants harder questions',
  },
  {
    label: '🐢 Ease up',
    phrase: 'Could we slow the pace a little and take it one step at a time?',
    pref: 'wants an easier pace',
  },
  {
    label: '🏗 More system design',
    phrase: "I'd like to practice more system design — can we go there?",
    pref: 'wants more system design',
  },
  {
    label: '🤝 More behavioral',
    phrase: 'Can we do more behavioral questions?',
    pref: 'wants more behavioral',
  },
  {
    label: '🎓 Teach me this',
    phrase:
      "I don't know this well — please teach me: give me a quick intuition and a guiding question, then re-ask so I can try again.",
    pref: 'asked to be taught (teaching mode)',
  },
]

export function Interview({
  profile,
  mode,
  kind,
  domain,
  weaknessId,
  resumeId,
  onExit,
}: {
  profile: Profile
  mode: 'voice' | 'text'
  kind: 'full' | 'coaching'
  domain: InterviewDomain
  weaknessId?: number
  /** When set, reload this in-progress interview from the server instead of starting fresh (D14). */
  resumeId?: number
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
  const [transcribing, setTranscribing] = useState(false)
  // R30: server-side transcription (GPT-4o-Transcribe et al.) upgrades the mic from live browser
  // dictation to record-then-upload when an admin has assigned a voice.transcribe model; null
  // while we haven't checked yet, so the mic stays on the safe browser-STT path meanwhile.
  const [serverStt, setServerStt] = useState<boolean | null>(null)
  const listener = useRef(new Listener())
  const recorder = useRef(new Recorder())
  const speaker = useRef(new Speaker())
  const bottom = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (mode !== 'voice') return
    api
      .voiceAvailable()
      .then((r) => setServerStt(r.available && recordingSupported()))
      .catch(() => setServerStt(false))
  }, [mode])

  const onDelta = (t: string) => {
    setThinking(false)
    setPartial((p) => stripToken((p ?? '') + t))
    if (mode === 'voice') speaker.current.push(t)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Resume: the server transcript is the source of truth — reload it, don't
    // re-open the conversation (and never auto-speak the back-history in voice mode).
    if (resumeId !== undefined) {
      api
        .getInterview(resumeId)
        .then((iv) => {
          setInterviewId(iv.id)
          setMessages(iv.transcript)
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          setPartial(null)
          setThinking(false)
        })
      return
    }
    api
      .startInterview(profile.id, mode, kind, weaknessId, onDelta, domain)
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
  }, [profile.id, mode, kind, domain, weaknessId, resumeId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking, interim, partial])

  useEffect(() => () => stopSpeaking(), [])

  const send = async (text: string, preference?: string) => {
    if (!text.trim() || interviewId === null || thinking || partial !== null) return
    speaker.current.cancel()
    setMessages((m) => [...m, { role: 'user', content: text.trim() }])
    setDraft('')
    setInterim('')
    setThinking(true)
    try {
      const r = await api.sendMessage(interviewId, text.trim(), onDelta, preference)
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

  /** D15: never auto-send raw speech-to-text — land it in the editable box so the user can fix
   * accent/transcription errors and confirm before it reaches the model. */
  const appendDraft = (text: string) => {
    if (text.trim()) setDraft((d) => (d.trim() ? `${d.trim()} ${text.trim()}` : text.trim()))
  }

  const toggleMic = async () => {
    if (serverStt) {
      if (listening) {
        setListening(false)
        setInterim('⏳ transcribing…')
        setTranscribing(true)
        try {
          const blob = await recorder.current.stop()
          if (blob) appendDraft(await api.transcribeAudio(blob))
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setTranscribing(false)
          setInterim('')
        }
      } else {
        speaker.current.cancel() // barge-in: talking interrupts the interviewer
        setError('')
        try {
          await recorder.current.start()
          setListening(true)
          setInterim('🎙️ recording…')
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
      return
    }
    // Fallback: live browser dictation (unchanged).
    if (listening) {
      const text = listener.current.stop()
      setListening(false)
      setInterim('')
      appendDraft(text)
    } else {
      speaker.current.cancel()
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
      if (serverStt) void recorder.current.stop()
      else listener.current.stop()
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

  const busy = thinking || partial !== null || transcribing

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: '12px 0' }}>
          {kind === 'coaching'
            ? '🎯 Coaching drill'
            : domain === 'hr'
              ? mode === 'voice'
                ? '🤝 HR interview (voice)'
                : '🤝 HR interview'
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
        <div className="hint" style={{ marginBottom: 4 }}>
          {transcribing
            ? 'Transcribing your answer…'
            : listening
              ? 'Listening — tap ■ to stop, then review and edit before sending'
              : 'Tap 🎤 to speak. Your words land in the box below — fix anything, then Send.'}
        </div>
      )}

      {!done && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {STEER_CHIPS.map((chip) => (
            <button
              key={chip.pref}
              className="ghost"
              style={{ fontSize: 13, padding: '4px 10px' }}
              disabled={busy}
              title="Steer the interview — we'll remember this for next time"
              onClick={() => void send(chip.phrase, chip.pref)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {!done && (
        <div className="composer">
          {mode === 'voice' && (
            <button
              className={`mic ${listening ? 'live' : ''}`}
              disabled={busy}
              onClick={() => void toggleMic()}
              title="Dictate your answer"
            >
              {listening ? '■' : '🎤'}
            </button>
          )}
          <textarea
            value={draft}
            placeholder={
              mode === 'voice'
                ? 'Speak with the mic, or type here. Review, then Send (Enter to send).'
                : 'Type your answer… (Enter to send, Shift+Enter for newline)'
            }
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
