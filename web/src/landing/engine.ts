/**
 * Cursor-aware 3D particle engine — pure Canvas 2D, zero dependencies.
 * Particles morph between 3D shapes (sphere → torus → helix → wave),
 * the cursor bends the rotation and repels nearby particles,
 * click/tap morphs to the next shape.
 */

interface Particle {
  x: number
  y: number
  z: number
  tx: number
  ty: number
  tz: number
  ox: number // screen-space push from the cursor (smoothed)
  oy: number
}

const COUNT = 380
const LINK = 46 // px at 1080p scale — link line max distance
const MORPH_EVERY = 7000

type ShapeFn = (i: number, n: number) => [number, number, number]

const shapes: ShapeFn[] = [
  // fibonacci sphere
  (i, n) => {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / n)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i
    return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]
  },
  // torus
  (i, n) => {
    const u = (i / n) * Math.PI * 2 * 13
    const v = (i / n) * Math.PI * 2
    const R = 0.72
    const r = 0.34
    return [
      (R + r * Math.cos(u)) * Math.cos(v),
      r * Math.sin(u),
      (R + r * Math.cos(u)) * Math.sin(v),
    ]
  },
  // double helix with rungs
  (i, n) => {
    const t = (i / n) * Math.PI * 6
    const y = (i / n) * 2.2 - 1.1
    if (i % 9 === 0) {
      // rung between the strands
      const f = ((i / 9) % 3) / 3 + 0.17
      const a = [Math.cos(t) * 0.55, y, Math.sin(t) * 0.55]
      const b = [Math.cos(t + Math.PI) * 0.55, y, Math.sin(t + Math.PI) * 0.55]
      return [a[0]! + (b[0]! - a[0]!) * f, y, a[2]! + (b[2]! - a[2]!) * f]
    }
    const strand = i % 2 === 0 ? 0 : Math.PI
    return [Math.cos(t + strand) * 0.55, y, Math.sin(t + strand) * 0.55]
  },
  // standing wave grid
  (i, n) => {
    const side = Math.ceil(Math.sqrt(n))
    const gx = (i % side) / (side - 1) - 0.5
    const gz = Math.floor(i / side) / (side - 1) - 0.5
    const y = Math.sin(gx * Math.PI * 3) * Math.cos(gz * Math.PI * 3) * 0.28
    return [gx * 2.1, y, gz * 2.1]
  },
]

export interface Scene {
  destroy(): void
  morph(): void
}

