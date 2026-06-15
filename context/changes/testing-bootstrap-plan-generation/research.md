---
date: 2026-06-15T00:00:00+00:00
researcher: Claude Sonnet 4.6
git_commit: e2d7ea389192acefde469260bde33324fbc200da
branch: master
repository: kkarolxyz/10xtraining
topic: "Ground rollout Phase 1 — vitest bootstrap + R1/R4 integration tests for plan generation"
tags: [research, testing, plan-generation, llm, input-validation, vitest, cloudflare-workers]
status: complete
last_updated: 2026-06-15
last_updated_by: Claude Sonnet 4.6
---

# Research: Bootstrap + plan generation (Phase 1)

**Date**: 2026-06-15
**Researcher**: Claude Sonnet 4.6
**Git Commit**: e2d7ea389192acefde469260bde33324fbc200da
**Branch**: master
**Repository**: kkarolxyz/10xtraining

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md`. Verify R1 (LLM malformed/missing-field
response crashes or persists invalid plan) and R4 (empty/sparse input accepted → meaningless plan,
no error shown). Confirm vitest + @cloudflare/vitest-pool-workers compatibility with the current
stack. Ground the cheapest test layer for each risk.

---

## Summary

Both R1 and R4 are real, grounded risks — neither is speculative. The code path is fully traceable.

**R1**: Malformed JSON is caught before any DB insert; the 422 response and zero-persistence guarantee
hold. The gap is structural depth: only the top-level `weeks` array is validated; the PRD's guardrails
(4 weeks, 7 days each, ≥1 rest day) live only in the prompt text, not in code. A mocked LLM returning
`{ weeks: [{ week: 1, focus: "x", days: [] }] }` passes all current checks and would be persisted.

**R4**: Empty stats and single-ride input are caught server-side (422 with user-readable message) —
independent of the client guard. However, two lines of garbage text pass the server check and reach the
LLM. Invalid `goal` values bypass the API layer and hit the DB CHECK constraint as a 500 rather than a
user-readable 4xx. Client bypass is trivially possible.

**Test infrastructure**: Zero tests exist. The stack is fully compatible with vitest 4.1.9 +
@cloudflare/vitest-pool-workers 0.16.15. One issue: wrangler 4.90.0 should be upgraded to 4.100.0 to
match pool-workers' declared dependency. The `nodejs_compat` flag is already configured in
wrangler.jsonc, which is a hard requirement for the workers pool.

**Historical context**: F-02 explicitly deferred Zod validation to S-01; S-01 never added it. The
shallow structural check is a deliberate deferral that was never revisited, not an oversight in the
current code.

---

## Detailed Findings

### R1 — LLM malformed/missing-field response

#### Entry point

`src/pages/api/plans/generate.ts` is the HTTP handler for `POST /api/plans/generate`.

- Line 7–8: Auth guard — returns 401 if `context.locals.user` is absent.
- Line 11: Body parsed as `{ rideStats: string; goal: string }` with a naked `as` cast; no runtime
  validation of the body shape.
- Line 16: Calls `generatePlan(rideStats, goal as PlanGoal)`.
- Lines 17–23: `try/catch` around `generatePlan`. On any thrown error:
  - If `e.message` starts with `"Failed to parse"` → replaced with the generic
    `"The AI returned an unexpected response — please try again"`.
  - All other error messages (including `"Insufficient ride data..."` and
    `"Invalid training plan: missing or empty 'weeks' array."`) are forwarded verbatim.
  - Returns `{ status: 422 }`.
- Lines 32–36: DB insert — **only reached after `generatePlan` returns without throwing**.
  DB insert is inside the happy path, after the try/catch. Zero plans are persisted on LLM error.

#### LLM call and response parsing

`src/lib/openrouter.ts` — `generatePlan(rideStats, goal)`:

- Line 40–42: Sparse input guard (covered under R4 below).
- Line 45–46: Checks `OPENROUTER_API_KEY` — throws with descriptive message if absent.
- Lines 49–52: Creates OpenAI SDK client pointed at `https://openrouter.ai/api/v1`.
- Lines 54–57: `client.chat.completions.create()` — model `"google/gemini-2.5-flash"`, non-streaming,
  single user message containing the full system prompt.
