# 2026-06-27 — Phase 18: ArvanCloud host provider + metering hardening (R25, D19)

Owner gave a real Arvan request/response sample and said /continue. Built Arvan as a host provider
and hardened metering so no host token goes uncounted.

## Arvan specifics (from the owner's sample) — the three gotchas
1. **Endpoint** = a per-model gateway URL with the token *in the path*:
   `https://arvancloudai.ir/gateway/models/<Model>/<gatewayToken>/v1/chat/completions`.
   → store the part up to `/v1` as the model's `base_url`; append `/chat/completions` at call time.
2. **Auth** = `Authorization: apikey <UUID>` (NOT `Bearer`).
3. **Usage** = OpenAI-compatible `usage.prompt_tokens`/`completion_tokens` are the correct counts;
   Arvan ALSO returns Anthropic-style `input_tokens`/`output_tokens` where **`output_tokens` is `0`**
   for Claude models — reading those would undercount every completion to zero.
   (Body also uses `max_tokens`, not `max_completion_tokens`.)

## What shipped
- `config.ts`: `Provider += 'arvan'`; `AppConfig.baseUrl?`. `providers.ts`: refactored the OpenAI path
  into a shared **`chatOpenAICompatible`** (params: endpoint, authHeader, tokenField) used by both
  `openai` (Bearer, `max_completion_tokens`) and `arvan` (`apikey`, `max_tokens`). Exported
  `openAiUsage()` reads prompt/completion tokens.
- **Metering safety net (R25):** if a host call reports zero usage, fall back to the char-estimate so
  **no host token is recorded as 0** (covers any gateway that omits/zeros usage, incl. streamed).
- `models.base_url` column (migration **0008**); threaded `createModel`/`updateModel`/`modelConfig` →
  `AppConfig.baseUrl`. Admin "Add model" shows provider `arvan` + a gateway-URL field; route schemas
  require `base_url` for arvan; validate-key reuses the path.
- Tests: `server/test/metering.test.mjs` (locks the usage gotcha against the real Arvan sample) +
  `scripts/verify-arvan.mjs` (stub HTTP server proves endpoint path, `apikey` auth, body model/max_tokens,
  and usage = 30 in / 417 out). `make check` + `make e2e` green.

## Confirmed (answers to the owner)
- **Yes, we can compute Arvan usage**: it's OpenAI-compatible; our stack already computes
  `cost = inTok/1e6·priceIn + outTok/1e6·priceOut` from per-MTok prices on the `models` row. Enter
  Arvan's input/output prices on a model → usage + cost are automatic.

## Pending / caveats
- Admin **per-event** usage audit *view* (who/when/model/in-out/cost) → folded into R26/Phase 19; today
  admins see per-user aggregates (`/api/admin/users`).
- Live confirmation that Arvan returns `usage` on **streamed** responses is owner-side; the zero-usage
  fallback keeps cost honest regardless.
- BYOK-Arvan (a user's own Arvan key) not wired — host/admin path only (that's the billed path).

## Owner action at the gate
Add an Arvan model in Admin: paste the gateway base URL (up to `/v1`), the `apikey`, the exact body
model id (e.g. `Claude-Haiku-4-5-006zc`), and the per-MTok input/output prices.

Next = R26/Phase 19 (admin dashboard upgrade), or R27/Phase 20 (NL-store lazy migration, D18), or
deploy (R28/Phase 21) once the kubeconfig arrives.
