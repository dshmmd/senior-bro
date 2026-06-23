import type { Progress } from '../api'

/**
 * Constellation skill map — pure Canvas 2D, zero deps.
 * Five clusters (the evaluation dimensions) ring the center. Each cluster's
 * stars light up with `lit`; a crystallized cluster gets a glowing ring.
 * As overall_completion → 1 the whole sky brightens and links knit together.
 */

interface Star {
  angle: number // around the cluster center
  radius: number
  size: number
  twinkle: number
}

interface Cluster {
  name: string
  cx: number
  cy: number
  lit: number
  crystallized: boolean
  stars: Star[]
  litCount: number
}

const STARS_PER_CLUSTER = 7

export interface Constellation {
  destroy(): void
}

export function createConstellation(
  canvas: HTMLCanvasElement,
  progress: Progress,
  reducedMotion: boolean,
): Constellation {
  const ctx = canvas.getContext('2d')!
  let raf = 0
  let w = 0
  let h = 0
  let t = 0

  const clusters: Cluster[] = progress.dimensions.map((d, i) => {
    const stars: Star[] = Array.from({ length: STARS_PER_CLUSTER }, (_, s) => ({
      angle: (s / STARS_PER_CLUSTER) * Math.PI * 2 + i,
      radius: 14 + ((s * 7) % 26),
      size: 1.2 + ((s * 3) % 3),
      twinkle: Math.random() * Math.PI * 2,
    }))
    return {
      name: d.name,
      cx: 0,
      cy: 0,
      lit: d.lit,
      crystallized: d.crystallized,
      stars,
      litCount: Math.round(d.lit * STARS_PER_CLUSTER),
    }
  })

  const layout = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = canvas.getBoundingClientRect()
    w = rect.width
    h = rect.height
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const ringR = Math.min(w, h) * 0.32
    const cx = w / 2
    const cy = h / 2
    clusters.forEach((cl, i) => {
      const a = (i / clusters.length) * Math.PI * 2 - Math.PI / 2
      cl.cx = cx + Math.cos(a) * ringR
      cl.cy = cy + Math.sin(a) * ringR
    })
  }
  layout()
  window.addEventListener('resize', layout)

  const draw = () => {
    t += 0.016
    const cx = w / 2
    const cy = h / 2
    ctx.clearRect(0, 0, w, h)

    // faint backdrop stars
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    for (let i = 0; i < 60; i++) {
      const x = (i * 137.5) % w
      const y = (i * 89.3) % h
      ctx.beginPath()
      ctx.arc(x, y, 0.6, 0, Math.PI * 2)
      ctx.fill()
    }

    // links between adjacent lit clusters — knit tighter as completion rises
    for (let i = 0; i < clusters.length; i++) {
      const a = clusters[i]!
      const b = clusters[(i + 1) % clusters.length]!
      const strength = Math.min(a.lit, b.lit)
      if (strength <= 0.05) continue
      ctx.strokeStyle = `rgba(124,146,255,${(strength * 0.35).toFixed(3)})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a.cx, a.cy)
      ctx.lineTo(b.cx, b.cy)
      ctx.stroke()
    }

    // center core glows with overall completion
    const core = progress.overall_completion
    const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90)
    const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(t * 1.5) * 0.2
    coreGlow.addColorStop(0, `rgba(138,91,255,${(core * 0.5 * pulse).toFixed(3)})`)
    coreGlow.addColorStop(1, 'rgba(138,91,255,0)')
    ctx.fillStyle = coreGlow
    ctx.fillRect(cx - 90, cy - 90, 180, 180)

    for (const cl of clusters) {
      // crystallized halo
      if (cl.crystallized) {
        const haloR = 44 + (reducedMotion ? 0 : Math.sin(t * 2 + cl.cx) * 3)
        const halo = ctx.createRadialGradient(cl.cx, cl.cy, 10, cl.cx, cl.cy, haloR)
        halo.addColorStop(0, 'rgba(245,185,79,0.25)')
        halo.addColorStop(1, 'rgba(245,185,79,0)')
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(cl.cx, cl.cy, haloR, 0, Math.PI * 2)
        ctx.fill()
      }

      // link lit stars within the cluster
      const lit = cl.stars.slice(0, cl.litCount)
      ctx.strokeStyle = cl.crystallized ? 'rgba(245,185,79,0.5)' : 'rgba(124,146,255,0.4)'
      ctx.lineWidth = 1
      ctx.beginPath()
      lit.forEach((s, idx) => {
        const x = cl.cx + Math.cos(s.angle) * s.radius
        const y = cl.cy + Math.sin(s.angle) * s.radius
        if (idx === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // stars
      cl.stars.forEach((s, idx) => {
        const isLit = idx < cl.litCount
        const x = cl.cx + Math.cos(s.angle) * s.radius
        const y = cl.cy + Math.sin(s.angle) * s.radius
        const tw = reducedMotion ? 1 : 0.7 + Math.sin(t * 2 + s.twinkle) * 0.3
        if (isLit) {
          ctx.fillStyle = cl.crystallized
            ? `rgba(245,185,79,${tw.toFixed(3)})`
            : `rgba(150,180,255,${tw.toFixed(3)})`
          ctx.shadowColor = cl.crystallized ? '#f5b94f' : '#5b8cff'
          ctx.shadowBlur = 8
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.12)'
          ctx.shadowBlur = 0
        }
        ctx.beginPath()
        ctx.arc(x, y, isLit ? s.size + 0.6 : s.size * 0.7, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      })

      // label
      ctx.fillStyle = cl.crystallized ? '#f5d08a' : 'rgba(230,233,240,0.75)'
      ctx.font = '600 12px -apple-system, system-ui, sans-serif'
      ctx.textAlign = 'center'
      const labelY = cl.cy > cy ? cl.cy + 52 : cl.cy - 46
      ctx.fillText(cl.name, cl.cx, labelY)
    }

    if (!reducedMotion) raf = requestAnimationFrame(draw)
  }

  if (reducedMotion) draw()
  else raf = requestAnimationFrame(draw)

  return {
    destroy() {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', layout)
    },
  }
}
