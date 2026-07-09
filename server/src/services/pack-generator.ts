// Company-pack generation (D10 / Phase 15) — extracted from routes.ts (RF-3).
// Shared by generate-on-miss (/packs/ensure), target-company mode, and admin regenerate.
import * as db from '../db.js'
import { HttpError } from '../http.js'
import { extractJson } from '../providers.js'
import { renderCompanyPack } from '../prompts.js'
import type { ResolvedCall } from './entitlement.js'
import { runModelFull } from './model-runner.js'

/** The strict-JSON shape the company.pack prompt asks the model for. */
export interface PackDraft {
  company?: string
  roles?: string[]
  summary?: string
  body?: string
}

/** Draft a pack body via the model (web-search-augmented on Anthropic, D16). */
export async function draftPack(
  user: db.User,
  call: ResolvedCall,
  company: string,
  role: string,
): Promise<{ draft: PackDraft & { body: string }; searched: boolean }> {
  const promptBody = await db.activePromptBody('company.pack')
  const content = renderCompanyPack(promptBody, company, role)
  const webSearch = call.cfg.provider === 'anthropic'
  const { text, searched } = await runModelFull(
    user,
    call,
    'You research companies and respond with strict JSON.',
    [{ role: 'user', content }],
    1500,
    undefined,
    { webSearch },
  )
  const draft = extractJson<PackDraft>(text)
  const body = draft.body?.trim()
  if (!body) throw new HttpError(502, 'pack generation returned no playbook — try again')
  return { draft: { ...draft, body }, searched }
}

/** Draft a company pack via the model (web-search-augmented on Anthropic), then cache it. */
export async function generatePack(
  user: db.User,
  call: ResolvedCall,
  company: string,
  role: string,
): Promise<db.CompanyPack> {
  const { draft, searched } = await draftPack(user, call, company, role)
  return db.createPack({
    slug: db.packSlug(company),
    company: draft.company?.trim() ?? company,
    roles: Array.isArray(draft.roles) && draft.roles.length ? draft.roles : [role],
    summary: draft.summary?.trim() ?? '',
    body: draft.body,
    status: 'published',
    source: 'generated',
    model: call.cfg.model,
    searched,
    createdBy: user.id,
  })
}
