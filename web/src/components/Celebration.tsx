// Celebration moments (RF-8). Intensity is ADAPTIVE BY LEVEL (owner decision):
// juniors/career-switchers get full confetti fireworks; senior/staff get a
// restrained "premium" glow. One component, one intensity prop.
// Respects prefers-reduced-motion (static banner, no particles).
import { useEffect, useRef, useState } from 'react'

export type CelebrationIntensity = 'loud' | 'subtle'

/** Map a calibrated level to a celebration intensity (junior/mid → loud; senior/staff → subtle). */
export function intensityForLevel(level: string | null | undefined): CelebrationIntensity {
  return level === 'senior' || level === 'staff' ? 'subtle' : 'loud'
}

const COLORS = ['#5b8cff', '#8a5bff', '#3ecf8e', '#f5b94f', '#ff8ad4']

function runConfetti(canvas: HTMLCanvasElement, durationMs: number): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => undefined
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvas.offsetWidth * dpr
  canvas.height = canvas.offsetHeight * dpr
  ctx.scale(dpr, dpr)
  const W = canvas.offsetWidth
  const H = canvas.offsetHeight
  const parts = Array.from({ length: 160 }, () => ({
    x: Math.random() * W,
    y: -20 - Math.random() * H * 0.5,
    vx: (Math.random() - 0.5) * 2.2,
    vy: 2 + Math.random() * 3.5,
    size: 5 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.25,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  }))
  const start = performance.now()
  let raf = 0
  const tick = (now: number) => {
    const t = now - start
    ctx.clearRect(0, 0, W, H)
    for (const p of parts) {
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.globalAlpha = Math.max(0, 1 - t / durationMs)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      ctx.restore()
    }
    if (t < durationMs) raf = requestAnimationFrame(tick)
    else ctx.clearRect(0, 0, W, H)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

/**
 * Full-screen celebration overlay: emoji + title + subtitle, confetti when loud.
 * Auto-dismisses (or click-through). Renders nothing after dismissal.
 */
export function Celebration({
  icon,
  title,
  subtitle,
  intensity,
  onDone,
}: {
  icon: string
  title: string
  subtitle?: string
  intensity: CelebrationIntensity
  onDone?: () => void
}) {
  const [open, setOpen] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!open) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const stopConfetti =
      intensity === 'loud' && !reduced && canvasRef.current
        ? runConfetti(canvasRef.current, 3200)
        : () => undefined
    const timer = setTimeout(
      () => {
        setOpen(false)
        onDone?.()
      },
      intensity === 'loud' ? 3800 : 2600,
    )
    return () => {
      clearTimeout(timer)
      stopConfetti()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null
  return (
    <div
      className={`celebration-overlay ${intensity}`}
      role="status"
      onClick={() => {
        setOpen(false)
        onDone?.()
      }}
    >
      {intensity === 'loud' && <canvas ref={canvasRef} className="celebration-canvas" />}
      <div className="celebration-body">
        <div className="celebration-icon">{icon}</div>
        <div className="celebration-title">{title}</div>
        {subtitle && <div className="celebration-sub">{subtitle}</div>}
      </div>
    </div>
  )
}

/** Animated number reveal (the score "counts up"). Reduced-motion → instant. */
export function CountUp({ to, duration = 1200 }: { to: number; duration?: number }) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to)
      return
    }
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(to * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, duration])
  return <>{value}</>
}