- Lines 59–62: Extracts `response.choices[0]?.message?.content` — throws on empty/null.
- Lines 64–67: Strips markdown code fences (`\`\`\`json`, `\`\`\``). This is a defensive fallback
  beyond what the prompt instructs (the prompt already asks for JSON-only output).
- Line 71: `JSON.parse(cleaned)` inside `try/catch`.
- Line 73: Throws `Error("Failed to parse training plan JSON: ...")` with first 200 chars of response
  on parse failure. This prefix is what triggers the message sanitization in the API handler.
- Line 76: Type-casts to `TrainingPlan` — **zero runtime check**.
- Lines 77–78: `if (!Array.isArray(plan.weeks) || plan.weeks.length === 0)` — throws
  `"Invalid training plan: missing or empty 'weeks' array."` Only check applied.
- Line 81: Returns `plan`.

#### Structural validation gap (R1 core exposure)

Current code validates ONLY that `plan.weeks` is a non-empty array. The PRD guardrails
(`FR-006`, `§Guardrails`): 4 weeks, 7 days each, ≥1 rest day, no duplicate sessions, visible load
progression — are enforced only via prompt text. They are not checked in code.

A response of:

```json
{ "weeks": [{ "week": 1, "focus": "speed", "days": [] }] }
```

passes all current checks and would be inserted into the DB. Individual week/day/session fields
(`week.week`, `week.focus`, `week.days`, `day.day`, `day.session.type`, `day.session.duration_min`,
`day.session.description`) are never validated. TypeScript types (`TrainingPlan`, `TrainingWeek`,
`TrainingDay`, `TrainingSession` — all in `src/types/database.ts`) exist at compile time only.

**What `plan.md` should prioritise in R1 tests:**
1. JSON.parse failure → 422, zero DB inserts.
2. Missing `weeks` field → 422, zero DB inserts.
3. Structurally partial response (`weeks` present but empty nested fields) → what the code currently
   allows through; the plan can choose to add a guard or just document the known gap.
4. Oracle for assertions: PRD's structural requirements (4 weeks, 7 days, ≥1 rest), not LLM output.

#### DB schema

`supabase/migrations/20260528000000_create_plans_table.sql`:
- `plan JSONB NOT NULL` — DB accepts any JSON; no schema enforcement at DB layer.
- `goal TEXT NOT NULL CHECK (goal IN ('speed', 'distance'))` — only field with DB-level constraint.
- `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE` — plan rows cascade-delete when the
  user is deleted (relevant to R6, not Phase 1).
- RLS policies enforce per-user SELECT, INSERT, DELETE. UPDATE policy added retroactively in
  `20260529000000_plans_update_policy.sql`.

---

### R4 — Sparse/empty input accepted

#### Server-side validation path

The only server-side guard is in `src/lib/openrouter.ts:40–42`:

```typescript
const nonEmptyLines = rideStats.split("\n").filter((l) => l.trim().length > 0);
if (nonEmptyLines.length < 2) {
  throw new Error("Insufficient ride data: provide at least 2 rides to generate a training plan.");
}
```

Behaviours:
- `rideStats: ""` → 0 non-empty lines → throws → 422 with user-readable message ✅
- `rideStats: "one ride"` → 1 non-empty line → throws → 422 with user-readable message ✅
- `rideStats: "garbage\nstuff"` → 2 non-empty lines → PASSES → LLM is called with junk ⚠️
  (This boundary case is not a regression risk for the PRD's stated concern — "empty or single ride"
  — but is worth noting as a quality gap.)

The API handler (`src/pages/api/plans/generate.ts:11`) applies zero validation to the request body.
`rideStats` and `goal` are extracted from a naked `as` cast and passed directly to `generatePlan`.

#### Goal field gap

