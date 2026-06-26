import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SkillPack {
  id: string
  company: string
  roles: string[]
  summary: string
  body: string
}

/**
 * Tiered targets (R22 / Phase 17). When the candidate doesn't have a specific company, they pick
 * a **tier** instead of naming one — the interview then calibrates to that tier's hiring bar. Tiers
 * are seeded into `company_packs` as `source: 'tier'` with stable slugs, so they ride the same
 * pack pipeline (attached to a profile, injected into the interview prompt) as real companies.
 */
export interface TierSeed {
  slug: string
  company: string
  roles: string[]
  summary: string
  body: string
}

const ANY_ROLES = ['Software Engineer', 'Backend Engineer', 'Frontend Engineer', 'Data Engineer']

export const TIER_SEED_PACKS: TierSeed[] = [
  {
    slug: 'tier-1',
    company: 'Tier 1 — Big Tech (FAANG-bar)',
    roles: ANY_ROLES,
    summary: 'The highest bar — deep algorithms, rigorous system design, structured behavioral.',
    body: `## Tier 1 — Big Tech (FAANG-bar) interview playbook

This is the bar set by the largest, most selective tech companies (think Google/Meta/Amazon-class). Calibrate every question to a hire/no-hire decision at a top company.

**Process (typical):** recruiter screen → 1–2 technical phone screens → a 4–6 round virtual onsite (2 coding, 1 system design, 1–2 behavioral, sometimes a domain deep-dive).

**Signals screened hard:**
- Algorithmic depth: optimal solutions, tight complexity analysis, clean code under time pressure.
- System design at scale: capacity estimation, data modeling, bottlenecks, failure modes, trade-offs.
- Structured communication: hypothesis-driven, clarifies ambiguity, states assumptions.
- Behavioral rigor: concrete STAR stories with measurable impact, ownership, scope.

**Question styles & examples:**
- Coding: "Find the median of a stream of numbers." Expect follow-ups that tighten constraints.
- System design: "Design a globally distributed rate limiter." Push on consistency, sharding, hot keys.
- Behavioral: "Tell me about the most technically ambitious thing you've shipped — what was your specific contribution?"

**Calibration:** demand optimal (not just working) solutions; probe one notch above the candidate's assessed level; do not let hand-wavy scale answers pass — ask for numbers.`,
  },
  {
    slug: 'tier-2',
    company: 'Tier 2 — High-growth scale-up',
    roles: ANY_ROLES,
    summary: 'High bar but pragmatic — real-world problem solving, shipping under constraints, ownership.',
    body: `## Tier 2 — High-growth scale-up interview playbook

The bar set by well-funded, fast-growing companies (Series B–D / recent unicorns). High quality, but weighted toward pragmatism and impact over pure algorithmic theater.

**Process (typical):** recruiter screen → technical screen (practical coding or take-home) → onsite (1 coding, 1 practical system/architecture, 1–2 behavioral, often a values/culture round).

**Signals screened:**
- Practical problem solving: gets to a working, reasonable solution fast; iterates.
- Architecture sense: designs for the current scale with a credible path to grow; cost-aware.
- Ownership & velocity: has shipped end-to-end; comfortable with ambiguity and gaps.
- Collaboration: works across functions, communicates trade-offs to non-experts.

**Question styles & examples:**
- Coding: "Parse and aggregate this log format." Realistic, less trick-puzzle.
- System/architecture: "Design the notifications service for our app." Push on pragmatic trade-offs, not max scale.
- Behavioral: "Tell me about a time you shipped something with an unclear spec."

**Calibration:** reward pragmatic, shipped outcomes; probe how they'd evolve a design as the company grows; value judgment and prioritization as much as raw depth.`,
  },
  {
    slug: 'tier-3',
    company: 'Tier 3 — Established / general',
    roles: ANY_ROLES,
    summary: 'A solid professional bar — fundamentals, breadth, clear communication, reliability.',
    body: `## Tier 3 — Established / general interview playbook

The bar at established mid-market companies and the general industry standard. Focus on solid fundamentals, breadth, and the ability to be a reliable, productive teammate.

**Process (typical):** recruiter screen → technical screen → onsite (1 coding/fundamentals, 1 design or domain discussion, 1–2 behavioral).

**Signals screened:**
- Fundamentals: data structures, basic complexity, language/runtime knowledge, debugging.
- Breadth & reliability: writes correct, maintainable code; tests and edge cases; good habits.
- Communication: explains thinking clearly; asks reasonable questions.
- Teamwork & growth: dependable, coachable, collaborates well.

**Question styles & examples:**
- Coding: "Deduplicate and sort these records." Correctness and clarity over cleverness.
- Design: "How would you structure a small REST service for X?" Reasonable, not web-scale.
- Behavioral: "Tell me about a bug you were proud of fixing."

**Calibration:** keep questions fair and grounded; reward correctness, clarity, and good engineering habits; coach lightly when the candidate stalls — the goal is a confident, well-rounded hire.`,
  },
]

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** skills/ lives at the repo root, next to server/ — resolve from dist or src. */
function skillsDir(): string {
  for (const candidate of [path.resolve(__dirname, '../../skills'), path.resolve(process.cwd(), 'skills')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return path.resolve(__dirname, '../../skills')
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  if (!match) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { meta, body: match[2]!.trim() }
}

/**
 * Load the static `skills/*.md` packs from disk. Since Phase 15 (D10) these are only the
 * **seed** data — `db.seedPacks()` imports them into `company_packs` on first boot, and the
 * app reads packs from the DB at runtime. Kept file-based so the seeds stay reviewable in git.
 */
export function loadSeedPacks(): SkillPack[] {
  const dir = skillsDir()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8')
      const { meta, body } = parseFrontmatter(raw)
      return {
        id: f.replace(/\.md$/, ''),
        company: meta.company ?? f.replace(/\.md$/, ''),
        roles: (meta.roles ?? '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
        summary: meta.summary ?? '',
        body,
      }
    })
}
