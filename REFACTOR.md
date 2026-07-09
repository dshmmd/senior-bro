# Senior Bro — Refactor Plan (2026-07-09)

> **This is the live refactor plan.** It is deliberately self-contained: any agent
> (Claude, Codex, or another model) should be able to pick up an item from here with
> no other conversation context. Work it like ROADMAP phases: one epic at a time,
> tick `[x]` as items land, append a `memory/` entry per milestone, and verify with
> `make check` (+ `make e2e` for UI work) before every commit. Owner reviews at
> every epic gate.
>
> **Rule while this plan is open: refactor epics come before new features** (owner,
> 2026-07-09). New feature ideas get parked in ROADMAP as usual; only P0/P1 items
> here may interleave with urgent owner asks.

## 1. Why this plan exists

Owner's vision (2026-07-09, verbatim intent):

> We want to help people — **even those with no knowledge of AI or software** —
> improve their skills (**technical, language, soft skills**) and bring them an
> **easy path to applying for jobs**, in a way that's **interesting and produces
> dopamine** for them.

Three demands drive this plan:

1. **UI/UX**: the product must delight a non-technical audience, not just work.
2. **Admin manageability**: everything operable from the admin panel, no redeploys.
3. **Engineering durability**: maintainable, robust, testable — safe for many
   agents/models to keep evolving it for years.

## 2. Evaluation — where the project actually stands

### What's genuinely strong (keep, don't churn)

- **Requirement traceability is exceptional.** R1–R39 / D1–D24 / Phases 0–24 with a
  memory log; any agent can rebuild context in minutes. This plan copies that style.
- **Data layer**: Postgres + Drizzle, 12+ versioned migrations, real FKs/cascades,
  per-user isolation with cross-user 404s proven by scripts.
- **Prompt ops**: DB-versioned prompts with rollback (D12) inside a fixed guardrail
  frame (D13) with a red-team CI test — ahead of most products this size.
- **Admin configurability foundation**: models + keys (encrypted), per-MTok prices,
  per-feature model routing (R35), invite codes, quotas, company-pack review queue —
  all live-editable. The *foundation* for "manageable by admin" exists; the *UX* doesn't.
- **Money paths**: every host call metered with a zero-usage char-estimate fallback
  (R25); entitlement enforced server-side; free tier capped (R32).
- **CI gate**: lint (strict) + typecheck + build + guardrail test + smoke + one
  Playwright e2e, on every push.

### What's weak (the refactor targets)

**Web app / UX**

- **W1 — No router.** `App.tsx` is a hand-rolled `useState<View>` machine. No URLs:
  refresh drops you back to the dashboard, browser Back doesn't work, nothing is
  bookmarkable/shareable, and every navigation is a prop-drilled callback
  (`Dashboard` takes **9** navigation callbacks). This is the single biggest
  structural blocker to UI growth.
- **W2 — No component system.** Zero files in `web/src/components/` (the dir doesn't
  exist). One 470-line `styles.css`; pages are saturated with inline `style={{…}}`
  (Dashboard alone has ~25). Emoji are the entire iconography and even navigation
  labels ("🧠 you", "💳 plan"). Every new page re-invents cards/rows/badges.
- **W3 — Silent failures.** `.catch(() => undefined)` appears throughout the pages —
  a failed profile switch, weakness load, or delete just… does nothing visible. No
  toast/notification system, no consistent loading skeletons, destructive actions
  use `window.confirm`.
- **W4 — Ad-hoc data layer.** Each page fetches in its own `useEffect` with local
  state; nothing is cached or invalidated coherently; `App.tsx` re-runs a full
  `refresh()` (health + profile) after most actions. `api.ts` is 537 lines of
  hand-maintained types that can silently drift from the server's zod schemas.
- **W5 — Language speaks to engineers, not the vision's audience.** "Tokens left",
  "BYOK", "capability tier", "distilled model", token-denominated pricing (100k/500k/1M).
  A non-technical job-seeker doesn't know what a token is. No i18n scaffolding at all
  (relevant: Arvan hosting suggests a Persian-speaking market; RTL untested).
- **W6 — The dopamine loop is half-wired.** The constellation/medals engine exists
  (Phase 6) but is buried behind a dashboard card; the medal *ceremony* on
  crystallization was explicitly deferred; there's no immediate post-answer or
  post-interview celebration moment, no streak nudge, no "you improved X since last
  time" framing. Gamification is a page, not a loop.
