import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createScene, type Scene } from '../landing/engine'
import '../landing.css'

/** 3D tilt that follows the cursor across the card. */
function TiltCard({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `perspective(700px) rotateX(${(-y * 9).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateY(-3px)`
    el.style.setProperty('--gx', `${(x + 0.5) * 100}%`)
    el.style.setProperty('--gy', `${(y + 0.5) * 100}%`)
  }
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = ''
  }

  return (
    <div ref={ref} className="tilt" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div className="tilt-icon">{icon}</div>
      <b>{title}</b>
      <p>{children}</p>
    </div>
  )
}

/** CTA that leans toward the cursor. */
function MagneticButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null)
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - (r.left + r.width / 2)
    const y = e.clientY - (r.top + r.height / 2)
    el.style.transform = `translate(${x * 0.18}px, ${y * 0.28}px)`
  }
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = ''
  }
  return (
    <button ref={ref} className="cta" onClick={onClick} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </button>
  )
}

const DEMO: { who: 'ai' | 'you'; text: string }[] = [
  { who: 'ai', text: 'Your service p99 latency doubled overnight. Walk me through your first 10 minutes.' },
  {
    who: 'you',
    text: 'First I check what shipped — deploys, config, traffic mix. Then dashboards: is it one endpoint or everything?',
  },
  { who: 'ai', text: 'Dashboards show one endpoint. DB CPU is flat. What now?' },
  {
    who: 'you',
    text: 'Flat DB but slow endpoint smells like lock contention or an N+1 introduced by the last deploy. I would diff the release…',
  },
  { who: 'ai', text: 'Good instinct. Now convince me you can say that in front of a hiring panel. 😏' },
]

function LiveDemo() {
  const [line, setLine] = useState(0)
  const [chars, setChars] = useState(0)

  useEffect(() => {
    const current = DEMO[line]!
    if (chars < current.text.length) {
      const t = setTimeout(() => setChars((c) => c + 2), 18)
      return () => clearTimeout(t)
    }
    const t = setTimeout(
      () => {
        setLine((l) => (l + 1) % DEMO.length)
        setChars(0)
      },
      line === DEMO.length - 1 ? 4200 : 1100,
    )
    return () => clearTimeout(t)
  }, [line, chars])

  return (
    <div className="demo-card">
      <div className="demo-head">
        <i />
        <i />
        <i />
        <span>live mock interview</span>
      </div>
      {DEMO.slice(0, line + 1).map((m, i) => (
        <div key={i} className={`demo-msg ${m.who}`}>
          {i === line ? m.text.slice(0, chars) : m.text}
          {i === line && <span className="caret">▍</span>}
        </div>
      ))}
    </div>
  )
}

export function Landing({ onEnter }: { onEnter: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const spotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (canvasRef.current) sceneRef.current = createScene(canvasRef.current, reduced)
    const onMove = (e: PointerEvent) => {
      spotRef.current?.style.setProperty('--mx', `${e.clientX}px`)
      spotRef.current?.style.setProperty('--my', `${e.clientY}px`)
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      sceneRef.current?.destroy()
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  return (
    <div className="landing" ref={spotRef}>
      <div className="spotlight" />

      <section className="hero" onClick={() => sceneRef.current?.morph()}>
        <canvas ref={canvasRef} className="hero-canvas" />
        <div className="hero-inner">
          <div className="hero-badge">🔒 local-first · your key · your data</div>
          <h1 className="hero-title">
            Interview like it's <span>game day.</span>
          </h1>
          <p className="hero-sub">
            A voice-enabled AI interviewer that learns your weaknesses, drills them out of you, and adopts the
            real playbooks of Google, Amazon, Meta — or your dream startup.
          </p>
          <div className="hero-actions">
            <MagneticButton onClick={onEnter}>Launch Senior Bro →</MagneticButton>
            <a className="ghost" href="#features" onClick={(e) => e.stopPropagation()}>
              See what it does
            </a>
          </div>
          <div className="hero-hint">move your cursor to bend it · click to morph</div>
        </div>
      </section>

      <section id="features" className="features">
        <h2>
          Built to make you <span>unrejectable</span>
        </h2>
        <div className="feature-grid">
          <TiltCard icon="🎙️" title="Real voice interviews">
            Speak out loud. The interviewer talks back, interrupts politely, and never lets a vague answer
            slide — just like the real thing.
          </TiltCard>
          <TiltCard icon="🏢" title="Company playbooks">
            Amazon Leadership Principles, Google GCA, Meta speed rounds. Pick a company and face its actual
            interview culture.
          </TiltCard>
          <TiltCard icon="📐" title="Level calibration">
            A 5-question check grades you junior → staff first, so every question lands at your edge — never
            boring, never crushing.
          </TiltCard>
          <TiltCard icon="🎯" title="Weakness flywheel">
            Every interview extracts your specific weaknesses. Future sessions probe them. Drills fix them.
            Watch them disappear.
          </TiltCard>
          <TiltCard icon="🧾" title="Hiring-committee reports">
            Scored across five dimensions with transcript-cited feedback — the report a real committee writes,
            but for your eyes.
          </TiltCard>
          <TiltCard icon="🔑" title="Your key, your rules">
            Bring your own Claude or OpenAI key. Everything stays on your machine. Voice runs in the browser —
            zero extra cost.
          </TiltCard>
        </div>
      </section>

      <section className="demo">
        <div className="demo-copy">
          <h2>
            It pushes back.
            <br />
            <span>That's the point.</span>
          </h2>
          <p>
            Soft questions don't prepare you for hard rooms. Senior Bro follows up, asks for numbers, and
            coaches you mid-interview when you stall.
          </p>
          <MagneticButton onClick={onEnter}>Start a mock interview</MagneticButton>
        </div>
        <LiveDemo />
      </section>

      <section className="steps">
        <h2>Three minutes to your first interview</h2>
        <div className="step-row">
          <div className="step">
            <span>1</span>
            <b>Paste your AI key</b>
            <p>Claude or OpenAI. Validated instantly, stored only on your machine.</p>
          </div>
          <div className="step">
            <span>2</span>
            <b>Tell it your target</b>
            <p>Role, company, tech stack. Take the 5-question level check.</p>
          </div>
          <div className="step">
            <span>3</span>
            <b>Talk.</b>
            <p>Voice or text. Finish, get your report, drill your weaknesses.</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div>
          <b>Senior Bro</b> — practice until the real one feels easy.
        </div>
        <MagneticButton onClick={onEnter}>Launch →</MagneticButton>
      </footer>
    </div>
  )
}
