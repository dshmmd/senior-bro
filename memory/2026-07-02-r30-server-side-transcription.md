# R30: server-side transcription via GPT-4o-Transcribe on ArvanCloud

Shipped 2026-07-02. Owner supplied real ArvanCloud credentials (gateway URLs + account API key)
and had them tested live before build — GLM-5.2, Claude-Haiku-4.5 (chat) and GPT-4o-Transcribe
(audio) all confirmed working end-to-end against the real account first.

## What shipped

- `server/src/providers.ts`: `transcribe()` — OpenAI-compatible `/audio/transcriptions`, shared by
  `arvan`/`openai` (mirrors the existing `chatOpenAICompatible` pattern). Arvan's transcription
  `usage` is shaped `input_tokens`/`output_tokens` at the top level — **not**
  `prompt_tokens`/`completion_tokens` like chat completions — confirmed against a real response.
  Zero-usage falls back to a byte/char estimate, same safety net as chat (R25).
- `server/src/features.ts`: new `voice.transcribe` feature key (R35) — appears in the admin
  "Feature model routing" UI automatically, no web changes needed there.
- `server/src/routes.ts`: `resolveTranscribeCall()` is deliberately **not** built on the generic
  `resolveCall` default-fallback path — a chat model can't serve `/audio/transcriptions`, so
  falling back to the global default chat model would just fail confusingly. It only ever uses an
  explicitly admin-assigned model; unassigned → `null`. `POST /api/voice/transcribe` (multipart,
  entitlement-gated like an interview turn — not the free-intro budget, since it's used
  mid-interview) returns 409 when unconfigured so the client can fall back silently. `GET
  /api/voice/available` lets the client check first without a failed upload. Extracted
  `meterUsage()` out of `runModelFull` so both chat and transcription share the same cost/record path.
- `web/src/voice.ts`: new `Recorder` class (MediaRecorder → Blob), alongside the existing
  `Listener` (browser SpeechRecognition, untouched).
- `web/src/pages/Interview.tsx`: on mount (voice mode only) checks `voiceAvailable()`; if true, the
  mic button records → uploads → drops the transcript into the same editable box as before (D17's
  review-before-send promise is unchanged). Falls back to the original browser-dictation flow with
  zero behavior change when unavailable.

## Bug found and fixed while shipping this

Admin's "Add model" `validateKey` unconditionally probed with a chat completion. A
transcription-only curated model (GPT-4o-Transcribe) has no chat channel at all on Arvan's
gateway — the probe failed with a 424 ("no available channels ... api type chat/completions"),
which would have silently blocked admins from ever adding a transcription model through the UI.
Fixed by falling back to a tiny generated silent-WAV transcription probe when the chat probe
fails, before declaring the key invalid.

## Verification

Live end-to-end against the owner's real Arvan account (not mocked): added the model via
`/api/admin/models`, assigned it to `voice.transcribe`, POSTed real recorded speech to
`/api/voice/transcribe` → got back the exact correct transcript, confirmed metered via
`/api/usage`. Confirmed the unassigned-fallback path returns a clean 409. `make check` green.
Local Postgres was reset (`make db-reset`) after verification so the owner gets a genuinely
clean DB to configure themselves.

Next = owner's call; remaining queued items are R26–R29 (admin UX, NL-store D18, k8s deploy,
Prometheus/Grafana).
