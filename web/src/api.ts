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

export interface DimensionProgress {
  name: string
  best: number
  avg: number
  count: number
  lit: number
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
  overall_completion: number
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

/**
 * POST that consumes a server-sent-event stream: `delta` events feed
 * `onDelta`, the `done` event's payload is the return value.
 */
async function ssePost<T>(path: string, body: unknown, onDelta: (text: string) => void): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(errBody.error ?? `Request failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // boxed so TS control-flow analysis doesn't pin it to null across the closure
  const result: { value: T | null } = { value: null }

  const handle = (chunk: string) => {
    let event = ''
    let data = ''
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!data) return
    if (event === 'delta') onDelta(JSON.parse(data) as string)
    else if (event === 'done') result.value = JSON.parse(data) as T
    else if (event === 'error') throw new Error((JSON.parse(data) as { error: string }).error)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      handle(buffer.slice(0, sep))
      buffer = buffer.slice(sep + 2)
    }
  }
  if (result.value === null) throw new Error('stream ended unexpectedly — check the server logs')
  return result.value
}

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
  startInterview: (
    profile_id: number,
    mode: 'voice' | 'text',
    kind: 'full' | 'coaching',
    weakness_id: number | undefined,
    onDelta: (text: string) => void,
  ) =>
    ssePost<{ interview_id: number; message: string }>(
      '/interviews',
      { profile_id, mode, kind, weakness_id },
      onDelta,
    ),
  sendMessage: (id: number, content: string, onDelta: (text: string) => void) =>
    ssePost<{ message: string; done: boolean }>(`/interviews/${id}/messages`, { content }, onDelta),
  finishInterview: (id: number) => post<InterviewReport>(`/interviews/${id}/finish`, {}),
  listInterviews: () => request<InterviewSummary[]>('/interviews'),
  listWeaknesses: () => request<Weakness[]>('/weaknesses'),
  setWeaknessStatus: (id: number, status: string) => post(`/weaknesses/${id}/status`, { status }),
  progress: () => request<Progress | null>('/progress'),
}
