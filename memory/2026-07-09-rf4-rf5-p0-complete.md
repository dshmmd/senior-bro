# 2026-07-09 — RF-4 + RF-5 shipped: refactor P0 COMPLETE (commits `506f4f8`, `d1aec38`)

All five P0 foundation epics of REFACTOR.md are done in one day: RF-1 (commit
hygiene), RF-2 (verify scripts → CI integration suite), RF-3 (server monolith
split), RF-4 (shared API types), RF-5 (web router/query/error foundations).

## RF-4 — shared API contract (`@senior-bro/shared`)

- New `shared/` workspace (third npm workspace; built `dist/` + d.ts via a
  `prepare` script; root `typecheck`/`build` compile it first). Holds every
  server↔web API type.
- Went with **plain TS interfaces + server-side `satisfies` pins** instead of
  zod response schemas (requests are already zod-validated; responses need
  compile-time enforcement, not runtime parsing). Pinned: `Health`, `UsageInfo`,
  `/models` payload, `InterviewSummary[]`, `ProgressResponse`,
  `PromptCatalogEntry[]`.
- `web/src/api.ts` = fetch/SSE wrapper + `export type * from '@senior-bro/shared'`
  (pages unchanged). Real drift found + fixed: web `CompanyPack.source` lacked
  `'tier'`. Gate proven: a deliberate bogus field in `Health` failed server tsc.

## RF-5 — web foundations

- **React Router v7** (library mode): URLs for every view; `Gate` component does
  deep-link-safe redirects (hosted unauth → /login, local unconfigured → /setup,
  no profile → /profile, uncalibrated → /calibration); `Shell` layout route owns
  topbar/offline-banner/R21-back; route wrappers hand `navigate` callbacks to the
  still-presentational pages. Interview start = `/interview/new?mode&kind&domain
  &weakness`; resume = `/interview/:id`; reports deep-linkable at `/report/:id`.
- **TanStack Query v5**: `web/src/queries.ts`; invalidation replaces the old
  whole-app `refresh()`; Dashboard fully query-driven. Remaining pages convert
  as RF-6 touches them.
- **Feedback standard**: `ToastProvider`/`useToast`, promise-based
  `ConfirmProvider`/`useConfirm` (all `window.confirm` gone), `Skeleton`
  shimmer. **No `.catch(() => undefined)` left in pages.**
- New `e2e/urls.spec.ts` (deep link / refresh-in-place / browser Back / 404
  fallback). **Gotcha:** Playwright defaulted to parallel workers → both specs
  hit the shared test DB simultaneously; pinned `workers: 1` in
  playwright.config.ts (specs intentionally build on each other's state).
- Bundle: 308 kB raw JS (react + router + query) — owner-approved D1 trade-off.

## Owner decisions recorded this session (REFACTOR.md §6)

1. Pricing display = **bundles of interviews** (not tokens). 2. i18n = deploy-time
single locale (EN or FA per deployment, never both; FA may get its own theme
later). 3. New libraries OK. 4. Celebration tone = **adaptive by level** (loud for
junior, premium-subtle for senior/staff). 5. **Admin v2 right after the design
system** — P1 order: RF-6 → RF-9 → RF-7 → RF-8 → RF-10.

## Next

RF-6 (design system + components + a11y), then RF-9 (Admin console v2).
