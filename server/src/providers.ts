import Anthropic from '@anthropic-ai/sdk'
import type { AppConfig } from './config.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function chat(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
): Promise<string> {
  if (cfg.provider === 'anthropic') return chatAnthropic(cfg, system, messages, maxTokens)
  return chatOpenAI(cfg, system, messages, maxTokens)
}

async function chatAnthropic(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey })
  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  })
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

async function chatOpenAI(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`)
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message.content ?? ''
}

/** Cheap round-trip used to validate a freshly entered API key. */
export async function validateKey(cfg: AppConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await chat(cfg, 'Reply with the single word: ok', [{ role: 'user', content: 'ping' }], 16)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Models can wrap JSON in prose or code fences; pull out the first JSON
 * object/array and parse it.
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1] ?? text
  const start = candidate.search(/[[{]/)
  if (start === -1) throw new Error(`No JSON found in model response: ${text.slice(0, 200)}`)
  const trimmed = candidate.slice(start)
  let end = trimmed.length
  while (end > 0) {
    try {
      return JSON.parse(trimmed.slice(0, end)) as T
    } catch {
      end = Math.max(trimmed.lastIndexOf('}', end - 1), trimmed.lastIndexOf(']', end - 1))
      if (end <= 0) break
      end += 1
    }
  }
  throw new Error(`Failed to parse JSON from model response: ${text.slice(0, 200)}`)
}
