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
  // CV-first onboarding (R31): the extracted-then-created profile we're now reviewing/editing.
  const [draftId, setDraftId] = useState<number | null>(null)
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [cvText, setCvText] = useState('')
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    api
      .skills()
      .then(setPacks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const [researching, setResearching] = useState(false)
  const tiers = packs.filter((p) => p.source === 'tier')

  // R31: extract a profile from the uploaded/pasted résumé, then prefill the form for review/edit.
  const extractFromCv = async () => {
    if (!cvFile && cvText.trim().length < 30) {
      setError('Upload a résumé file or paste at least a few lines of it first.')
      return
    }
    setExtracting(true)
    setError('')
    try {
      const p = await api.profileFromCv({
        file: cvFile ?? undefined,
        text: cvText.trim() || undefined,
      })
      setDraftId(p.id)
      setRole(p.role)
      setCompany(p.company ?? '')
      setSkillPack('')
      setTechnologies(p.technologies.join(', '))
      setYears(p.years_experience)
      setNotes(p.notes ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExtracting(false)
    }
  }

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
      const payload = {
        role,
        company: company || undefined,
        skill_pack: pack || undefined,
        technologies: technologies
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        years_experience: years,
        notes: notes || undefined,
      }
      // A CV-extracted profile already exists (R31) — update it; otherwise create fresh (manual path).
      if (draftId) await api.updateProfile(draftId, payload)
      else await api.createProfile(payload)
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

      {draftId === null && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <b>📄 Start from your résumé</b>
          <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
            Upload a PDF (or paste the text) and we&apos;ll fill in the details below — then you review and
            tweak. Prefer to type it yourself? Just skip this and fill the form.
          </div>
          <input
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain"
            onChange={(e) => setCvFile(e.target.files?.[0] ?? null)}
          />
          <textarea
            value={cvText}
            placeholder="…or paste your résumé text here"
            style={{ marginTop: 8 }}
            onChange={(e) => setCvText(e.target.value)}
          />
          <div className="mt">
            <button
              disabled={extracting || (!cvFile && cvText.trim().length < 30)}
              onClick={() => void extractFromCv()}
            >
              {extracting ? 'Reading your résumé…' : 'Extract from résumé →'}
            </button>
          </div>
          {/* Show extraction failures (out of free impressions, no plan, model error) right here,
              at the button the user just pressed — not only in the form card below. */}
          {error && (
            <div className="error" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>
      )}

      {draftId !== null && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          ✓ We read your résumé and filled in the details below — <b>review and edit</b>, then continue.
        </div>
      )}

      <div className="card">
        <label>Job position you're applying for *</label>
        <input
          value={role}
          placeholder="e.g. Senior Backend Engineer"
          onChange={(e) => setRole(e.target.value)}
        />

        <label>Target company (optional — we&apos;ll research its interview style)</label>
        <input
          value={company}
          placeholder="e.g. Stripe"
          onChange={(e) => {
            setCompany(e.target.value)
            // Typing a company overrides a previously picked tier.
            if (skillPack) setSkillPack('')
          }}
        />

        {tiers.length > 0 && (
          <>
            <label style={{ marginTop: 12 }}>Don&apos;t know the company? Aim for a tier instead</label>
            <div className="provider-grid">
              {tiers.map((tier) => (
                <div
                  key={tier.id}
                  className="card clickable"
                  style={{ borderColor: skillPack === tier.id ? 'var(--accent)' : undefined }}
                  onClick={() => {
                    if (skillPack === tier.id) {
                      setSkillPack('')
                      setCompany('')
                    } else {
                      setSkillPack(tier.id)
                      // The tier becomes the "target" — shown in the interview + report.
                      setCompany(tier.company)
                    }
                  }}
                >
                  <b>{tier.company}</b>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{tier.summary}</div>
                </div>
              ))}
            </div>
          </>
        )}

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
