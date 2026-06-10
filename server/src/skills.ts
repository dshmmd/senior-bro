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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** skills/ lives at the repo root, next to server/ — resolve from dist or src. */
function skillsDir(): string {
  for (const candidate of [
    path.resolve(__dirname, '../../skills'),
    path.resolve(process.cwd(), 'skills'),
  ]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return path.resolve(__dirname, '../../skills')
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { meta, body: match[2]!.trim() }
}

export function loadSkillPacks(): SkillPack[] {
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
        roles: (meta.roles ?? '').split(',').map((r) => r.trim()).filter(Boolean),
        summary: meta.summary ?? '',
        body,
      }
    })
}

export function getSkillPack(id: string): SkillPack | null {
  return loadSkillPacks().find((p) => p.id === id) ?? null
}
