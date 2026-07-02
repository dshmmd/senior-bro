# Phase 4 D3 — Capability tiers (BYOK output parity)

**Shipped 2026-07-02.** Closes the last deferred item of Phase 4. Keeps the UX promise consistent
across a cheap key (Haiku/Mini) and a premium one (Opus/GPT-5) — no silent quality cliff.

## Mechanism

- `server/src/capability.ts`: `Tier = 'fast' | 'standard' | 'deep'`.
  - `classifyByName(model)` — regex families: FAST (`haiku|mini|flash|nano|lite|small|instant|gemma|phi|<n>b`),
    DEEP (`opus|o1|o3|gpt-5|ultra|deep|reason|70/72/405b`), else `standard`. **FAST is checked first**,
    so `gpt-4o-mini` / `o3-mini` → fast (a small variant of a flagship line is fast).
  - `probeTier(cfg)` — starts from the name tier, then a one-shot strict-JSON instruction-following
    probe (`{"ok":true,"n":3}`). It can only **downgrade** a capable-looking name to `fast` when the
    model can't follow it; a network error trusts the name.
- **Probed once**, then stored: `POST /config` (BYOK → `users.capability_tier`) and admin model-create
  (`models.capability_tier`). Migration **0012**. Best-effort — a probe failure leaves the name-based
  fallback to resolve at call time.
- **Applied** via `ResolvedCall.tier` (`resolveTier(stored, model)` = stored ?? name):
  - token budgets: `TIERS[tier].interviewMax` (fast 1200 vs 4096) on interview start/messages,
    `TIERS[tier].evalMax` (fast 3500 vs 8192) on finish;
  - prompt variant: `TIERS[tier].guidance` — a per-tier "MODEL NOTE" appended into the interview / HR /
    coaching brief **inside** the guardrail frame (new trailing `extraGuidance` param on the three
    conversational render fns). fast = "stay tight, always finish the token/JSON"; deep = "probe depth,
    same structure"; standard = none.
- **Surfaced**: `capability_tier` in `GET /config`, `GET /usage`, and each `/api/admin/models` row
  (badge in `web/src/pages/Admin.tsx`). It's meant to be mostly invisible (the point is parity), so the
  BYOK Setup flow doesn't block on it.

## Gotchas

- `FeatureKey`/tier types: `classifyByName` must run before DEEP because "mini" would otherwise lose to
  an "o3"/"gpt-5" token. Unit test `capability.test.mjs` pins the ordering + the budget invariants.
- Mock provider branch: `system.includes('capability probe')` returns `{"ok":true,"n":3}` so the probe
  passes offline (keeps the name tier). `verify-ph4-d3.mjs` relies on this.
- The tier lives on the call, not the interview row — a re-probe (e.g. admin swaps a model's key and
  re-adds) updates behavior immediately; existing interviews aren't migrated.

## Verification / status

`scripts/verify-ph4-d3.mjs` (probe-on-create tiers for fast/standard/deep-named mock models, catalog
persistence, BYOK `/config` + `/usage` tier) + `server/test/capability.test.mjs`. `make check` +
`make e2e` green.

**Phase 4 complete** (core personalization + D3). This finishes the owner-authorized **5 → 7 → 4**
track — all three phases shipped. See [[senior-bro-project]]; next work is the owner's call
(remaining queued items are the infra track R26–R30).