- **W7 — Accessibility debt.** Topbar nav items are `<div onClick>` pills (not
  buttons/links), focus states minimal, contrast unaudited, no reduced-motion
  handling in the app shell (the landing page has it).

**Server**

- **W8 — Monoliths.** `routes.ts` = 1,598 lines / 60 endpoints mixing HTTP parsing,
  entitlement, LLM orchestration, metering, and business logic. `db.ts` = 1,311
  lines. `prompts.ts` = 725. `providers.ts` = 678. Merge conflicts and accidental
  coupling are guaranteed as agents keep appending.
- **W9 — Tests live outside the test suite.** The real behavioral coverage is in
  `scripts/verify-ph*.mjs` (13 one-off phase scripts, ~1,600 lines of assertions)
  that **do not run in CI**. CI runs only 3 unit files (guardrail, capability,
  metering) + smoke + one e2e happy path. Entitlement, free-tier accounting,
  feature routing, profile isolation — the money- and trust-critical logic — has no
  regression net on push.
- **W10 — No single source of truth for API types.** Server zod schemas and
  `web/src/api.ts` types are maintained twice by hand.
- **W11 — Known money-path debt**: `cost_usd` stored as `real` (float drift),
  quota is a lifetime cap (no periods), no per-event usage audit UI, no suspend.

**Admin**

- **W12 — Admin is one 816-line page** with raw forms. Queued R26 items are exactly
  right: prompt version diff/compare, painless model+price management, per-event
  usage audit. Missing beyond that: audit log of admin actions, user suspend,
  feature flags / kill switches, and any product metrics (R38/D24) — today the
  admin can *configure* everything but can *see* almost nothing.

**Process**

- **W13 — Uncommitted work on `main`.** The 2026-07-03 onboarding redesign
  (R37/R39), admin-entitlement fix, and R30 voice changes sit modified/untracked in
  the working tree. Highest-risk item in the repo right now: one bad `git checkout`
  loses shipped, verified work.

### Vision gaps (NOT refactors — future ROADMAP features, listed so they shape the refactor)

- **Language skills** (vision says technical, *language*, soft skills): no domain
  for spoken-English / communication practice yet. The D22 domain registry is the
  right seam — the refactor must keep domains cheap to add.
- **Easy apply**: job discovery exists (Phase 5) but stops at a list; no
  apply-assist (cover letter, application tracking). The Career page refactor
  should leave room for a pipeline view.
- **Mobile**: responsive CSS exists but voice-first mobile UX is untested; the
  audience in the vision lives on phones.

## 3. Guiding principles for all refactor work

1. **Behavior-preserving first.** A refactor epic must not change user-visible
   behavior unless the epic explicitly says so. Lock behavior with tests *before*
   moving code (see RF-2).
2. **Plain language is a feature.** Every user-facing string must pass the test:
   "would a nurse switching careers understand this?" Tokens/models/providers are
   admin vocabulary, not user vocabulary.
3. **Admin sees everything, users see simplicity.** Complexity moves behind the
   admin panel, never deleted.
4. **Keep the traceability culture.** Every epic gets ROADMAP-style checkboxes here
   + a memory entry; durable decisions go to ROADMAP `D` entries.
5. **Small-bundle discipline stays (D1)** — adding a router and a data-fetching lib
   is justified; a heavyweight UI framework is not (evaluate size before adopting).

## 4. The plan — prioritized epics

Priorities: **P0** = foundations, do first, in order. **P1** = the actual
UX/admin/robustness payoff, parallelizable after P0. **P2** = later hardening.
Effort: S (≤½ day), M (1–2 days), L (3–5 days) of focused agent work.

---

### P0 — Foundations (strict order)

#### RF-1 · Commit the in-flight work & establish branch hygiene — S ✅ (2026-07-09)
Fixes W13.
- [x] Review the working tree diff (R37/R39 onboarding redesign, admin entitlement,
      R30 voice, new scripts + memory entries), run `make check` + `make e2e`,
      commit in logical chunks, push. (Feature commit `7a30765` + a docs commit.)
- [x] Add to CLAUDE.md working agreement (rule 3a): refactor work happens on
      short-lived branches merged when green; `main` is never left dirty at a gate.
- **Gate:** clean `git status`, green CI on `main`.

#### RF-2 · Promote the verify scripts into a CI integration suite — L
Fixes W9. **Do this before touching server code** — it's the safety net for RF-3/RF-4.
- [ ] Create `server/test/integration/` on `node --test`, reusing the existing
      `e2e/prepare.mjs` isolated-DB pattern (boot the built server against
      `senior_bro_test`, hosted mode, mock provider).
