// Typed API client (cookie-authed). All request/response CONTRACT types live in
// @senior-bro/shared (RF-4) — one source of truth the server pins with `satisfies`.
// Re-exported here so pages keep importing from './api' / '../api'.
export type * from '@senior-bro/shared'
import type {
  AdminEvent,
  AdminUserRow,
  FeatureAssignment,
  UsageEventRow,
  CompanyPack,
  FeatureDef,
  Health,
  InterviewDetail,
  InterviewDomain,
  InterviewReport,
  InterviewSummary,
  InviteCode,
  ModelOption,
  Opportunity,
  PlanKind,
  Profile,
  ProfileListItem,
  ProgressResponse,
  PromptCatalogEntry,
  PromptVersion,
  ResumeReview,
  SkillPackSummary,
  StudyPlan,
  UsageInfo,
  UserModelInfo,
  Weakness,
} from '@senior-bro/shared'

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

export const api = {
  health: () => request<Health>('/health'),
  requestMagicLink: (email: string) =>
    post<{ ok: boolean; sent: boolean; link?: string }>('/auth/request', { email }),
  verifyMagicLink: (token: string) =>
    post<{ ok: boolean; email: string | null; role: 'user' | 'admin' }>('/auth/verify', { token }),
  logout: () => post<{ ok: boolean }>('/auth/logout', {}),
  getConfig: () =>
    request<{ provider?: string; model?: string; hasKey: boolean; capability_tier?: string }>('/config'),
  saveConfig: (provider: string, apiKey: string, model?: string) =>
    post<{ ok: boolean; capability_tier?: string }>('/config', { provider, apiKey, model }),
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
    domain: InterviewDomain = 'technical',
  ) =>
    ssePost<{ interview_id: number; message: string }>(
      '/interviews',
      { profile_id, mode, kind, domain, weakness_id },
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
  progress: () => request<ProgressResponse>('/progress'),
  // Phase 5 — résumé improvement + opportunity pipeline
  resumeReview: (profile_id: number) => post<ResumeReview>('/resume/review', { profile_id }),
  discoverOpportunities: (profile_id: number, location?: string) =>
    post<{ opportunities: Opportunity[]; searched: boolean }>('/opportunities', { profile_id, location }),
  targetOpportunity: (profile_id: number, company: string, role?: string) =>
    post<{ pack_id: number; company: string; generated: boolean }>('/opportunities/target', {
      profile_id,
      company,
      role,
    }),
  studyPlan: (profile_id: number) => post<StudyPlan>('/study-plan', { profile_id }),
  // personalization: "what we know about you" (D2 / D6)
  getMyModel: () => request<UserModelInfo | null>('/me/model'),
  saveMyModel: (summary: string) =>
    request<{ ok: boolean }>('/me/model', { method: 'PUT', body: JSON.stringify({ summary }) }),
  clearMyModel: () => request<{ ok: boolean }>('/me/model', { method: 'DELETE' }),
  // model catalog & usage (user-facing)
  models: () => request<{ models: ModelOption[]; selected_model_id: number | null }>('/models'),
  selectModel: (model_id: number) => post<{ ok: boolean }>('/models/select', { model_id }),
  usage: () => request<UsageInfo>('/usage'),
  // voice transcription (R30): whether an admin has assigned a transcription model, and the
  // upload itself. Falls back to browser dictation client-side when unavailable/on error.
  voiceAvailable: () => request<{ available: boolean }>('/voice/available'),
  transcribeAudio: async (audio: Blob): Promise<string> => {
    const fd = new FormData()
    const ext = audio.type.includes('wav') ? 'wav' : audio.type.includes('mp4') ? 'mp4' : 'webm'
    fd.append('file', audio, `answer.${ext}`)
    const res = await fetch('/api/voice/transcribe', { method: 'POST', credentials: 'same-origin', body: fd })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Request failed: ${res.status}`)
    }
    return ((await res.json()) as { text: string }).text
  },
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
    request<{ features: FeatureDef[]; assignments: Record<string, FeatureAssignment> }>(
      '/admin/feature-models',
    ),
  adminSetFeatureModel: (key: string, patch: { model_id?: number | null; disabled?: boolean }) =>
    request<{ ok: boolean }>(`/admin/feature-models/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  adminSuspendUser: (id: number, suspended: boolean) =>
    post<{ ok: boolean }>(`/admin/users/${id}/suspend`, { suspended }),
  adminUsageEvents: (userId?: number, limit = 200) =>
    request<UsageEventRow[]>(
      `/admin/usage-events?limit=${limit}${userId !== undefined ? `&user_id=${userId}` : ''}`,
    ),
  adminEvents: (limit = 200) => request<AdminEvent[]>(`/admin/events?limit=${limit}`),
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
