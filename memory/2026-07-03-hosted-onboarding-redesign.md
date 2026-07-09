# Hosted onboarding redesign + model-selection readiness bug (R37/R39)

Shipped 2026-07-03. Started as a bug report ("I selected a website model but the app didn't
register it — default stays on some local claude/codex") and grew into an owner-directed hosted
flow redesign (owner chose hosted mode + full redesign via AskUserQuestion).

## Root-cause bug

The client routing gate (`web/src/App.tsx`) decided "is this user set up?" from `health.configured`
only — which is `getUserConfig() !== null`, i.e. the user's OWN key/CLI. Selecting an admin-curated
provided model sets `users.model_id` but NOT `getUserConfig`, so the gate treated a model-picker as
"nothing configured" and bounced back to setup. (In local mode a legacy `~/.senior-bro/config.json`
CLI config is auto-imported on boot — `db.seed()` — so it also looked like the CLI was still the
active provider.) `resolveCall` already prioritized `model_id`, so interviews *would* have used the
picked model — the bug was purely the readiness/routing signal.

Fix: `/health` now computes and returns `interview_ready` (plus `credit_left`, `first_impressions_used`
/`_limit`) that counts a selected host model, not just the user's own config. Regression-locked by
`scripts/verify-model-readiness.mjs` (hosted, self-booting): free-intro user is not ready; host plan
with balance but no model is not ready; **selecting a model flips `interview_ready` true** and the
interview starts.

## Flow redesign (hosted)

- **BYOK retired from the UI.** Removed the anthropic/openai key providers from `Setup.tsx` and the
  whole "Bring your own key" section from `Plan.tsx`. The `byok` plan + `/config` endpoint still exist
  server-side (local CLI still uses `saveConfig`), just unreachable from the hosted UI.
- **No model gate during onboarding.** Hosted: login → profile → calibration (free first impression)
  → dashboard. Removed the forced Plan interstitial after calibration.
- **Brain model chosen at interview-start.** `App.startInterview` checks `interview_ready`; if a hosted
  user isn't entitled (no model / no balance) it routes to the reworked Plan page ("Set up your
  interviews": add balance → pick model). Audio/transcription (R30) is always-on, admin-assigned —
  the user only picks the chat/brain model. Model pickers now show capability tier + price (R37).
- **Cost clarity.** Dashboard shows a card: "N/3 free first impressions (résumé/company/level-check)
  vs. metered interviews; voice model always included." Verified live in-browser end to end.

## Follow-ups noted (not done)

- The marketing **Landing page still advertises BYOK** ("Paste your AI key", "Bring your own Claude or
  OpenAI key", "local-first · your key · your data"). Contradicts the hosted product now — needs an
  owner-voiced rewrite; left as a separate content task.
- `.claude/launch.json` gained a `senior-bro-hosted` config (demo secret) so hosted can be booted for
  preview/demo without hand-setting env vars.

`make check` + `make e2e` green.