- [ ] Port each `scripts/verify-ph*.mjs` + `verify-model-readiness.mjs` +
      `verify-admin-entitlement.mjs` into named, focused test files:
      `entitlement.test.mjs` (free-impression accounting, 402s, admin exemption),
      `feature-routing.test.mjs`, `profiles.test.mjs` (multi-profile, delete
      cascade, cross-user 404), `onboarding.test.mjs` (CV flow), `domains.test.mjs`,
      `career.test.mjs`, `study-plan.test.mjs`, `voice.test.mjs`.
- [ ] Wire into `make test` + CI (job can share the existing Postgres service).
      Keep the original scripts until their ports are proven, then delete them.
- [ ] Add coverage reporting (c8) so gaps are visible; no hard threshold yet.
- **Gate:** CI runs the full suite in reasonable time; a deliberately broken
  entitlement check fails CI.

#### RF-3 · Break up the server monolith — L
Fixes W8. Pure move-and-split; RF-2's suite proves nothing broke.
- [ ] `server/src/routes/` split by domain: `auth.ts`, `admin.ts`, `profiles.ts`,
      `calibration.ts`, `interviews.ts`, `packs.ts`, `career.ts`, `voice.ts`,
      `plan.ts`, `usage.ts`, `me.ts` — composed in an `index.ts` that owns
      middleware order. Target: no route file >300 lines.
- [ ] Extract cross-cutting services out of route handlers into `server/src/services/`:
      `entitlement.ts` (enforceEntitlement + free-impression logic),
      `modelRunner.ts` (resolveCall + runModel + metering), `interviewEngine.ts`
      (start/message/finish/evaluate/distill orchestration).
- [ ] Split `db.ts` into per-domain query modules (`server/src/db/…`) re-exported
      through the existing `db` object so call sites keep working; same for
      `prompts.ts` (seeds vs. render helpers vs. guardrail).
- **Gate:** `make check` + full integration suite green; zero behavior diffs.

#### RF-4 · One source of truth for API types — M
Fixes W10.
- [ ] New workspace `shared/` with zod schemas for request/response shapes; server
      validates with them, web infers TS types from them (`z.infer`). Start with
      the highest-drift surfaces: health, usage, profile, interview, progress,
      admin models/prompts.
- [ ] Shrink `web/src/api.ts` to a thin typed fetch wrapper importing shared types.
- **Gate:** typecheck fails if either side changes shape unilaterally (prove it
  with a deliberate mismatch).

#### RF-5 · Web foundations: router, data layer, error surface — L
Fixes W1, W3, W4. This is the enabler for every P1 UX epic.
- [ ] Adopt a real router (recommend TanStack Router or React Router; pick by
      bundle size — D1). Every view gets a URL (`/dashboard`, `/interview/:id`,
      `/progress`, `/admin/...`); refresh/back/deep-link all work; interview resume
      becomes just `/interview/:id`.
- [ ] Adopt a query cache (recommend TanStack Query, ~13 kB): replace per-page
      `useEffect` fetching; central invalidation replaces the blunt `refresh()`;
      account/health/profile become queries any page can read (kills the 9-callback
      prop drilling).
- [ ] Error + feedback standard: a toast/notification provider; every mutation
      surfaces success/failure; **delete every `.catch(() => undefined)`**; a
      shared `<ConfirmDialog>` replaces `window.confirm`.
- [ ] Loading standard: skeleton components for card/table/chat, no more blank flashes.
- **Gate:** `make e2e` green + a new e2e asserting refresh-in-place and browser
  Back; grep proves no swallowed catches remain.

---

### P1 — The payoff (parallelizable after P0; suggested order below)

#### RF-6 · Design system + component library — L
Fixes W2, W7. Prerequisite for RF-7/RF-8.
- [ ] `web/src/components/`: `Card`, `Button`, `Badge`, `Pill`, `Modal`,
      `Toast`, `Skeleton`, `EmptyState`, `Stat`, `ProgressBar`, `Tabs`,
      `DataTable`, `Field` (label+input+error). Design tokens (spacing, type
      scale, semantic colors) as CSS variables extending the existing dark palette.
