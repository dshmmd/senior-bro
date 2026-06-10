export interface SkillPackSummary {
  id: string
  company: string
  roles: string[]
  summary: string
}

export interface Profile {
  id: number
  role: string
  company: string | null
  skill_pack: string | null
  technologies: string[]
  years_experience: number
  notes: string | null
  level: string | null
  level_summary: string | null
  weaknesses?: Weakness[]
}

export interface Weakness {
  id: number
  title: string
  detail: string
  fix: string
  status: 'open' | 'improving' | 'resolved'
}

export interface InterviewReport {
  overall_score: number
  level_estimate: string
  dimensions: { name: string; score: number; comment: string }[]
  strengths: string[]
  weaknesses: { title: string; detail: string; fix: string }[]
  advice: string
}

export interface InterviewSummary {
  id: number
  mode: 'voice' | 'text'
  kind: 'full' | 'coaching'
  status: 'active' | 'finished'
  created_at: string
  turns: number
  overall_score: number | null
  level_estimate: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  health: () => request<{ ok: boolean; configured: boolean }>('/health'),
  getConfig: () => request<{ provider?: string; model?: string; hasKey: boolean }>('/config'),
  saveConfig: (provider: string, apiKey: string, model?: string) =>
    post<{ ok: boolean }>('/config', { provider, apiKey, model }),
  skills: () => request<SkillPackSummary[]>('/skills'),
  getProfile: () => request<Profile | null>('/profile'),
  createProfile: (p: {
    role: string
    company?: string
    skill_pack?: string
    technologies: string[]
    years_experience: number
    notes?: string
  }) => post<Profile>('/profile', p),
  startCalibration: (profile_id: number) =>
    post<{ calibration_id: number; questions: string[] }>('/calibration/start', { profile_id }),
  submitCalibration: (calibration_id: number, answers: string[]) =>
    post<{ level: string; summary: string }>('/calibration/submit', { calibration_id, answers }),
  startInterview: (profile_id: number, mode: 'voice' | 'text', kind: 'full' | 'coaching', weakness_id?: number) =>
    post<{ interview_id: number; message: string }>('/interviews', { profile_id, mode, kind, weakness_id }),
  sendMessage: (id: number, content: string) =>
    post<{ message: string; done: boolean }>(`/interviews/${id}/messages`, { content }),
  finishInterview: (id: number) => post<InterviewReport>(`/interviews/${id}/finish`, {}),
  listInterviews: () => request<InterviewSummary[]>('/interviews'),
  listWeaknesses: () => request<Weakness[]>('/weaknesses'),
  setWeaknessStatus: (id: number, status: string) => post(`/weaknesses/${id}/status`, { status }),
}
