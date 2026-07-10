# 2026-07-10 — Real Arvan models live: GLM-5.2 chat + GPT-4o-Transcribe voice (commit `fa7043a`)

Owner priority: real audio transcripts for voice chat (browser STT was
embarrassing) + real chat model, mocks gone.

## What's live (local dev DB, `senior_bro`)

- **GLM-5.2** (arvan, model id `GLM-5-2-Brain-fgdci`, per-model gateway base URL,
  `apikey` auth) — **enabled + global default**, prices 300,000 / 1,000,000
  **Toman** per MTok. Selected as the local owner's model. Live-tested (raw curl
  + our createModel probe).
- **GPT-4o-Transcribe** (arvan, model id `gpt-4o-transcribe`) — routed to the
  `voice.transcribe` feature. Live-tested end-to-end: synthesized real speech
  (`say` → wav) → raw gateway AND `POST /api/voice/transcribe` both returned the
  exact transcript; metered (`arvan gpt-4o-transcribe in=30 out=15`). The web
  mic now records+uploads (R30 `Recorder`); browser STT remains ONLY the
  fallback when no transcription model is available — exactly the owner's ask.
- Mock models deleted from the catalog. Secrets live ONLY in the untracked
  `.demo-models.json` (gitignored) — re-seedable after `make db-reset` (that
  script needs hosted mode; in local mode add via `POST /api/admin/models`).

## Code changes (committed)

- Admin model price caps raised 10k → 100M: **prices are per-MTok in the
  deploy's currency** (Toman here), documented in the schema.
- `web/src/strings.ts` gains `CURRENCY` ('Toman') + `costLabel()` — Plan page
  shows "≈ N Toman per interview" instead of a hardcoded `$`.
- Admin Add-model form defaults to provider `arvan` (the production gateway);
  price labels currency-neutral.

## Gotcha (bit us today)

Running a `scripts/verify-*.mjs` **manually** (outside the integration suite)
uses the DEFAULT `DATABASE_URL` = the dev DB. A manual `verify-admin-v2.mjs`
run had left `voice.transcribe` (and `interview.hr`) **kill-switched = true**
and a stray "Premium" mock in dev — which made `/api/voice/available` false
after seeding. Always pass an isolated `DATABASE_URL` for manual verify runs,
or clean up after (the integration suite already isolates via `senior_bro_itest`).