- [ ] Replace inline `style={{…}}` across pages with components/utility classes;
      replace emoji-as-icons with a small inline SVG icon set (emoji stay only
      where they're *content*, e.g. medals).
- [ ] Accessibility pass while touching everything: topbar pills become real
      `<button>`/`<a>`, focus-visible styles, aria labels, contrast check,
      `prefers-reduced-motion` respected in the app shell.
- **Gate:** visual parity-or-better screenshots per page; e2e green; axe scan of
  main pages has no serious violations.

#### RF-7 · Plain-language & onboarding/UX rewrite — M
Fixes W5. The vision's "no AI/software knowledge required" epic.
- [ ] Copy audit of every user-facing string. Rules: no "token", "model",
      "provider", "BYOK", "calibration", "distill" outside Admin. Suggested
      vocabulary: tokens→"interview minutes" or credit-in-currency; level
      check→"placement chat"; user model→"what your coach remembers".
- [ ] Pricing display (**decided**, owner 2026-07-09): humans buy "≈ N practice
      interviews", never 500k tokens (admin still sees tokens; the tokens-per-interview
      conversion factor is admin-configurable).
- [ ] Onboarding polish on the R39 flow: progress indicator, one question per
      screen, celebrate the placement result ("You're interviewing at a
      **mid-level** — here's your first goal"), never dead-end on errors.
- [ ] Centralize strings (`web/src/strings.ts` or messages files) as the i18n
      seam — actual translation/RTL is P2 (RF-12), but strings leave JSX now.
- [ ] Landing page: remove the stale BYOK marketing (known follow-up from the
      2026-07-03 memory); message the vision (skills → confidence → job).
- **Gate:** owner reads every screen; a non-technical reader test if available.

#### RF-8 · Close the dopamine loop — M
Fixes W6. Rides on RF-5 (router) + RF-6 (components).
- [ ] Medal **ceremony**: full-screen crystallization moment triggered on the
      interview that completes a cluster (the deferred Phase 6 polish) + a smaller
      first-medal / first-interview celebration.
- [ ] Post-interview report becomes a *reveal*: score counts up, improvements
      since the last session called out ("Communication +2 since Tuesday"),
      next-step CTA (drill top weakness / study plan item).
- [ ] Streak + "next star" nudge on the dashboard header (data already in
      `/api/progress`); constellation preview (mini-canvas or sparkline) on the
      dashboard card instead of a text link.
- [ ] In-interview encouragement beats: subtle progress dots per phase
      (warmup→wrap) so users feel motion during long sessions.
- **Gate:** owner plays a full interview → finish → ceremony flow and signs off.
  **Tone decided (owner 2026-07-09): adaptive by level** — one ceremony component
  with an intensity prop from the profile's calibrated level (junior → full playful
  spectacle; senior/staff → restrained premium: glow, count-up, chime).

#### RF-9 · Admin console v2 — L
Fixes W12; implements queued R26 and the audit half of R25.
- [ ] Split `Admin.tsx` into routed sub-pages (rides RF-5): Models & pricing,
      Feature routing, Prompts, Packs, Users, Invites, Usage.
- [ ] Prompts: side-by-side **diff/compare** between versions, rendered-frame
      preview, one-tap activate/rollback (R26b).
- [ ] Usage: per-event audit table (who/when/feature/model/tokens/cost) with
      filters + CSV export (R25 leftover); per-user drill-down.
- [ ] Users: suspend/unsuspend, quota edit with period support (see RF-11),
      plan override, admin-action **audit log** table (new `admin_events`).