`goal` is not validated at the API layer. If a caller sends `goal: "invalid_goal"`, the server passes
it through `generatePlan` to the LLM, which then generates a plan. The plan is then handed back and
inserted via `generate.ts:32–36`. The DB `CHECK (goal IN ('speed', 'distance'))` constraint rejects
the row — but the response to the client will be a 500 `"Failed to save plan"`, not a 4xx with
user-readable guidance about the invalid goal. This is an untested error path that the test plan
should either cover or explicitly exclude.

#### Client-side guard

`src/components/GeneratePlanForm.tsx:26–33`:
- Checks `!rideStats.trim()` (empty/whitespace-only → shows error, stops fetch).
- Checks `!goal` (no goal selected → shows error, stops fetch).
- Does NOT check minimum ride count client-side (message mentions "at least 2 rides" but doesn't
  enforce it in JS).
- **Easily bypassed** by posting directly to `/api/plans/generate`.

The server-side guard in `generatePlan` is independent of the client guard. Testing them separately
confirms the intended design (server is the authority, client is convenience only).

---

### Test Infrastructure

#### Current state

Zero test infrastructure exists:
- No `vitest.config.*`, `jest.config.*`, or `playwright.config.*`.
- No `*.test.ts`, `*.test.tsx`, `*.spec.ts` files anywhere in `src/`.
- No `__tests__/` directories.
- No test dependencies in `package.json`.
- No `"test"` script in `package.json`.

#### Version compatibility

`package.json` dependencies relevant to vitest integration:

| Package | Installed | Required by pool-workers | Status |
|---|---|---|---|
| vite | 7.3.3 (via override `^7.3.2`) | ^6.0 or ^7.0 | ✅ Compatible |
| wrangler | 4.90.0 | 4.100.0 (declared dep of pool-workers 0.16.15) | ⚠️ Minor upgrade needed |
| @astrojs/cloudflare | 13.5.0 | requires vite ^7.3.2 | ✅ |
| typescript | 5.9.3 | ^4.3 | ✅ |
| vitest | not installed | 4.1.9 (latest) | 🟡 Must install |
| @cloudflare/vitest-pool-workers | not installed | 0.16.15 (latest) | 🟡 Must install |

**wrangler note**: The minor version gap (4.90.0 vs 4.100.0) will likely generate a peer dependency
warning. Upgrade wrangler to `^4.100.0` before installing pool-workers to avoid the warning and
ensure the bundled workerd version matches.

#### wrangler.jsonc — test-relevant settings

- `compatibility_date: "2026-05-08"` — recent date ✅
- `compatibility_flags: ["nodejs_compat"]` — **required** for vitest-pool-workers; already set ✅
- `kv_namespaces: [{ binding: "SESSION", ... }]` — vitest config or test fixtures will need to
  declare this binding (or the tests that don't touch sessions can omit it).

#### tsconfig.json — path alias

`"paths": { "@/*": ["./src/*"] }` — any `vitest.config.ts` must mirror this with
`resolve.alias: { '@': path.resolve(__dirname, './src') }` or the `@/*` imports in source files
will fail at test time.

#### vitest.config.ts shape (for planning)

The plan phase should produce a config approximating:

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import path from "path";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
  },
});
```

Exact API should be verified against `@cloudflare/vitest-pool-workers` 0.16.x docs during the plan
phase.

#### LLM mocking strategy

`generatePlan` in `src/lib/openrouter.ts` instantiates an OpenAI SDK client and calls
`client.chat.completions.create()`. In workerd tests, global `fetch` is available but direct
`vi.mock` of ES modules works differently than in Node. Two viable approaches for planning to assess:

1. **MSW with a fetch adapter for workerd** — intercept the OpenRouter HTTP call at the fetch layer.
   Keeps tests independent of the SDK; works well in the workerd environment.
2. **vi.mock on `src/lib/openrouter.ts`** — mock `generatePlan` directly at the module boundary.
   Simpler but less realistic (bypasses the JSON parsing path that R1 is testing).

For R1 (testing that bad LLM JSON is caught), mocking at the fetch/HTTP layer is strongly preferred:
it exercises the real `JSON.parse` + structural check code path. `vi.mock('src/lib/openrouter.ts')`
would bypass that path entirely.

---

### Historical Context

#### F-02 (llm-provider-wiring) — `context/changes/llm-provider-wiring/plan.md`

Explicit deferral: `"No Zod schema validation — structural check only ('weeks' array non-empty);
full validation belongs in S-01"`. S-01 never revisited this. The current shallow check is the
product of a deliberate deferral, not a missed step. This means the plan phase should explicitly
choose whether to add structural depth in Phase 1 or document the gap and leave it for a future
refresh.

