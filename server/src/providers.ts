import Anthropic from '@anthropic-ai/sdk'
import type { AppConfig } from './config.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type OnDelta = (text: string) => void

/**
 * One call for both modes: pass `onDelta` to receive text chunks as they
 * arrive; the full reply is always returned at the end.
 */
export async function chat(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
  onDelta?: OnDelta,
): Promise<string> {
  switch (cfg.provider) {
    case 'anthropic':
      return chatAnthropic(cfg, system, messages, maxTokens, onDelta)
    case 'openai':
      return chatOpenAI(cfg, system, messages, maxTokens, onDelta)
    case 'mock':
      return chatMock(system, messages, onDelta)
  }
}

async function chatAnthropic(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  onDelta?: OnDelta,
): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey })
  const stream = client.messages.stream({
    model: cfg.model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  })
  if (onDelta) stream.on('text', onDelta)
  const final = await stream.finalMessage()
  return final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

async function chatOpenAI(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  onDelta?: OnDelta,
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
      stream: Boolean(onDelta),
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`)
  }

  if (!onDelta) {
    const data = (await res.json()) as { choices: { message: { content: string } }[] }
    return data.choices[0]?.message.content ?? ''
  }

  // parse the OpenAI SSE stream
  const reader = res.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      const json = JSON.parse(payload) as { choices: { delta?: { content?: string } }[] }
      const delta = json.choices[0]?.delta?.content
      if (delta) {
        full += delta
        onDelta(delta)
      }
    }
  }
  return full
}

// ── mock provider (tests / dev without a key) ──────────────────────

const MOCK_QUESTIONS = [
  'Welcome! To warm up: tell me briefly about your current role and what you build.',
  'Tell me about a time you disagreed with a teammate — how did you resolve it, and what was the outcome?',
  'How would you design a URL shortener that handles a million requests a day?',
]

function mockReply(system: string, messages: ChatMessage[]): string {
  if (system.includes('calibration questions'))
    return JSON.stringify([
      'What does idempotency mean and why does it matter for APIs?',
      'A deploy doubled error rates. Walk me through your first steps.',
      'When would you choose a message queue over a direct HTTP call?',
      'Describe a technical decision you regretted and what you learned.',
      'How do you decide something is over-engineered?',
    ])
  if (system.includes('grade interview calibration'))
    return JSON.stringify({
      level: 'mid',
      summary:
        'Solid fundamentals and clear communication; system design answers stayed surface-level. Mid-level with a clear path to senior.',
      per_question: Array.from({ length: 5 }, () => ({
        score: 6,
        comment: 'Reasonable answer with room for depth.',
      })),
    })
  if (system.includes('evaluate mock interviews'))
    return JSON.stringify({
      overall_score: 72,
      level_estimate: 'mid',
      dimensions: [
        { name: 'Communication', score: 8, comment: 'Clear and structured throughout.' },
        { name: 'Technical depth', score: 7, comment: 'Good fundamentals, fewer specifics under pressure.' },
        { name: 'Problem solving', score: 7, comment: 'Methodical approach to the incident question.' },
        { name: 'Behavioral / STAR', score: 6, comment: 'Stories lacked measurable outcomes.' },
        { name: 'System design', score: 6, comment: 'High-level only; no capacity estimation.' },
      ],
      strengths: ['Clear communication', 'Stays calm and structured under follow-ups'],
      weaknesses: [
        {
          title: 'System design depth',
          detail: 'The URL shortener answer never discussed storage sizing or failure modes.',
          fix: 'Practice back-of-the-envelope capacity estimation on three classic systems.',
        },
      ],
      advice:
        'You are closer than you think — one focused week on system design depth would move you a full level. Keep going.',
    })
  // interview / coaching conversation: 3 questions, then wrap
  const turns = messages.filter((m) => m.role === 'user').length
  if (turns > MOCK_QUESTIONS.length)
    return 'Great session — that wraps everything I had for today. Good luck out there!\n[INTERVIEW_COMPLETE]'
  return MOCK_QUESTIONS[turns - 1] ?? MOCK_QUESTIONS[0]!
}

async function chatMock(system: string, messages: ChatMessage[], onDelta?: OnDelta): Promise<string> {
  const reply = mockReply(system, messages)
  if (onDelta) {
    for (const word of reply.split(/(?<= )/)) {
      onDelta(word)
      await new Promise((r) => setTimeout(r, 8))
    }
  }
  return reply
}

// ── helpers ─────────────────────────────────────────────────────────

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
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- generic-return cast is the whole point
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
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
