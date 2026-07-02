export interface SkillPackSummary {
  id: string
  company: string
  roles: string[]
  summary: string
  source: 'seed' | 'generated' | 'tier'
}

export interface SkillClaim {
  id: number
  skill: string
  status: 'unverified' | 'demonstrated' | 'weak'
  evidence: string | null
  source_interview_id: number | null
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
  skill_claims?: SkillClaim[]
}

export interface ProfileListItem {
  id: number
  role: string
  company: string | null
  level: string | null
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

export interface InterviewDetail {
  id: number
  profile_id: number
  mode: 'voice' | 'text'
  kind: 'full' | 'coaching'
  status: 'active' | 'finished'
  transcript: { role: 'user' | 'assistant'; content: string }[]
  report: InterviewReport | null
  created_at: string
  finished_at: string | null
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

export interface UserEvent {
  id: number
  profile_id: number
  kind: string
  detail: string
  interview_id: number | null
  created_at: string
}

export interface UserModelInfo {
  profile: { id: number; role: string; company: string | null; level: string | null }
  summary: string
  edited: boolean
  updated_at: string | null
  events: UserEvent[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
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
    credentials: 'same-origin',
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

export type PlanKind = 'free-intro' | 'host' | 'byok' | 'local'

export interface Health {
  ok: boolean
  mode: 'local' | 'hosted'
  authed: boolean
  user: { email: string | null; role: 'user' | 'admin' } | null
  plan: PlanKind | null
  configured: boolean
  has_model: boolean
}

export interface ModelOption {
  id: number
  label: string
  provider: string
  model: string
  base_url: string | null
  enabled: boolean
  is_default: boolean
  price_in: number
  price_out: number
  has_key: boolean
}

export interface UsageInfo {
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    cost_usd: number
    events: number
  }
  plan: PlanKind
  token_quota: number | null
  tokens_used: number
  credit_left: number | null
  // Free-tier "first impression" budget (R32): how many of the shared 3 the user has spent.
  first_impressions_used: number
  first_impressions_limit: number
}

export interface InviteCode {
  code: string
  token_credit: number
  note: string | null
  revoked: boolean
  redeemed_by: number | null
  redeemed_at: string | null
  expires_at: string | null
  created_at: string
}

export interface FeatureDef {
  key: string
  label: string
  hint: string
}

export interface PromptCatalogEntry {
  key: string
  label: string
  description: string
  placeholders: string[]
  guardrailed: boolean
  active_version: number | null
  version_count: number
}

export interface PromptVersion {
  id: number
  prompt_key: string
  version: number
  body: string
  author: string
  active: boolean
  created_at: string
}

export interface CompanyPack {
  id: number
  slug: string
  company: string
  roles: string[]
  summary: string
  body: string
  status: 'published' | 'draft' | 'archived'
  source: 'seed' | 'generated'
  model: string | null
  searched: boolean
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface AdminUserRow {
  id: number
  email: string | null
  role: 'user' | 'admin'
  model_id: number | null
  token_quota: number | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  events: number
}

export const api = {
  health: () => request<Health>('/health'),
  requestMagicLink: (email: string) =>
    post<{ ok: boolean; sent: boolean; link?: string }>('/auth/request', { email }),
  verifyMagicLink: (token: string) =>
    post<{ ok: boolean; email: string | null; role: 'user' | 'admin' }>('/auth/verify', { token }),
  logout: () => post<{ ok: boolean }>('/auth/logout', {}),
  getConfig: () => request<{ provider?: string; model?: string; hasKey: boolean }>('/config'),
  saveConfig: (provider: string, apiKey: string, model?: string) =>
    post<{ ok: boolean }>('/config', { provider, apiKey, model }),
  skills: () => request<SkillPackSummary[]>('/skills'),
  ensurePack: (company: string, role: string) =>
    post<{ pack_id: number; company: string; generated: boolean; searched?: boolean }>('/packs/ensure', {
      company,
      role,
    }),
  getProfile: () => request<Profile | null>('/profile'),
  listProfiles: () => request<{ profiles: ProfileListItem[]; active_profile_id: number | null }>('/profiles'),
  selectProfile: (id: number) => post<{ ok: boolean }>(`/profiles/${id}/select`, {}),
  deleteProfile: (id: number) =>
    request<{ ok: boolean; active_profile_id: number | null }>(`/profiles/${id}`, { method: 'DELETE' }),
  createProfile: (p: {
    role: string
    company?: string
    skill_pack?: string
    technologies: string[]
    years_experience: number
    notes?: string
  }) => post<Profile>('/profile', p),
  updateProfile: (
    id: number,
    p: {
      role: string
      company?: string
      skill_pack?: string
      technologies: string[]
      years_experience: number
      notes?: string
    },
  ) => request<Profile>(`/profile/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  // CV-first onboarding (R31): upload a résumé file (PDF/text) or paste text → extracted profile.
  profileFromCv: async (input: { file?: File; text?: string }): Promise<Profile> => {
    if (input.file) {
      const fd = new FormData()
      fd.append('file', input.file)
      if (input.text) fd.append('text', input.text)
      const res = await fetch('/api/profile/from-cv', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed: ${res.status}`)
      }
      return res.json() as Promise<Profile>
    }
    return post<Profile>('/profile/from-cv', { text: input.text ?? '' })
  },
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
  sendMessage: (id: number, content: string, onDelta: (text: string) => void, preference?: string) =>
    ssePost<{ message: string; done: boolean }>(
      `/interviews/${id}/messages`,
      preference ? { content, preference } : { content },
      onDelta,
    ),
  finishInterview: (id: number) => post<InterviewReport>(`/interviews/${id}/finish`, {}),
  getInterview: (id: number) => request<InterviewDetail>(`/interviews/${id}`),
  abandonInterview: (id: number) => request<{ ok: boolean }>(`/interviews/${id}`, { method: 'DELETE' }),
  listInterviews: () => request<InterviewSummary[]>('/interviews'),
  listWeaknesses: () => request<Weakness[]>('/weaknesses'),
  setWeaknessStatus: (id: number, status: string) => post(`/weaknesses/${id}/status`, { status }),
  progress: () => request<Progress | null>('/progress'),
  // personalization: "what we know about you" (D2 / D6)
  getMyModel: () => request<UserModelInfo | null>('/me/model'),
  saveMyModel: (summary: string) =>
    request<{ ok: boolean }>('/me/model', { method: 'PUT', body: JSON.stringify({ summary }) }),
  clearMyModel: () => request<{ ok: boolean }>('/me/model', { method: 'DELETE' }),
  // model catalog & usage (user-facing)
  models: () => request<{ models: ModelOption[]; selected_model_id: number | null }>('/models'),
  selectModel: (model_id: number) => post<{ ok: boolean }>('/models/select', { model_id }),
  usage: () => request<UsageInfo>('/usage'),
  // plans, mocked payment & invite redemption (D11)
  planCheckout: (tokens: number) =>
    post<{ ok: boolean; plan: PlanKind; granted: number }>('/plan/checkout', { tokens }),
  redeemCode: (code: string) =>
    post<{ ok: boolean; plan: PlanKind; granted: number }>('/plan/redeem', { code }),
  // admin
  adminListModels: () => request<ModelOption[]>('/admin/models'),
  adminCreateModel: (m: {
    label: string
    provider: string
    model: string
    base_url?: string
    apiKey?: string
    enabled: boolean
    is_default: boolean
    price_in: number
    price_out: number
  }) => post<ModelOption>('/admin/models', m),
  adminUpdateModel: (
    id: number,
    patch: Partial<{
      label: string
      base_url: string
      apiKey: string
      enabled: boolean
      is_default: boolean
      price_in: number
      price_out: number
    }>,
  ) => request<ModelOption>(`/admin/models/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminDeleteModel: (id: number) => request<{ ok: boolean }>(`/admin/models/${id}`, { method: 'DELETE' }),
  adminListUsers: () => request<AdminUserRow[]>('/admin/users'),
  adminSetQuota: (id: number, token_quota: number | null) =>
    post<{ ok: boolean }>(`/admin/users/${id}/quota`, { token_quota }),
  adminListInvites: () => request<InviteCode[]>('/admin/invites'),
  adminCreateInvite: (m: { token_credit: number; note?: string; expires_in_days: number | null }) =>
    post<InviteCode>('/admin/invites', m),
  adminRevokeInvite: (code: string) =>
    post<{ ok: boolean }>(`/admin/invites/${encodeURIComponent(code)}/revoke`, {}),
  adminFeatureModels: () =>
    request<{ features: FeatureDef[]; assignments: Record<string, number | null> }>('/admin/feature-models'),
  adminSetFeatureModel: (key: string, model_id: number | null) =>
    request<{ ok: boolean }>(`/admin/feature-models/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ model_id }),
    }),
  adminListPrompts: () => request<PromptCatalogEntry[]>('/admin/prompts'),
  adminPromptVersions: (key: string) => request<PromptVersion[]>(`/admin/prompts/${encodeURIComponent(key)}`),
  adminSavePrompt: (key: string, body: string) =>
    post<PromptVersion>(`/admin/prompts/${encodeURIComponent(key)}`, { body }),
  adminActivatePrompt: (key: string, version: number) =>
    post<{ ok: boolean }>(`/admin/prompts/${encodeURIComponent(key)}/activate`, { version }),
  adminListPacks: () => request<CompanyPack[]>('/admin/packs'),
  adminUpdatePack: (
    id: number,
    patch: Partial<{
      company: string
      summary: string
      body: string
      roles: string[]
      status: 'published' | 'draft' | 'archived'
    }>,
  ) => request<CompanyPack>(`/admin/packs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminRegeneratePack: (id: number) => post<CompanyPack>(`/admin/packs/${id}/regenerate`, {}),
  adminDeletePack: (id: number) => request<{ ok: boolean }>(`/admin/packs/${id}`, { method: 'DELETE' }),
}