Sparse input threshold set here: `nonEmptyLines.length < 2` (at least 2 non-empty lines). The
boundary is: a two-line paste is the minimum accepted input.

Error message sanitization decided here: `"Failed to parse"` prefix → generic message. Test
assertions on 422 bodies must use the sanitized message
(`"The AI returned an unexpected response — please try again"`), not the internal one.

#### S-01 (auth-generate-save) — `context/changes/auth-generate-save/plan.md`

Error handling wired in the API handler. Deferred: retries, regenerate flow, structural validation.
Client-side validation (`!rideStats.trim()`) added here as a UX convenience. Server guard is
independent.

#### regenerate-plan (S-03) — `context/changes/regenerate-plan/plan.md`

`POST /api/plans/[id].ts` reuses the same `generatePlan` and error-handling logic as `generate.ts`.
One progress item remained unchecked: `1.10 Missing API key: modal opens, form disabled` — this
was confirmed for the `/generate` page flow but not for the dashboard regenerate modal. Phase 1
tests should cover the missing API key → 422 path for `generate.ts` as part of R1 coverage.

---

## Code References

- `src/pages/api/plans/generate.ts:7–8` — Auth guard (401)
- `src/pages/api/plans/generate.ts:11` — Naked `as` cast; no body validation
- `src/pages/api/plans/generate.ts:16` — `generatePlan(rideStats, goal as PlanGoal)` call
- `src/pages/api/plans/generate.ts:17–23` — try/catch; 422 on all LLM errors; message sanitization
- `src/pages/api/plans/generate.ts:32–36` — DB insert (only reached on success)
- `src/lib/openrouter.ts:40–42` — Only server-side R4 guard (line count ≥ 2)
- `src/lib/openrouter.ts:45–46` — API key check → 422 path
- `src/lib/openrouter.ts:54–57` — OpenAI SDK call (model: `google/gemini-2.5-flash`)
- `src/lib/openrouter.ts:64–67` — Markdown fence stripping (defensive, beyond prompt instruction)
- `src/lib/openrouter.ts:71` — `JSON.parse(cleaned)` — the failure point for R1 bad-JSON path
- `src/lib/openrouter.ts:73` — Throws `"Failed to parse training plan JSON: ..."` (sanitized upstream)
- `src/lib/openrouter.ts:77–78` — Only structural check: `Array.isArray(plan.weeks) && plan.weeks.length > 0`
- `src/types/database.ts:1–22` — `TrainingPlan`, `TrainingWeek`, `TrainingDay`, `TrainingSession` types (compile-time only)
- `supabase/migrations/20260528000000_create_plans_table.sql:1–9` — Table schema; `plan JSONB NOT NULL`; `ON DELETE CASCADE`
- `src/components/GeneratePlanForm.tsx:26–33` — Client-side guard (easily bypassed)

---

## Architecture Insights

1. **Persistence only on success.** The DB insert in `generate.ts` is inside the happy path after the
   try/catch. The "zero plans persisted on LLM error" guarantee is structural, not accidental. A test
   that checks the DB after injecting a bad LLM response is confirming the correct design.

2. **Shallow structural validation by design.** F-02 explicitly deferred Zod to S-01; S-01 never
   added it. The PRD's structural guardrails (4 weeks, 7 days, ≥1 rest day) live only in the
   prompt. This is a known gap, not a missing check in the current implementation. The plan phase
   should make a deliberate decision: add a structural depth check in Phase 1 or document and
   defer. Either is valid; the decision should be explicit.

3. **Error message sanitization is a contract.** The `"Failed to parse"` prefix triggers replacement
   in the API handler. Any test asserting on the 422 response body for bad JSON must use
   `"The AI returned an unexpected response — please try again"`, not the internal message.