- [ ] Kill switches: per-provider and per-feature disable flags (a stuck gateway
      shouldn't need a redeploy) — new `feature_flags` or a column on
      `feature_models`.
- **Gate:** owner performs: rotate a key, reroute a feature, diff+rollback a
  prompt, audit a user's spend, suspend a user — all without touching code.

#### RF-10 · Interview room polish — M
The core product surface; rides RF-6.
- [ ] `Interview.tsx` (364 lines) split: `ChatTranscript`, `Composer`,
      `VoiceBar`, `SteeringChips`, `PhaseIndicator`; voice state machine
      (`voice.ts` Listener/Recorder/Speaker) gets its own hook + unit tests.
- [ ] Reconnect/robustness UX: SSE drop mid-answer → visible "reconnecting",
      resume without losing the draft; guard against double-send.
- [ ] Mobile pass: composer/mic ergonomics at 380px, TTS autoplay quirks on iOS
      documented or handled.
- **Gate:** e2e covering voice-mode mock flow + a network-drop scenario.

---

### P2 — Hardening & scale (after P1, order by owner preference)

#### RF-11 · Money-path correctness — M
Fixes W11. Do before real payments (Phase 8 billing).
- [ ] `cost_usd` → `numeric` migration; centralize price math in one tested module.
- [ ] Quota periods (monthly reset option) + soft-warning thresholds surfaced
      to the user before a hard 402.
- [ ] Property-style tests around metering fallbacks and credit decrement
      (concurrency: two simultaneous interview turns can't double-spend).

#### RF-12 · i18n + RTL — M
**Decided (owner 2026-07-09): single-locale per deployment** — a deploy serves EN
*or* FA (build/env-selected, e.g. `SENIORBRO_LOCALE`), never a runtime switcher.
Rides the RF-7 string centralization: locale message files, RTL layout audit for
the FA build, per-locale voice/STT defaults, and a **per-locale theme override**
hook in the design tokens (FA gets its own theme later).

#### RF-13 · Frontend unit tests — M
Vitest + Testing Library for the components (RF-6) and hooks (voice, queries);
component snapshots for Report/Progress. e2e stays the flow-level net.

#### RF-14 · Ops & delivery (existing R28/R29/R38 — unchanged) — L
Containerize + k8s (Phase 21), `/metrics` + Prometheus/Grafana (Phase 22),
product-metrics aggregate layer + dashboards (R38/D24). Not re-planned here;
listed so this doc is the one prioritized list.

#### RF-15 · NL-store versioning & lazy migration (existing R27/D18) — L
Unchanged from ROADMAP Phase 20; sequenced after the server split (RF-3) so the
migrator lands in a services/ module, not the monolith.

---

## 5. Priority summary (the one table to read)

| # | Epic | Fixes | Effort | Depends on |
|---|------|-------|--------|------------|
| P0-1 | RF-1 Commit in-flight work | W13 | S | — |
| P0-2 | RF-2 Verify scripts → CI integration suite | W9 | L | RF-1 |
| P0-3 | RF-3 Server monolith split | W8 | L | RF-2 |
| P0-4 | RF-4 Shared API types | W10 | M | RF-3 |
| P0-5 | RF-5 Web router + query cache + error surface | W1 W3 W4 | L | RF-1 |
| P1-1 | RF-6 Design system + components + a11y | W2 W7 | L | RF-5 |
| P1-2 | RF-9 Admin console v2 (R26+) — moved early, owner 2026-07-09 | W12 | L | RF-5 RF-6 |
| P1-3 | RF-7 Plain language + onboarding + landing | W5 | M | RF-6 |
| P1-4 | RF-8 Dopamine loop (adaptive tone by level) | W6 | M | RF-5 RF-6 |
| P1-5 | RF-10 Interview room polish | — | M | RF-6 |
| P2 | RF-11…RF-15 | W11, scale | — | P1 |

Notes on sequencing:
- RF-5 can start in parallel with RF-2/RF-3 (different workspaces).
- RF-9 (admin) matters most to the owner day-to-day and can jump ahead of RF-7/RF-8
  if the owner prefers — it only needs RF-5.
- Every epic is sized to end at a reviewable gate; nothing requires a big-bang merge.

## 6. Decision points — ANSWERED by owner 2026-07-09

1. **Pricing display** (RF-7): **bundles of practice interviews** ("≈ N interviews"),
   never tokens, in the user UI. Admin keeps tokens; conversion factor admin-configurable.
2. **Localization** (RF-12): **single-locale per deployment** — a given deploy runs
   EN **or** FA, never both at runtime (build/env-selected, e.g. `SENIORBRO_LOCALE`).
   FA will later get its **own theme** as well, so the design-token layer (RF-6)
   must support per-locale theme overrides, and RF-7's string centralization is the
   seam. RTL layout audit required for the FA build.
3. **Libraries** (RF-5): approved — pick router + query lib by bundle size.
4. **Celebration tone** (RF-8): **adaptive by level** — full playful spectacle for
   junior/career-switcher users, restrained "premium" celebration (glow, count-up,
   chime) for senior/staff. One shared ceremony component, intensity prop driven by
   the profile's calibrated level.
5. **Admin v2 order** (RF-9): **early** — runs right after the design system.
   P1 order is now: RF-6 → **RF-9** → RF-7 → RF-8 → RF-10.

## 7. Tracking conventions

- Tick checkboxes here as sub-items land; an epic is done when its **Gate** passed
  owner review.
- One `memory/` entry per completed epic (`2026-MM-DD-rfN-….md`), linked in
  `memory/INDEX.md`.
- Durable design decisions made during refactor work become new `D` entries in
  ROADMAP.md (the decision log stays the single decision log).
- When this plan is fully P0+P1 complete, fold a summary into ROADMAP and mark the
  plan closed at the top of this file.
