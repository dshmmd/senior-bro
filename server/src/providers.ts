import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppConfig } from './config.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type OnDelta = (text: string) => void

/**
 * Optional model capabilities for a call. `webSearch` asks the provider to use its built-in
 * web-search tool (D16) — honored on Anthropic, ignored elsewhere (the model then drafts from
 * its own knowledge). Returned `searched` says whether live search actually ran.
 */
export interface ChatOptions {
  webSearch?: boolean
}

/** Token counts for one model call — feeds usage metering & quotas. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface ChatResult {
  text: string
  usage: TokenUsage
  /** True when a live web-search tool actually ran during the call (D16 provenance). */
  searched?: boolean
}

/** Rough token estimate when a provider doesn't report usage (CLI/mock): ~4 chars/token. */
function estimateUsage(system: string, messages: ChatMessage[], reply: string): TokenUsage {
  const input = system.length + messages.reduce((n, m) => n + m.content.length, 0)
  return { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(reply.length / 4) }
}

/**
 * One call for both modes: pass `onDelta` to receive text chunks as they
 * arrive; the full reply + token usage are always returned at the end.
 */
export async function chat(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096,
  onDelta?: OnDelta,
  options?: ChatOptions,
): Promise<ChatResult> {
  switch (cfg.provider) {
    case 'anthropic':
      return chatAnthropic(cfg, system, messages, maxTokens, onDelta, options)
    case 'openai':
      return chatOpenAI(cfg, system, messages, maxTokens, onDelta)
    case 'claude-cli':
      return chatClaudeCli(cfg, system, messages, onDelta)
    case 'codex-cli':
      return chatCodexCli(cfg, system, messages, onDelta)
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
  options?: ChatOptions,
): Promise<ChatResult> {
  const client = new Anthropic({ apiKey: cfg.apiKey })
  // D16: enable Anthropic's hosted web-search tool when the caller asks for it (pack research).
  const tools = options?.webSearch
    ? [{ type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: 5 }]
    : undefined
  const stream = client.messages.stream({
    model: cfg.model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    ...(tools ? { tools } : {}),
  })
  if (onDelta) stream.on('text', onDelta)
  const final = await stream.finalMessage()
  // Did the model actually invoke search? (provenance for the generated pack)
  const searched = final.content.some((b) => b.type === 'server_tool_use')
  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return {
    text,
    usage: {
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
    },
    searched,
  }
}

async function chatOpenAI(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  onDelta?: OnDelta,
): Promise<ChatResult> {
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
      // ask for a usage row on the final SSE chunk when streaming
      ...(onDelta ? { stream_options: { include_usage: true } } : {}),
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`)
  }

  interface OpenAIUsage {
    prompt_tokens: number
    completion_tokens: number
  }
  const toUsage = (u?: OpenAIUsage): TokenUsage => ({
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
  })

  if (!onDelta) {
    const data = (await res.json()) as {
      choices: { message: { content: string } }[]
      usage?: OpenAIUsage
    }
    return { text: data.choices[0]?.message.content ?? '', usage: toUsage(data.usage) }
  }

  // parse the OpenAI SSE stream
  const reader = res.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let usage: OpenAIUsage | undefined
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
      const json = JSON.parse(payload) as {
        choices: { delta?: { content?: string } }[]
        usage?: OpenAIUsage
      }
      if (json.usage) usage = json.usage
      const delta = json.choices[0]?.delta?.content
      if (delta) {
        full += delta
        onDelta(delta)
      }
    }
  }
  return { text: full, usage: toUsage(usage) }
}

// ── CLI providers (use a local subscription, no API key) ───────────

/** Render system + transcript into one prompt for a single-shot CLI call. */
function renderConversation(system: string, messages: ChatMessage[]): string {
  const turns = messages
    .map((m) => `${m.role === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${m.content}`)
    .join('\n\n')
  return `${system}\n\n=== CONVERSATION SO FAR ===\n${turns}\n\n=== YOUR REPLY (as INTERVIEWER, plain text only) ===\n`
}

interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Spawn a CLI, write `input` to stdin, stream stdout to onDelta, resolve with the full output. */
function runCli(
  cmd: string,
  args: string[],
  input: string,
  onDelta?: OnDelta,
  cwd?: string,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    // CLI providers are local-only and bill the user's own subscription. Strip any
    // API-key / base-url overrides so the CLI uses its logged-in subscription auth.
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.ANTHROPIC_BASE_URL
    delete env.OPENAI_API_KEY
    delete env.OPENAI_BASE_URL

    const child = spawn(cmd, args, { env, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (onDelta) onDelta(chunk)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (err) => {
      reject(new Error(`Could not launch "${cmd}". Is it installed and on PATH? (${err.message})`))
    })
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

const CLI_HELP = {
  'claude-cli':
    'Open a terminal, run `claude` once and sign in with your Claude Pro/Max subscription, then retry.',
  'codex-cli':
    'Open a terminal, run `codex` once and sign in with your ChatGPT/Codex subscription, then retry.',
}

async function chatClaudeCli(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  onDelta?: OnDelta,
): Promise<ChatResult> {
  // `claude -p` is Claude Code (a coding agent). Two things are essential:
  //   --system-prompt  fully REPLACES Claude Code's coding-assistant persona with
  //                    ours (--append-system-prompt only appends, so it stays "Claude
  //                    Code" and refuses to roleplay as an interviewer).
  //   --tools ""       disables all tools so technical/coding questions don't make it
  //                    try to read files or run commands instead of just asking.
  // We also run in a neutral cwd so it has no repository/project context to leak.
  const args = ['-p', '--output-format', 'text', '--tools', '', '--system-prompt', system]
  if (cfg.model) args.push('--model', cfg.model)
  const prompt = renderConversation('', messages)
  const { code, stdout, stderr } = await runCli('claude', args, prompt, onDelta, os.tmpdir())
  if (code !== 0 || !stdout.trim()) {
    throw new Error(
      `claude CLI failed (exit ${code ?? '?'}). ${stderr.trim().slice(0, 300) || CLI_HELP['claude-cli']}`,
    )
  }
  const text = stdout.trim()
  // CLI subscriptions don't report token counts; estimate so dashboards aren't blank.
  return { text, usage: estimateUsage(system, messages, text) }
}

async function chatCodexCli(
  cfg: AppConfig,
  system: string,
  messages: ChatMessage[],
  onDelta?: OnDelta,
): Promise<ChatResult> {
  // `codex exec` is also a coding agent. The persona is steered entirely by the
  // prompt (no system-prompt flag), so we fold our system text into the prompt.
  // Its stdout interleaves session framing ("codex", "tokens used", …) and echoes
  // the reply, so we capture the clean final message via -o <file> instead of
  // streaming raw stdout. Read-only sandbox + neutral cwd keep it from touching disk.
  const outFile = path.join(os.tmpdir(), `sb-codex-${crypto.randomBytes(6).toString('hex')}.txt`)
  const args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', os.tmpdir(), '-o', outFile]
  if (cfg.model) args.push('-c', `model=${cfg.model}`)
  const prompt = renderConversation(system, messages)
  const { code, stderr } = await runCli('codex', args, prompt, undefined, os.tmpdir())
  let reply = ''
  try {
    reply = fs.readFileSync(outFile, 'utf8').trim()
  } catch {
    // outFile missing → codex never produced a final message
  } finally {
    fs.rmSync(outFile, { force: true })
  }
  if (code !== 0 || !reply) {
    throw new Error(
      `codex CLI failed (exit ${code ?? '?'}). ${stderr.trim().slice(0, 300) || CLI_HELP['codex-cli']}`,
    )
  }
  if (onDelta) onDelta(reply) // emit once (codex output isn't cleanly streamable)
  return { text: reply, usage: estimateUsage(system, messages, reply) }
}

// ── mock provider (tests / dev without a key) ──────────────────────

const MOCK_QUESTIONS = [
  'Welcome! To warm up: tell me briefly about your current role and what you build.',
  'Tell me about a time you disagreed with a teammate — how did you resolve it, and what was the outcome?',
  'How would you design a URL shortener that handles a million requests a day?',
]

function mockReply(system: string, messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? ''
  if (firstUser.includes('interview playbook')) {
    const company = /Company:\s*(.+)/.exec(firstUser)?.[1]?.trim() ?? 'the company'
    const role = /target role:\s*(.+)/i.exec(firstUser)?.[1]?.trim() ?? 'Engineer'
    return JSON.stringify({
      company,
      roles: [role],
      summary: `${company} runs a structured, signal-driven interview loop.`,
      body: `## ${company} — interview playbook\n\n${company} builds products at scale; this loop targets ${role}.\n\n**Process:** recruiter screen → technical screen → onsite (coding, system design, behavioral).\n\n**Signals:** problem-solving clarity, depth on stated technologies, ownership, and communication under follow-ups.\n\n**Question styles & examples:**\n- Coding: "Design a rate limiter."\n- System design: "How would you scale a notification service?"\n- Behavioral: "Tell me about a project you owned end to end."\n\n**Calibrate** difficulty to the candidate's assessed level; push one notch above on their strongest area.`,
    })
  }
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
  if (system.includes('evaluate mock interviews')) {
    // R23: if the eval prompt listed claimed skills, judge them (mock: first weak, rest shown).
    const claimed = /claimed these skills:\s*([^.]+)\./.exec(firstUser)?.[1]
    const skillEvidence = (claimed ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((skill, i) => ({
        skill,
        verdict: i === 0 ? 'weak' : 'demonstrated',
        note:
          i === 0
            ? `Answers touched ${skill} but stayed shallow.`
            : `Showed solid command of ${skill} under follow-ups.`,
      }))
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
      skill_evidence: skillEvidence,
    })
  }
  // interview / coaching conversation: 3 questions, then wrap
  const turns = messages.filter((m) => m.role === 'user').length
  if (turns > MOCK_QUESTIONS.length)
    return 'Great session — that wraps everything I had for today. Good luck out there!\n[INTERVIEW_COMPLETE]'
  return MOCK_QUESTIONS[turns - 1] ?? MOCK_QUESTIONS[0]!
}

async function chatMock(system: string, messages: ChatMessage[], onDelta?: OnDelta): Promise<ChatResult> {
  const reply = mockReply(system, messages)
  if (onDelta) {
    for (const word of reply.split(/(?<= )/)) {
      onDelta(word)
      await new Promise((r) => setTimeout(r, 8))
    }
  }
  return { text: reply, usage: estimateUsage(system, messages, reply) }
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