4. **Two layers, independent.** Client guard and server guard are independent. Testing the server
   guard requires posting directly to the endpoint (bypassing the React form). Both paths should be
   confirmed in tests.

5. **MSW at fetch layer is the right mock depth for R1.** Using `vi.mock` on `openrouter.ts` directly
   would skip `JSON.parse` and the structural check — exactly the code path R1 needs to exercise.
   The plan phase should specify MSW (or equivalent fetch interceptor compatible with workerd) as the
   mocking strategy.

6. **`goal` validation gap is a latent 500.** Invalid goal values produce a DB error (500) rather than
   a 4xx. This is outside the stated scope of R4 in Phase 1 but should be noted for future coverage.

---

## Corrections to Test Plan §2 Risk Response Guidance

### R1 — refinement needed

**Current guidance**: "When LLM returns bad JSON or omits required fields, the endpoint returns an
error and zero plans are saved."

**Research finding**: "Omits required fields" is **partially covered**:
- Missing `weeks` → caught ✅
- Missing/wrong nested fields (week count, day arrays, session types) → NOT caught ⚠️

The "zero plans saved" guarantee is fully confirmed. The "required fields" protection is real only at
the top-level `weeks` array; nested PRD guardrails are not enforced in code.

**Recommended adjustment**: Plan phase should explicitly choose whether to (a) add a deeper structural
check covering the PRD guardrails as part of Phase 1, or (b) document the shallow check as a known
gap and defer deeper validation. The test should at minimum cover the two caught paths (bad JSON →
422; missing `weeks` → 422) and verify zero DB inserts for both.

**Oracle correction confirmed**: Assertions must use PRD constraints (4 weeks, 7 days, ≥1 rest day
per week) as the oracle, not values lifted from the mock LLM response. This principle stands.

### R4 — guidance confirmed

**Current guidance**: "Submitting empty stats or a single-ride entry to the generation endpoint
returns a 4xx with user-readable guidance."

**Research finding**: Confirmed for empty stats (0 lines) and single-ride (1 line). The message
`"Insufficient ride data: provide at least 2 rides to generate a training plan."` is user-readable
and forwarded verbatim (it does not start with `"Failed to parse"`, so it bypasses sanitization).

The **goal field gap** (invalid goal → 500 instead of 4xx) is outside R4's stated scope but worth
capturing in the plan as an explicit exclusion or as a separate test.

---

## Open Questions

1. **MSW vs vi.mock for LLM mocking in workerd**: Does MSW's fetch adapter work reliably in
   `@cloudflare/vitest-pool-workers` 0.16.x? The plan phase should verify this before specifying
   MSW as the approach. If not, `vi.mock` on `src/lib/openrouter.ts` is the fallback (with the
   understanding that it bypasses the real JSON parse path for R1).

2. **Supabase test client in Phase 1**: Phase 1 tests for R1/R4 need to verify zero DB inserts.
   Options: (a) real Supabase test project with a known user, (b) mock Supabase client. The plan
   phase should decide which approach Phase 1 uses, noting that Phase 3 will use a real test project
   for the account-lifecycle tests.

3. **KV binding (SESSION) in test env**: `wrangler.jsonc` declares a KV namespace binding. vitest
   pool-workers reads wrangler config to set up the workerd environment. Tests for the generation
   endpoint may not need the SESSION binding, but if pool-workers fails to initialise without it, a
   test-only KV binding declaration may be needed.

4. **wrangler upgrade path**: Upgrade from 4.90.0 → 4.100.0 before installing pool-workers. Confirm
   no breaking changes in wrangler 4.90 → 4.100 changelog (primarily infra flags; unlikely to affect
   app code).

5. **Structural depth decision for R1**: Should Phase 1 add a PRD-guardrail structural check (4
   weeks, 7 days, ≥1 rest day) or only cover the existing checks (bad JSON, missing `weeks`)? This
   is a product decision for the plan phase. Adding the check expands test coverage but also adds
   production validation logic that doesn't exist yet.
