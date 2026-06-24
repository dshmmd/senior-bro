# Memory Index

One entry per completed milestone. Read this before working on the repo.

- [2026-06-11 — v0.1 foundation shipped](2026-06-11-v0.1-foundation.md) — full
  working app: server, web, voice, calibration, interviews, evaluation,
  weaknesses, coaching, 4 skill packs. All plan items P1–P8 done.
- [2026-06-11 — Phase 1: landing page](2026-06-11-phase1-landing.md) — ROADMAP.md
  created (persistent product plan); cursor-aware 3D landing (custom canvas particle
  engine), responsive pass, Makefile. Owner approved.
- [2026-06-13 — Phase 2: production hardening](2026-06-13-phase2-hardening.md) —
  SSE streaming replies + sentence-by-sentence TTS, mock provider, zod validation,
  rate limit, structured logs, ErrorBoundary/offline UX, strict ESLint+Prettier,
  GitHub Actions CI, Playwright E2E. Owner approved (CI green).
- [2026-06-24 — Phase 6: gamification](2026-06-24-phase6-gamification.md) —
  constellation skill map (canvas), `GET /api/progress`, medals/streak/heatmap/level
  trail. Built out of order at owner request. Owner decided dual+hosted-first
  (deploy target 95.38.235.93, gated on Phase 3).
- [2026-06-24 — Subscription auth + continuity](2026-06-24-subscription-auth-and-continuity.md) —
  `claude-cli`/`codex-cli` providers so a Pro/ChatGPT subscription powers the app
  with no API credits (local only; D8). CLAUDE.md "▶ START HERE" + `/continue`
  command so any session resumes with full context.
- [2026-06-24 — Phase 3: accounts & hosted mode](2026-06-24-phase3-accounts-hosted.md) —
  `SENIORBRO_MODE=local|hosted`; magic-link accounts + sessions, per-user data isolation
  (`user_id` migration), per-user provider config encrypted at rest (AES-256-GCM). Local
  mode unchanged. Unblocks deploy to 95.38.235.93; R13 admin/metering (Ph 8/9) still pending.
