// Metered model execution (D4/R25) — extracted from routes.ts (RF-3).
// Every platform call goes through here so usage/cost is always recorded.
import * as db from '../db.js'
import { chat, type ChatMessage, type ChatOptions, type OnDelta } from '../providers.js'
import type { ResolvedCall } from './entitlement.js'

/** Record token usage/cost for a resolved call (D4/R25) — shared by chat calls and transcription. */
export async function meterUsage(
  user: db.User,
  call: ResolvedCall,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  const costUsd =
    (usage.inputTokens / 1_000_000) * call.priceIn + (usage.outputTokens / 1_000_000) * call.priceOut
  await db.recordUsage({
    userId: user.id,
    modelId: call.modelId,
    provider: call.cfg.provider,
    model: call.cfg.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
  })
}

/** Run a model call, record its token usage/cost, and return the text. */
export async function runModel(
  user: db.User,
  call: ResolvedCall,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
  onDelta?: OnDelta,
  options?: ChatOptions,
): Promise<string> {
  return (await runModelFull(user, call, system, messages, maxTokens, onDelta, options)).text
}

/** Like `runModel` but also returns the raw `ChatResult` (e.g. the `searched` provenance flag). */
export async function runModelFull(
  user: db.User,
  call: ResolvedCall,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
  onDelta?: OnDelta,
  options?: ChatOptions,
): Promise<{ text: string; searched: boolean }> {
  const { text, usage, searched } = await chat(call.cfg, system, messages, maxTokens, onDelta, options)
  await meterUsage(user, call, usage)
  return { text, searched: searched ?? false }
}
