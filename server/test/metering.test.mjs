// Metering correctness for OpenAI-compatible providers (R25 / D19, Phase 18).
//
// Locks the Arvan gotcha: ArvanCloud AIaaS returns BOTH OpenAI-style
// `prompt_tokens`/`completion_tokens` AND Anthropic-style `input_tokens`/`output_tokens`,
// where `output_tokens` is a misleading `0` for Claude models. We must meter from the
// OpenAI fields, or we'd undercount every completion to zero.
//
// Run after `npm run build`. `node --test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openAiUsage } from '../dist/providers.js'

// The exact `usage` block from a real Arvan response (Claude-Haiku-4.5).
const ARVAN_USAGE = {
  prompt_tokens: 30,
  completion_tokens: 417,
  total_tokens: 447,
  input_tokens: 30,
  output_tokens: 0, // misleading — Anthropic-style field is empty on this gateway
  claude_cache_creation_5_m_tokens: 0,
}

test('Arvan usage is read from prompt_tokens/completion_tokens, not the zeroed output_tokens', () => {
  const u = openAiUsage(ARVAN_USAGE)
  assert.equal(u.inputTokens, 30, 'input from prompt_tokens')
  assert.equal(u.outputTokens, 417, 'output from completion_tokens, NOT output_tokens=0')
})

test('plain OpenAI usage parses', () => {
  const u = openAiUsage({ prompt_tokens: 100, completion_tokens: 250 })
  assert.equal(u.inputTokens, 100)
  assert.equal(u.outputTokens, 250)
})

test('missing usage yields zeros (caller then falls back to a char estimate)', () => {
  const u = openAiUsage(undefined)
  assert.equal(u.inputTokens, 0)
  assert.equal(u.outputTokens, 0)
})
