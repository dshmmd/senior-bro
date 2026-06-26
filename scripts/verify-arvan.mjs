// Phase 18 — Arvan provider request-path verification (no real Arvan needed).
// Spins a local stub that mimics Arvan's endpoint + response, points the compiled
// `chat()` at it as an `arvan` provider, and asserts the wire details + usage parsing.
// Usage: npm run build && node scripts/verify-arvan.mjs
import http from 'node:http'
import { chat } from '../server/dist/providers.js'

const ARVAN_BODY = {
  id: '',
  model: 'Claude-Haiku-4.5',
  object: 'chat.completion',
  created: '',
  choices: [{ index: 0, message: { role: 'assistant', content: 'آسمان آبی است.' }, finish_reason: 'stop' }],
  usage: {
    prompt_tokens: 30,
    completion_tokens: 417,
    total_tokens: 447,
    input_tokens: 30,
    output_tokens: 0, // misleading Anthropic-style field
  },
}

let captured = null
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    captured = { path: req.url, auth: req.headers.authorization, body: JSON.parse(body) }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(ARVAN_BODY))
  })
})

const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT: ' + msg)
}

await new Promise((r) => server.listen(0, r))
const port = server.address().port
const token = 'GATEWAY_TOKEN_xyz'
const baseUrl = `http://localhost:${port}/gateway/models/Claude-Haiku-4.5/${token}/v1`

try {
  const result = await chat(
    {
      provider: 'arvan',
      apiKey: '97462926-b648-50d4-af34-d25a3c2cffd2',
      model: 'Claude-Haiku-4-5-006zc',
      baseUrl,
    },
    'You are a helpful assistant.',
    [{ role: 'user', content: 'why is the sky blue?' }],
    3000,
  )

  // Response parsing
  assert(result.text.includes('آسمان'), 'assistant content parsed')
  assert(result.usage.inputTokens === 30, `input tokens 30 (got ${result.usage.inputTokens})`)
  assert(
    result.usage.outputTokens === 417,
    `output tokens 417, not the zeroed output_tokens (got ${result.usage.outputTokens})`,
  )

  // Wire details
  assert(
    captured.path === `/gateway/models/Claude-Haiku-4.5/${token}/v1/chat/completions`,
    `endpoint appends /chat/completions to the gateway base (got ${captured.path})`,
  )
  assert(
    captured.auth === 'apikey 97462926-b648-50d4-af34-d25a3c2cffd2',
    `auth uses "apikey <key>", not Bearer (got ${captured.auth})`,
  )
  assert(captured.body.model === 'Claude-Haiku-4-5-006zc', 'body sends the Arvan body-model id')
  assert(
    captured.body.max_tokens === 3000,
    `Arvan uses max_tokens (got ${JSON.stringify(captured.body.max_tokens)})`,
  )

  console.log(
    '\n✅ Arvan provider verified — endpoint/auth/body correct, usage metered from prompt/completion tokens\n',
  )
} catch (err) {
  console.error('\n❌ Arvan verification failed:', err.message, '\n')
  process.exitCode = 1
} finally {
  server.close()
}
