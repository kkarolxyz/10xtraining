# Bootstrap + Plan Generation Tests — Implementation Plan

## Overview

Install vitest configured for Cloudflare Workers (workerd) and write the first
integration tests for the plan generation feature, covering risks R1 (LLM malformed
or missing-field response persists an invalid plan) and R4 (sparse input accepted,
meaningless plan generated with no user error). This is rollout Phase 1 of
`context/foundation/test-plan.md`.

## Current State Analysis

No test infrastructure exists. The generation flow is:

- `src/pages/api/plans/generate.ts` — HTTP handler; auth guard → `generatePlan()` call
  inside try/catch → DB insert only on success.
- `src/lib/openrouter.ts:generatePlan()` — sparse input check (< 2 non-empty lines),
  OpenAI SDK call, `JSON.parse`, shallow `weeks` array check. Throws on failure; API
  handler catches and returns 422.
- Zero test files anywhere in `src/` or `tests/`.

### Key Discoveries

- `src/lib/openrouter.ts:40–42` — Only server-side R4 guard: `nonEmptyLines.length < 2`.
- `src/lib/openrouter.ts:71` — `JSON.parse(cleaned)` — the R1 bad-JSON failure point.
- `src/lib/openrouter.ts:77–78` — Only structural check: `plan.weeks` non-empty array.
- `src/pages/api/plans/generate.ts:17–23` — try/catch; message sanitization: if
  `e.message.startsWith("Failed to parse")` → generic `"The AI returned an unexpected
  response — please try again"`. Other messages forwarded verbatim.
- `src/pages/api/plans/generate.ts:32–36` — DB insert only reached on success. The
  zero-insert guarantee for error cases is structural, not a runtime check.
- wrangler 4.90.0 installed; pool-workers 0.16.15 requires 4.100.0 → upgrade first.
- `compatibility_flags: ["nodejs_compat"]` already set in `wrangler.jsonc` — required
  by pool-workers.
- vite 7.3.3 (pinned via override) — compatible with vitest 4.1.9.
- tsconfig path alias `@/*` → `./src/*` must be mirrored in `vitest.config.ts`.

## Desired End State

`npm test` runs a vitest suite in the real workerd runtime and exits green. The suite
contains integration tests that prove:

1. `generatePlan()` throws with "Insufficient ride data…" when given empty or
   single-ride input (R4 — server-side guard is independent of the client).
2. `generatePlan()` throws the correct error (and the error message triggers the 422
   sanitization contract in the API handler) when the OpenAI SDK returns non-JSON,
   missing-`weeks` JSON, or an empty response (R1).
3. `generatePlan()` returns a valid `TrainingPlan` when given a well-formed mock SDK
   response (R1 happy path — proves the green path works through the same code).

CI (`.github/workflows/ci.yml`) runs `npm test` before `npm run build`. Cookbook §6.1
in `test-plan.md` documents the test location, run command, and naming pattern.

## What We're NOT Doing

- Testing the HTTP handler endpoint via `SELF.fetch()` — auth fixture complexity
  (middleware, Supabase session, cookies) belongs in Phase 2 (data isolation + auth
  boundary). Phase 1 tests `generatePlan()` directly; the 422 mapping is a simple
  try/catch (generate.ts:17–23) verifiable by code inspection.
- Adding structural PRD-guardrail validation (4 weeks, 7 days each, ≥1 rest day) to
  production code. The gap is documented; adding Zod is out of scope for Phase 1.
- Testing the `goal` validation gap (invalid goal → DB CHECK constraint → 500 instead
  of 4xx). Explicitly deferred; noted in §7 of `test-plan.md`.
- Testing the regenerate endpoint (`src/pages/api/plans/[id].ts`) — it shares the same
  `generatePlan` logic; tests added here cover it transitively.
- E2e or browser tests — not planned (see test-plan.md §7).

## Implementation Approach

**Phase 1 (`/10x-implement`)** — environment only. Upgrade wrangler, install vitest +
pool-workers, write `vitest.config.ts`, add `"test"` script to package.json, write a
trivial smoke test to prove infrastructure works, wire CI.