export function createScene(canvas: HTMLCanvasElement, reducedMotion: boolean): Scene {
  const ctx = canvas.getContext('2d')!
  const particles: Particle[] = []
  let shapeIdx = 0
  let rotY = 0.4
  let rotX = 0.18
  let targetRotY = 0.4
  let targetRotX = 0.18
  let pointerX = -9999
  let pointerY = -9999
  let pointerOn = false
  let raf = 0
  let lastMorph = performance.now()
  let w = 0
  let h = 0
  let dpr = 1

  const setTargets = () => {
    const fn = shapes[shapeIdx % shapes.length]!
    particles.forEach((p, i) => {
      const [tx, ty, tz] = fn(i, COUNT)
      p.tx = tx
      p.ty = ty
      p.tz = tz
    })
  }

  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: (Math.random() - 0.5) * 3,
      y: (Math.random() - 0.5) * 3,
      z: (Math.random() - 0.5) * 3,
      tx: 0,
      ty: 0,
      tz: 0,
      ox: 0,
      oy: 0,
    })
  }
  setTargets()

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = canvas.getBoundingClientRect()
    w = rect.width
    h = rect.height
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  const onPointer = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    pointerX = e.clientX - rect.left
    pointerY = e.clientY - rect.top
    pointerOn = true
    // cursor bends the rotation target
    targetRotY = 0.4 + ((pointerX / w) - 0.5) * 1.6
    targetRotX = 0.18 + ((pointerY / h) - 0.5) * 1.0
  }
  const onLeave = () => {
    pointerOn = false
    targetRotY = 0.4
    targetRotX = 0.18
  }
  window.addEventListener('pointermove', onPointer)
  window.addEventListener('pointerleave', onLeave)

  const sx = new Float32Array(COUNT)
  const sy = new Float32Array(COUNT)
  const sd = new Float32Array(COUNT) // depth 0..1 (1 = closest)

  const frame = (now: number) => {
    if (!reducedMotion && now - lastMorph > MORPH_EVERY) {
      lastMorph = now
      shapeIdx++
      setTargets()
    }

    rotY += (targetRotY - rotY) * 0.04 + (reducedMotion ? 0.0004 : 0.0016)
    rotX += (targetRotX - rotX) * 0.04
    targetRotY += 0.0016 // idle drift so it never freezes

    const cy = Math.cos(rotY)
    const syn = Math.sin(rotY)
    const cx = Math.cos(rotX)
    const sxn = Math.sin(rotX)
    const radius = Math.min(w, h) * 0.36
    const centerX = w / 2
    const centerY = h * 0.5
    const linkPx = LINK * (Math.min(w, h) / 700)
    const link2 = linkPx * linkPx

    ctx.clearRect(0, 0, w, h)

    for (let i = 0; i < COUNT; i++) {
      const p = particles[i]!
      p.x += (p.tx - p.x) * 0.045
      p.y += (p.ty - p.y) * 0.045
      p.z += (p.tz - p.z) * 0.045

      // rotate Y then X
      const x1 = p.x * cy - p.z * syn
      const z1 = p.x * syn + p.z * cy
      const y1 = p.y * cx - z1 * sxn
      const z2 = p.y * sxn + z1 * cx

      const k = 2.6 / (2.6 + z2)
      let px = centerX + x1 * k * radius
      let py = centerY + y1 * k * radius

      // cursor repulsion (screen space, smoothed)
      let pushX = 0
      let pushY = 0
      if (pointerOn) {
        const dx = px - pointerX
        const dy = py - pointerY
        const d2 = dx * dx + dy * dy
        const range = 120
        if (d2 < range * range && d2 > 0.01) {
          const d = Math.sqrt(d2)
          const f = ((range - d) / range) * 30
          pushX = (dx / d) * f
          pushY = (dy / d) * f
        }
      }
      p.ox += (pushX - p.ox) * 0.12
      p.oy += (pushY - p.oy) * 0.12
      px += p.ox
      py += p.oy

      sx[i] = px
      sy[i] = py
      sd[i] = Math.max(0, Math.min(1, (1.3 - z2) / 2.6))
    }

    // connective lines
    ctx.lineWidth = 1
    for (let i = 0; i < COUNT; i++) {
      const xi = sx[i]!
      const yi = sy[i]!
      for (let j = i + 1; j < COUNT; j++) {
        const dx = sx[j]! - xi
        if (dx > linkPx || dx < -linkPx) continue
        const dy = sy[j]! - yi
        const d2 = dx * dx + dy * dy
        if (d2 > link2) continue
        const a = (1 - d2 / link2) * 0.33 * Math.min(sd[i]!, sd[j]!)
        ctx.strokeStyle = `rgba(124, 146, 255, ${a.toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(xi, yi)
        ctx.lineTo(sx[j]!, sy[j]!)
        ctx.stroke()
      }
    }

    // particles
    for (let i = 0; i < COUNT; i++) {
      const depth = sd[i]!
      const r = 0.8 + depth * 2.1
      ctx.fillStyle = `hsla(${228 + depth * 46}, 92%, ${58 + depth * 16}%, ${0.35 + depth * 0.65})`
      ctx.beginPath()
      ctx.arc(sx[i]!, sy[i]!, r, 0, Math.PI * 2)
      ctx.fill()
    }

    if (!reducedMotion) raf = requestAnimationFrame(frame)
  }

  if (reducedMotion) {
    // settle into the first shape, render one calm frame
    for (let s = 0; s < 120; s++)
      particles.forEach((p) => {
        p.x += (p.tx - p.x) * 0.1
        p.y += (p.ty - p.y) * 0.1
        p.z += (p.tz - p.z) * 0.1
      })
    frame(performance.now())
  } else {
    raf = requestAnimationFrame(frame)
  }

  return {
    morph() {
      shapeIdx++
      lastMorph = performance.now()
      setTargets()
      if (reducedMotion) frame(performance.now())
    },
    destroy() {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerleave', onLeave)
    },
  }
}
