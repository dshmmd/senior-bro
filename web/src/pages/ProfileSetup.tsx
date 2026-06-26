import { useEffect, useState } from 'react'
import { api, type SkillPackSummary } from '../api'

export function ProfileSetup({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState('')
  const [company, setCompany] = useState('')
  const [skillPack, setSkillPack] = useState('')
  const [technologies, setTechnologies] = useState('')
  const [years, setYears] = useState(3)
  const [notes, setNotes] = useState('')
  const [packs, setPacks] = useState<SkillPackSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .skills()
      .then(setPacks)
      .catch(() => undefined)
  }, [])

  const [researching, setResearching] = useState(false)

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      // Generate-on-miss (R14): a typed company with no pack picked → research + cache a pack.
      let pack = skillPack
      if (!pack && company.trim()) {
        setResearching(true)
        try {
          const res = await api.ensurePack(company.trim(), role.trim() || 'Engineer')
          pack = String(res.pack_id)
        } catch {
          // Pack research is best-effort — fall through and create the profile without one.
        } finally {
          setResearching(false)
        }
      }
      await api.createProfile({
        role,
        company: company || undefined,
        skill_pack: pack || undefined,
        technologies: technologies
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        years_experience: years,
        notes: notes || undefined,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Who are we interviewing for?</h1>
      <p className="sub">This shapes every question you'll get — be specific.</p>
      <div className="card">
        <label>Job position you're applying for *</label>
        <input
          value={role}
          placeholder="e.g. Senior Backend Engineer"
          onChange={(e) => setRole(e.target.value)}
        />

        <label>Company interview style (optional — pick a known playbook)</label>
        <select
          value={skillPack}
          onChange={(e) => {
            setSkillPack(e.target.value)
            const p = packs.find((x) => x.id === e.target.value)
            if (p && p.company !== 'Generic Startup') setCompany(p.company)
          }}
        >
          <option value="">No specific company / research one below</option>
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.company} — {p.summary}
            </option>
          ))}
        </select>

        <label>…or just name your target company — we&apos;ll research its interview style</label>
        <input
          value={company}
          placeholder="e.g. Stripe"
          onChange={(e) => {
            setCompany(e.target.value)
            // Typing a fresh company name overrides a previously picked playbook.
            if (skillPack) setSkillPack('')
          }}
        />

        <label>Technologies / skills, comma-separated</label>
        <input
          value={technologies}
          placeholder="e.g. Go, PostgreSQL, Kubernetes, system design"
          onChange={(e) => setTechnologies(e.target.value)}
        />

        <label>Years of experience: {years}</label>
        <input
          type="range"
          min={0}
          max={20}
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
        />

        <label>Anything else the interviewer should know? (optional)</label>
        <textarea
          value={notes}
          placeholder="e.g. I freeze up on system design questions; I'm switching from frontend to backend…"
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <div className="error">{error}</div>}
        <div className="mt">
          <button disabled={busy || !role.trim()} onClick={() => void save()}>
            {researching ? `Researching ${company.trim()}…` : busy ? 'Saving…' : 'Continue to level check →'}
          </button>
        </div>
      </div>
    </>
  )
}