**Phase 2 (`/10x-tdd`)** — R4 tests. Red tests first: call `generatePlan()` with
empty/sparse `rideStats` and assert it throws the right message. No SDK mock needed
(the guard throws before the OpenAI client is constructed). The boundary case (2 lines)
passes the guard; a minimal SDK mock (or missing API key setup) stops it before a real
network call.

**Phase 3 (`/10x-tdd`)** — R1 tests. `vi.mock('openai', ...)` at the SDK module level.
The mock replaces `chat.completions.create()` but `openrouter.ts` still runs its full
parsing and validation logic. Tests assert that bad SDK responses throw with the right
message (which the API handler's sanitization contract then maps to 422). A happy-path
test proves the green path returns a valid plan.

**Phase 4 (`/10x-implement`)** — cookbook and plan sync. Fill `test-plan.md §6.1` with
the concrete pattern that shipped (file location, run command, naming convention,
reference test). Mark §3 Phase 1 complete.

## Critical Implementation Details

**Error message oracle.** Tests asserting on R1 error messages must use the *internal*
message thrown by `generatePlan`, not the sanitized message the API handler shows users.
`generatePlan` throws `"Failed to parse training plan JSON: …"` (internal). The API
handler converts this to `"The AI returned an unexpected response — please try again"`
(user-facing). Phase 1 tests call `generatePlan()` directly, so the oracle is the
internal message.

**Environment variable access.** `openrouter.ts:45–46` checks `OPENROUTER_API_KEY`. In
the workerd test environment, this env var is provisioned through wrangler bindings or
`.dev.vars`. The TDD implementer must resolve how pool-workers exposes this binding to
the directly-imported `generatePlan` function, and how to override it (absent vs present)
per test. If Astro env (`astro:env/server`) is the access path rather than a raw
`process.env` read, a shim or test-scoped wrangler env config may be needed.

**vi.mock hoisting in workerd.** `vi.mock('openai', ...)` uses static hoisting (vitest
rewrites the import). Pool-workers runs in workerd which has ESM restrictions — confirm
`vi.mock` hoisting works before writing Phase 3 tests. If it does not, the fallback is
`vi.mock` on `@/lib/openrouter` itself (with the understanding that it bypasses the
JSON parse path; document as a known reduction in signal for R1).

**Wrangler upgrade first.** `npm install wrangler@^4.100.0` must land before installing
vitest + pool-workers, or npm will emit peer-dependency errors.

---

## Phase 1: Vitest + workerd environment

### Overview

Install and configure the test runner so that `npm test` runs tests inside the real
Cloudflare workerd runtime. Wire CI. Prove infra works with a trivial smoke test.

### Changes Required

#### 1. Upgrade wrangler

**File**: `package.json`

**Intent**: Bump wrangler to ^4.100.0 to satisfy pool-workers' peer dependency before
installing the test packages.

**Contract**: `devDependencies.wrangler` changes from `"^4.90.0"` to `"^4.100.0"`.
Run `npm install` to update `package-lock.json`.

#### 2. Install test packages

**File**: `package.json` (devDependencies), `package-lock.json`

**Intent**: Add vitest and the Cloudflare pool-workers package so the suite runs in the
workerd runtime rather than Node.

**Contract**:
```
npm install --save-dev vitest@^4.1.0 @cloudflare/vitest-pool-workers@^0.16.0
```

#### 3. Create `vitest.config.ts`

**File**: `vitest.config.ts` (project root)

**Intent**: Configure vitest to use pool-workers (workerd runtime), point it at the
wrangler config so it inherits `nodejs_compat` and bindings, and mirror the `@/*` path
alias from tsconfig.json.

**Contract**: Use `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`.
Minimum required: `poolOptions.workers.wrangler.configPath: "./wrangler.jsonc"` and a
`resolve.alias` entry for `@` → `./src`. Verify the exact `defineWorkersConfig` API
shape against the installed 0.16.x package before writing (the shape changed between
minor versions).

#### 4. Add `"test"` script to `package.json`

**File**: `package.json`

**Intent**: Add a `"test"` script so `npm test` runs vitest in run mode (non-watch,
exits with a code).

**Contract**: `scripts.test: "vitest run"`.

#### 5. Write smoke test

**File**: `tests/smoke/basic.test.ts`

**Intent**: A single trivially-passing test that proves the vitest + pool-workers infra
initialises and runs without error. Not a meaningful behaviour test — just infrastructure
confidence.

**Contract**: One `it('is true', () => { expect(true).toBe(true) })`. This file is
deleted or superseded once real tests exist; it exists only to give Phase 1 an
observable green signal.

#### 6. Wire CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run `npm test` before `npm run build` in the CI pipeline so the test gate
is enforced on every push to master. This fulfils the "required after §3 Phase 1"
quality gate in `test-plan.md §5`.

**Contract**: Add `- run: npm test` as a step in the `ci` job, positioned after
`npm run lint` and before `npm run build`. The `SUPABASE_URL` and `SUPABASE_KEY`
secrets are already available as repo secrets; no new secrets are needed for Phase 1
(tests target `generatePlan()` directly, not the DB).

### Success Criteria

#### Automated Verification

- `npm install` completes without peer-dependency errors
- `npm test` exits 0 with at least the smoke test passing
- `npm run lint` passes (no ESLint/TypeScript errors in new files)
- CI job passes on a push with these changes in it

#### Manual Verification

- Confirm `wrangler --version` shows 4.100.x after the upgrade
- Confirm `npx vitest run --reporter=verbose` shows the smoke test by name

---

## Phase 2: R4 — Sparse input rejection tests

### Overview

Write TDD tests proving that `generatePlan()` rejects empty and single-ride input with
a user-readable error message, independently of the client-side guard. Use `/10x-tdd`
for this phase.

First red test in one sentence: `generatePlan('', 'speed')` throws with message
matching `"Insufficient ride data"`.

### Changes Required

#### 1. R4 test file

**File**: `tests/lib/openrouter.r4.test.ts`

**Intent**: Prove that `generatePlan()` enforces the server-side sparse-input guard for
every boundary case defined in the PRD (US-01 AC: "empty input or a single ride → error,
no silent junk output"). Oracle: the PRD acceptance criterion and the specific message
string in `openrouter.ts:42`.

**Contract**: `describe('R4 — sparse input rejection', ...)` with these cases:
1. `rideStats: ""` → throws containing `"Insufficient ride data"`
2. `rideStats: "   "` (whitespace only) → throws (whitespace lines filtered)
3. `rideStats: "one ride"` (single non-empty line) → throws
4. Boundary: `rideStats: "ride1\nride2"` (exactly 2 non-empty lines) → does NOT throw
   the R4 error (reaches the next guard — either API key check or SDK mock returns;
   assert the thrown error is NOT `"Insufficient ride data"`).

Use `await expect(generatePlan(...)).rejects.toThrow(...)` for all cases. No LLM or
SDK mock needed for cases 1–3. For case 4, prevent a real HTTP call by either setting
up a minimal SDK mock in a `beforeAll` or confirming `OPENROUTER_API_KEY` is absent in
the test env (which triggers the next throw before any network call).

### Success Criteria

#### Automated Verification

- `npm test` exits 0 with all R4 tests green
- `npm run lint` passes on the new test file

#### Manual Verification

- Read the test output: each test name should be legible as a behaviour, not a
  file path (e.g., `R4 — sparse input rejection > throws with user message on empty rideStats`)
- Confirm test 4 (boundary) is testing what we think: it should fail with a
  different error, not pass silently through to the network

---

## Phase 3: R1 — LLM error handling tests

### Overview

Write TDD tests proving that `generatePlan()` catches bad LLM responses and throws
correctly — which the API handler then maps to 422 with zero DB inserts. Use
`vi.mock('openai', ...)` at the SDK level so the real `JSON.parse` and `weeks` check
run. Use `/10x-tdd` for this phase.

First red test in one sentence: when the OpenAI SDK `create()` returns
`{ choices: [{ message: { content: 'not valid json' } }] }`, `generatePlan()` throws
with message matching `"Failed to parse training plan JSON"`.

### Changes Required

#### 1. R1 test file

**File**: `tests/lib/openrouter.r1.test.ts`

**Intent**: Prove the error-handling code in `openrouter.ts:59–78` catches every
documented failure mode. Oracle: the specific error messages in `openrouter.ts` and
the PRD structural requirements (4 weeks, ≥1 rest day — for the happy-path oracle).
The happy-path mock must be constructed from PRD requirements, not from copying a real
LLM response.

**Contract**: `vi.mock('openai', ...)` hoisted at file top. The mock replaces the
`OpenAI` default export with a class whose `chat.completions.create` is a `vi.fn()`.
Per-test, override the mock's resolved value with the scenario under test.

Cases (all call `generatePlan('ride1\nride2\nride3', 'speed')` with ≥2 lines to
bypass the R4 guard):

1. SDK returns `{ choices: [{ message: { content: 'not valid json }{' } }] }` →
   throws message matching `"Failed to parse training plan JSON"`.
2. SDK returns `{ choices: [{ message: { content: '{"no_weeks_field": true}' } }] }` →
   throws `"Invalid training plan: missing or empty 'weeks' array."`.
3. SDK returns `{ choices: [] }` (empty choices) → throws (empty/null content path).
4. OPENROUTER_API_KEY missing/absent in env → throws message matching
   `"OPENROUTER_API_KEY not configured"` (R1 unchecked item from S-03).
5. Happy path: SDK returns valid plan JSON matching PRD structure (4 weeks, each with 7
   days, at least 1 day with `session.type: "rest"`) → `generatePlan()` resolves to a
   `TrainingPlan` without throwing.

For test 5, construct the expected return value from PRD requirements (4 weeks, 7 days
each), NOT by reading the implementation's shape. This is the oracle-from-sources rule.

### Success Criteria

#### Automated Verification

- `npm test` exits 0 with all R1 tests green
- `npm run lint` passes on the new test file
- `vi.mock('openai', ...)` hoisting confirmed working in the workerd test env (if it
  does not work, document the fallback decision before proceeding)

#### Manual Verification

- Test 5 (happy path) succeeds: `generatePlan` returns a plan matching the PRD's
  structural spec, not just "something truthy"
- Confirm test 4 (missing API key) fires without a real network call
- Review: none of the `expect` values was copied from `openrouter.ts` source — each
  message is verified against the literal string in the source, used as a string
  constant, not re-derived

---

## Phase 4: Cookbook + plan sync

### Overview

Fill in `test-plan.md §6.1` with the concrete pattern that shipped (location, run
command, naming, reference test). Mark §3 Phase 1 as complete. Update `change.md`.

### Changes Required

#### 1. Fill §6.1 in `context/foundation/test-plan.md`

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `§6.1` TBD placeholder with the actual pattern so any future
contributor knows where to add integration tests, how to run them, and what a reference
test looks like.

**Contract**: Replace the `### 6.1 Adding an integration test for an API endpoint`
placeholder with:
- **Location**: `tests/lib/<module>.r<N>.test.ts` for library-level tests;
  `tests/api/<route-path>.r<N>.test.ts` when HTTP handler testing is needed.
- **Run command**: `npm test` (runs all tests) or `npx vitest run tests/lib/openrouter.r1.test.ts`
  (single file).
- **Naming convention**: describe block = risk code + risk name; test name = observable
  behaviour in one sentence.
- **Reference tests**: `tests/lib/openrouter.r4.test.ts` (sparse-input rejection),
  `tests/lib/openrouter.r1.test.ts` (LLM error handling with SDK mock).
- **Vitest config**: `vitest.config.ts` at project root using `defineWorkersConfig`
  with wrangler config path — tests run inside real workerd.
- **Oracle rule**: expected values must come from the PRD or documented message strings
  in source, never from reading the implementation output.

#### 2. Mark §3 Phase 1 complete

**File**: `context/foundation/test-plan.md`

**Intent**: Update the §3 rollout table so the orchestrator recognises Phase 1 as done
and selects Phase 2 on next invocation.

**Contract**: In the §3 table row for Phase 1, change `Status` from `change opened` to
`complete`.

#### 3. Update `change.md`

**File**: `context/changes/testing-bootstrap-plan-generation/change.md`

**Intent**: Advance status to reflect the work is done.

**Contract**: Set `status: implemented` and `updated: <today's date>`.

### Success Criteria

#### Automated Verification

- `npm test` still exits 0 after the plan-sync edits (no regressions from doc changes)
- `npm run lint` passes (no markdown linting issues, if configured)

#### Manual Verification

- Open `test-plan.md §6.1` — it reads as a self-contained guide, not a placeholder
- Open `test-plan.md §3` — Phase 1 row shows `complete`
- Re-run `/10x-test-plan` → it should advance to Phase 2 handoff

---

## Testing Strategy

### Integration Tests (this plan's deliverable)

- **Target**: `generatePlan()` from `src/lib/openrouter.ts`
- **Runtime**: workerd (via `@cloudflare/vitest-pool-workers`)
- **LLM mock**: `vi.mock('openai', ...)` at SDK level for Phase 3 — exercises real
  `JSON.parse` + `weeks` check code path
- **Files**: `tests/lib/openrouter.r4.test.ts`, `tests/lib/openrouter.r1.test.ts`
- **Oracle source**: PRD (US-01 AC, §Guardrails), literal error message strings in
  `openrouter.ts` — never derived from the implementation

### Known gaps (not tested in Phase 1, documented)

- HTTP 422 response code mapping: `generate.ts:17–23` catch block is straightforward;
  covered by code inspection. Endpoint-level HTTP testing deferred to Phase 2.
- Structural PRD-guardrail depth (4 weeks, 7 days, ≥1 rest day): only the `weeks`
  non-empty array is enforced in code. Gap documented; adding Zod is future scope.
- Invalid `goal` field (→ DB 500 instead of 4xx): outside R4 scope; deferred.
- Regenerate endpoint (`/api/plans/[id].ts`): shares `generatePlan` logic; tests here
  cover it transitively.

## References

- Research: `context/changes/testing-bootstrap-plan-generation/research.md`
- Test plan: `context/foundation/test-plan.md` (§3 Phase 1, §6.1)
- Risks: R1 (`research.md` §Detailed Findings R1), R4 (`research.md` §Detailed Findings R4)
- PRD oracle source: `context/foundation/prd.md` US-01 AC, FR-006, §Guardrails
- Pattern precedent: none — this is the first test file in the project

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Vitest + workerd environment

#### Automated

- [x] 1.1 `npm install` completes without peer-dependency errors — 64db7a9
- [x] 1.2 `npm test` exits 0 with smoke test passing — 64db7a9
- [x] 1.3 `npm run lint` passes on all new Phase 1 files — 64db7a9
- [ ] 1.4 CI job passes on push with Phase 1 changes

#### Manual

- [x] 1.5 `wrangler --version` shows 4.100.x after upgrade — 64db7a9
- [x] 1.6 `npx vitest run --reporter=verbose` shows smoke test by name — 64db7a9

### Phase 2: R4 — sparse input rejection tests

#### Automated

- [x] 2.1 `npm test` exits 0 with all R4 tests green — d43900b
- [x] 2.2 `npm run lint` passes on `tests/lib/openrouter.r4.test.ts` — d43900b

#### Manual

- [x] 2.3 Test names are legible behaviours, not file paths — d43900b
- [x] 2.4 Boundary test (2 lines) fails with a different error, not R4 message — d43900b

### Phase 3: R1 — LLM error handling tests

#### Automated

- [x] 3.1 `npm test` exits 0 with all R1 tests green — eb8f254
- [x] 3.2 `npm run lint` passes on `tests/lib/openrouter.r1.test.ts` — eb8f254
- [x] 3.3 `vi.mock('openai', ...)` hoisting confirmed working in workerd env — eb8f254

#### Manual

- [x] 3.4 Happy-path test returns a plan matching PRD structural spec (4 weeks, 7 days) — eb8f254
- [x] 3.5 Missing API key test fires without a real network call — eb8f254
- [x] 3.6 No `expect` value was copied from `openrouter.ts` — each is oracle-grounded — eb8f254

### Phase 4: Cookbook + plan sync

#### Automated

- [x] 4.1 `npm test` exits 0 after doc changes (no regressions)
- [x] 4.2 `npm run lint` passes after doc changes

#### Manual

- [x] 4.3 `test-plan.md §6.1` reads as a self-contained guide
- [x] 4.4 `test-plan.md §3` Phase 1 row shows `complete`
- [x] 4.5 `/10x-test-plan` advances to Phase 2 handoff
