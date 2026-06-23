import type { InterviewRow, Profile, Weakness } from './db.js'

/** The five evaluation dimensions become the five star clusters. */
export const DIMENSIONS = [
  'Communication',
  'Technical depth',
  'Problem solving',
  'Behavioral / STAR',
  'System design',
] as const

const LEVELS = ['junior', 'mid', 'senior', 'staff'] as const

export interface DimensionProgress {
  name: string
  best: number // 0-10
  avg: number // 0-10
  count: number // finished interviews scoring this dimension
  lit: number // 0-1 fill (blends avg quality and how many interviews)
  crystallized: boolean
}

export interface Medal {
  id: string
  title: string
  icon: string
  detail: string
  earned: boolean
}

export interface Progress {
  interviews_total: number
  dimensions: DimensionProgress[]
  weaknesses: { open: number; improving: number; resolved: number; total: number; items: Weakness[] }
  streak: { current: number; longest: number; days: { date: string; count: number }[] }
  level_trail: { label: string; reached: boolean; current: boolean }[]
  medals: Medal[]
  overall_completion: number // 0-1 across all clusters — drives the "fully lit" finale
}

const dayKey = (iso: string): string => iso.slice(0, 10)

function computeStreak(dates: string[]): {
  current: number
  longest: number
  days: { date: string; count: number }[]
} {
  const counts = new Map<string, number>()
  for (const iso of dates) {
    const k = dayKey(iso)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  // last 84 days (12 weeks) heat strip
  const days: { date: string; count: number }[] = []
  const today = new Date()
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const k = d.toISOString().slice(0, 10)
    days.push({ date: k, count: counts.get(k) ?? 0 })
  }

  // current streak counts back from today (or yesterday) over active days
  let current = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]!.count > 0) current++
    else if (i !== days.length - 1)
      break // allow "haven't practiced today yet"
    else continue
  }
  let longest = 0
  let run = 0
  for (const d of days) {
    if (d.count > 0) {
      run++
      longest = Math.max(longest, run)
    } else run = 0
  }
  return { current, longest, days }
}

export function computeProgress(
  profile: Profile,
  interviews: InterviewRow[],
  weaknesses: Weakness[],
): Progress {
  const finished = interviews.filter((i) => i.report !== null)

  const dimensions: DimensionProgress[] = DIMENSIONS.map((name) => {
    const scores = finished
      .map((i) => i.report?.dimensions.find((d) => d.name === name)?.score)
      .filter((s): s is number => typeof s === 'number')
    const count = scores.length
    const best = count ? Math.max(...scores) : 0
    const avg = count ? scores.reduce((a, b) => a + b, 0) / count : 0
    // lit-ness blends quality (avg/10) with experience (interviews toward a cap of 4)
    const experience = Math.min(count / 4, 1)
    const lit = count ? Math.min((avg / 10) * 0.7 + experience * 0.3, 1) : 0
    return { name, best, avg, count, lit, crystallized: count >= 2 && avg >= 8 }
  })

  const open = weaknesses.filter((w) => w.status === 'open').length
  const improving = weaknesses.filter((w) => w.status === 'improving').length
  const resolved = weaknesses.filter((w) => w.status === 'resolved').length

  const streak = computeStreak(finished.map((i) => i.created_at))

  const currentLevelIdx = profile.level ? LEVELS.indexOf(profile.level as (typeof LEVELS)[number]) : -1
  const level_trail = LEVELS.map((label, idx) => ({
    label,
    reached: currentLevelIdx >= idx,
    current: currentLevelIdx === idx,
  }))

  const allWeaknessesResolved = weaknesses.length > 0 && open === 0 && improving === 0

  const medals: Medal[] = [
    ...dimensions.map((d) => ({
      id: `master-${d.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      title: `${d.name} Master`,
      icon: '⭐',
      detail: `Average ≥ 8.0 across 2+ interviews (you: ${d.avg.toFixed(1)})`,
      earned: d.crystallized,
    })),
    {
      id: 'clean-slate',
      title: 'Clean Slate',
      icon: '🏅',
      detail: 'Every detected weakness resolved',
      earned: allWeaknessesResolved,
    },
    {
      id: 'marathoner',
      title: 'Marathoner',
      icon: '🔥',
      detail: '7-day practice streak',
      earned: streak.longest >= 7,
    },
    {
      id: 'seasoned',
      title: 'Seasoned',
      icon: '🎖️',
      detail: '10 interviews completed',
      earned: finished.length >= 10,
    },
  ]

  const overall_completion = dimensions.reduce((a, d) => a + d.lit, 0) / dimensions.length

  return {
    interviews_total: finished.length,
    dimensions,
    weaknesses: { open, improving, resolved, total: weaknesses.length, items: weaknesses },
    streak,
    level_trail,
    medals,
    overall_completion,
  }
}
