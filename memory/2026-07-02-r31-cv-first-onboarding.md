# 2026-07-02 — R31: CV-first onboarding (résumé → profile). Phase 23 COMPLETE.

The last piece of Phase 23. A user can now start onboarding by uploading/pasting a résumé
instead of filling the form by hand; the model extracts the profile and they review/edit it.

## Server
- **`POST /api/profile/from-cv`** (`server/src/routes.ts`): accepts either
  - a **multipart** upload — a `file` field (PDF is text-extracted server-side with **`unpdf`**
    `extractText(buf, { mergePages: true })`; anything else decoded as UTF-8) plus an optional
    pasted `text` field — or
  - a **JSON** `{ text }` body (pasted résumé).
  `readResumeText(c)` branches on `content-type`. PDF is detected by extension, mime, or the
  `%PDF` magic bytes. Text is capped at 24k chars before the model call; <30 chars → 400.
- Extraction uses the new **`resume.parse`** versioned prompt (D12; seed in `prompts.ts`,
  `renderResumeParse`), routed to the **`resume.parse` feature model** (R35). Output is untrusted
  JSON — every field is coerced defensively (`str()` helper; techs deduped/capped 20; years clamped
  0–60). A profile is **created** from it (defaults: role → "Software Engineer").
- Creating from a CV **consumes one first impression** (R32) on the new profile even if the user
  abandons it — `if (call.freeIntro) await db.consumeFirstImpression(profile.id)`. Slot availability
  is enforced by `requireCall(c, 'resume', { feature: 'resume.parse' })` (new `'resume'` CallKind,
  added to `FIRST_IMPRESSION_KINDS`).
- **`PUT /api/profile/:id`** (`db.updateProfile`) is the review/edit step — re-seeds skill claims
  (R23) for any newly added technologies. Owned (404 cross-user).

## Web
- `web/src/pages/ProfileSetup.tsx`: a "📄 Start from your résumé" card (file input + paste box)
  above the manual form. Extract → `api.profileFromCv({file?,text?})` → sets `draftId` + prefills
  every field → the card flips to "review and edit" → **Save** does `updateProfile(draftId, …)`
  when a draft exists, else `createProfile` (the manual path, unchanged).
- `web/src/api.ts`: `profileFromCv` (multipart via FormData when a file is present, else JSON) +
  `updateProfile`.

## Mock provider
`providers.ts` `mockReply` gained a `resume.parse` branch (keys off "extract structured profile
data") that reflects role/tech/years from the text so tests assert a round-trip.

## Verification
`scripts/verify-ph31.mjs` (hosted, mock) — 14 assertions: pasted text → extracted profile
(role/tech/years), consumes 1/3; PUT edit works + doesn't re-burn; flows into calibration without
re-burn; a **real hand-built PDF** is text-extracted (unpdf) + parsed; too-short text → 400.
`make check` green.

## Gotchas
- `unpdf.extractText` takes the raw `Uint8Array` directly (no `getDocumentProxy` needed) and with
  `mergePages: true` returns `{ text: string }` — avoids the pdfjs-proxy `any` that tripped ESLint.
- ESLint `no-unnecessary-type-conversion`: don't `String()`/`.toString()` a value already typed as
  string — type untrusted model JSON as `unknown` and coerce with a helper instead.
- Hand-built test PDFs must use an **uncompressed** (ASCII) content stream; a deflate stream
  mangles through JS string building.

Phase 23 (R31/R32/R35/R36, D21/D23) is COMPLETE. Next owner-directed work = **Phase 24**
(interview kinds/domains technical + HR, R33/R34/D22). See [[INDEX]] and ROADMAP Phase 24.
