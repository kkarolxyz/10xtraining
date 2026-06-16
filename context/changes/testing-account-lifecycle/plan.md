# Account Lifecycle Tests — Implementation Plan

> Phase 3 of the test rollout (`context/foundation/test-plan.md §3`).

## Overview

Add the first real Supabase integration tests to the project (all prior tests are hermetic). Phase 3 covers two risks that require a live database: R6 (account deletion cascade — prove `ON DELETE CASCADE` actually fires end-to-end) and R2 SSR (RLS enforcement on the plan-read route — deferred from Phase 2 because it cannot be verified with mocks). Phase 3 also adds a pre-commit test gate scoped to TypeScript/Astro file changes, and fills in the cookbook so future contributors know how to write real-DB tests.

## Current State Analysis

**Test infrastructure** (from Phase 1 and 2): Vitest 4.1.9 + `@cloudflare/vitest-pool-workers` 0.16.15. All five existing tests are hermetic — they mock `@/lib/supabase` and `astro:env/server`. No real network calls to Supabase exist in the test suite.

**R6 deletion flow**: `src/pages/api/auth/delete-account.ts:22` calls only `adminClient.auth.admin.deleteUser(userId)`. The plans table has `REFERENCES auth.users(id) ON DELETE CASCADE` (`supabase/migrations/20260528000000_create_plans_table.sql:3`). Cascade is the sole mechanism — no `DELETE FROM plans` in application code.

**R2 SSR gap**: `src/pages/plans/[id].astro:13` queries `supabase.from("plans").select("*").eq("id", id).single()` with no `user_id` filter. Cross-user read isolation relies entirely on the `plans_select_own` RLS policy (`auth.uid() = user_id`). Deferred from Phase 2 because a hermetic mock cannot verify the policy fires.

**Env var access**: `wrangler.jsonc` has no `vars` section. Secrets (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) live in `.dev.vars`. `import { env } from "cloudflare:test"` fails hard in this project because `wrangler.jsonc:main` (`@astrojs/cloudflare/entrypoints/server`) cannot be resolved as a local file path by the pool — the entry point only exists after `npm run build`. Integration tests must run in a separate Node.js vitest pool (`vitest.integration.config.ts`) where a `globalSetup` file reads `.dev.vars` into `process.env`. The current `vitest.config.ts` has no `include`/`exclude` — it picks up all `*.test.ts` files — so `tests/integration/` must be excluded from the workerd pool config to prevent the same failure.

**Pre-commit**: `.husky/pre-commit` runs only `npx lint-staged`. No test gate.

**CI**: `npm test` is already at `.github/workflows/ci.yml:21`, between lint and build. No CI changes needed.

## Desired End State

Running `npm test` exercises R6 and R2 SSR through a real Supabase client. For R6: creating a test user, inserting a plan, calling `deleteUser`, and querying the plans table returns 0 rows — proving the cascade fires. For R2 SSR: User B's RLS-bound client querying User A's plan returns 0 rows — proving RLS blocks cross-user reads at the DB layer. Both tests are wrapped in `describe.skipIf` so CI passes gracefully until Supabase credentials are added as secrets. The pre-commit hook runs the full test suite before lint-staged when TypeScript or Astro files are staged.

### Key Discoveries

- `supabase/migrations/20260528000000_create_plans_table.sql:3` — `REFERENCES auth.users(id) ON DELETE CASCADE`. Cascade is structural; the test proves it fires, not merely that the FK exists.
- `src/pages/plans/[id].astro:13` — pure `.eq("id", id)`, no app-layer `user_id` filter. RLS is the only guard for cross-user access.
- `src/types/database.ts:1–34` — `PlanGoal = "speed" | "distance"`, `NewPlan = Omit<Plan, "id" | "created_at">`. Insert requires `user_id`, `name`, `goal`, `ride_stats`, `plan` (JSON). `TrainingPlan.weeks` must be a non-empty array of `TrainingWeek` objects with `week: number`, `focus: string`, `days: TrainingDay[]`.
- `import { env } from "cloudflare:test"` causes a hard failure in this project: the pool tries to load the main Worker (`@astrojs/cloudflare/entrypoints/server`) which doesn't exist without a production build. Integration tests must run in the Node.js vitest pool with credentials sourced from `process.env`, populated by `tests/integration/setup.ts` (a `globalSetup` file that parses `.dev.vars`).
- `@supabase/supabase-js` is already a direct dependency (not dev-only). Integration tests can import `createClient` without adding a new package.
- `describe.skipIf` is the right vitest API for conditionally skipping an entire suite based on a boolean.

## What We're NOT Doing

- **Testing the HTTP endpoint via `SELF.fetch()`** — requires a built worker artifact. The cascade behavior is a DB-level concern; a direct Supabase client test is the cheapest real signal and does not need the Astro handler.
- **Testing the `createAdminClient()` factory** from `@/lib/supabase.ts` — that function imports `astro:env/server`, which is a virtual Astro module. Bypassing it and constructing the client directly is cleaner for a DB-level cascade test.
- **Mocking Supabase** in Phases 1 and 2 of this plan — all new tests hit the real database. Hermetic mocks belong in the existing Phase 1/2 test files.
- **Wiring a dedicated Supabase test project** — using the dev project with a `vi.skipIf` guard. CI credential wiring is out of scope; the cookbook documents how to add the secret when ready.
- **Changing `ci.yml`** — `npm test` is already present at line 21.
- **Fixing the 200 silent no-op** for cross-user writes (documented Known Gap in `test-plan.md §6.2`) — out of scope for Phase 3.

## Critical Implementation Details

**Node.js pool for integration tests**: `import { env } from "cloudflare:test"` fails in this project (confirmed: the workerd pool cannot resolve `@astrojs/cloudflare/entrypoints/server` without a production build). Integration tests run in the Node.js vitest pool via `vitest.integration.config.ts`. A `globalSetup` file (`tests/integration/setup.ts`) parses `.dev.vars` at startup and writes each key into `process.env`. Inside integration tests, credentials are accessed via `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, and `process.env.SUPABASE_KEY`. The `describe.skipIf` guard uses `!process.env.SUPABASE_SERVICE_ROLE_KEY`. In CI where `.dev.vars` does not exist, `setup.ts` is a no-op and all integration tests skip gracefully.

**Plan insert must satisfy all NOT NULL columns**: `id` and `created_at` are auto-generated. Insert requires: `user_id` (test user UUID), `name` (any string), `goal` (`"speed"` or `"distance"`), `ride_stats` (any string), `plan` (a `TrainingPlan` JSON — `weeks` must be a non-empty array, each entry must have `week: number`, `focus: string`, `days: TrainingDay[]`). See `src/types/database.ts:1–22` for the shape.

**RLS requires an authenticated session, not just the anon key**: To test cross-user read isolation, User B must sign in and the resulting access token must be passed as an `Authorization: Bearer <token>` header to a new `createClient` instance. A bare anon-key client has `auth.uid() = null`, which also blocks reads — but for the wrong reason (unauthenticated, not wrong user). The test must establish a real session as User B before querying User A's plan.

**afterAll cleanup ordering**: The R6 test deletes the test user as its main act. `afterAll` should call `deleteUser` wrapped in `.catch(() => {})` to handle the case where the test already deleted the user. Phase 2 cleanup must delete both User A and User B.

---

## Phase 1: R6 Cascade Integration Test

### Overview

Create the Node.js pool integration test infrastructure (`setup.ts`, `vitest.integration.config.ts`, `vitest.config.ts` exclude, `package.json` script update) and then create `tests/integration/account-lifecycle.r6.test.ts`. The test uses `process.env` credentials (populated by the setup file from `.dev.vars`): creates a test user and plan in `beforeAll`, deletes the user in the test (the cascade act), asserts 0 plan rows remain, asserts re-login is rejected. `afterAll` provides cleanup insurance.

### Changes Required

#### 1. New directory

**File**: `tests/integration/` (create)

**Intent**: Separate real-DB integration tests from hermetic library/api tests. The `integration/` directory signals to contributors that these tests require live credentials and will skip in CI without them.

#### 2. `tests/integration/setup.ts` — globalSetup

**File**: `tests/integration/setup.ts` (create)

**Intent**: Parse `.dev.vars` at test startup and write each key into `process.env` so integration tests can access real Supabase credentials. Must handle missing file gracefully (CI environment has no `.dev.vars`).

**Contract**:
- Export a default `setup` function (vitest `globalSetup` API).
- Read `.dev.vars` from the project root using `readFileSync`. If the file doesn't exist, return without error.
- Parse lines as `KEY=VALUE` pairs: skip blank lines and lines starting with `#`; find the first `=`; trim both sides; strip surrounding single or double quotes from values.
- Skip any key that is already in `process.env` (environment variable precedence: system env wins over `.dev.vars`).
- No external dependencies — Node.js `fs` and `path` builtins only.

#### 3. `vitest.integration.config.ts` — Node.js pool config

**File**: `vitest.integration.config.ts` (create)

**Intent**: Run integration tests in the Node.js vitest pool (not the workerd pool), with the `@` alias resolved and the globalSetup file loaded.

**Contract**:
- `defineConfig` from `"vitest/config"` (no cloudflare plugin).
- `test.include: ["tests/integration/**/*.test.ts"]` — scoped to integration folder only.
- `test.globalSetup: ["./tests/integration/setup.ts"]` — loads `.dev.vars` before tests.
- `resolve.alias: { "@": path.resolve("./src") }` — same alias as `vitest.config.ts`.
- No `environment` override needed (defaults to `"node"`).

#### 4. `vitest.config.ts` — add integration exclude

**File**: `vitest.config.ts` (modify)

**Intent**: Prevent the workerd pool from picking up `tests/integration/` files. Without this exclude, `vitest run` fails because the workerd pool tries to load `@astrojs/cloudflare/entrypoints/server` when `cloudflare:test` is imported.

**Contract**:
- Add `test: { exclude: ["tests/integration/**", ...defaultExclude] }` to the config. Import `defaultExclude` from `"vitest/config"`.

#### 5. `package.json` — update test script

**File**: `package.json` (modify)

**Intent**: `npm test` must exercise both the workerd hermetic tests and the Node.js integration tests.

**Contract**:
- Change `"test": "vitest run"` to `"test": "vitest run && vitest run --config vitest.integration.config.ts"`.

#### 6. R6 cascade test file

**File**: `tests/integration/account-lifecycle.r6.test.ts` (rewrite)

**Intent**: Prove end-to-end that `auth.admin.deleteUser` triggers the `ON DELETE CASCADE` on the `plans` table, and that the deleted user cannot re-authenticate.

**Contract**:

- No `/// <reference types="@cloudflare/vitest-pool-workers" />` header. No `cloudflare:test` import.
- Import `createClient` from `"@supabase/supabase-js"`. Read credentials from `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, `process.env.SUPABASE_KEY`. Do not import from `"@/lib/supabase"` or mock `astro:env/server`.
- Wrap the entire `describe` block with `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)`.
- `adminClient`: constructed with service role key (bypasses RLS, can call `auth.admin.*`).
- `anonClient`: constructed with anon key, `auth: { persistSession: false }` (for re-login test).
- `beforeAll`: create a test user with `auth.admin.createUser({ email: unique-per-run address, password, email_confirm: true })`. Store `testUserId` and `testEmail`. Insert one plan row for that user with all required fields (see Critical Implementation Details).
- `afterAll`: call `adminClient.auth.admin.deleteUser(testUserId).catch(() => {})` — tolerates the case where the test already deleted the user.
- Test "deletes all plan rows when auth.users row is deleted": call `adminClient.auth.admin.deleteUser(testUserId)`; assert `error` is null; then select from `plans` where `user_id = testUserId`; assert `data` has length 0.
- Test "rejects sign-in after deletion": call `anonClient.auth.signInWithPassword({ email: testEmail, password })` after the user is deleted; assert `data.user` is null and `error` is non-null.
- `describe` label: `"R6 — account deletion cascade"`. `it` labels: observable outcomes, not mechanisms.

### Success Criteria

#### Automated Verification

- `npm test` exits 0; the R6 describe block shows as skipped (CI, no `.dev.vars`) or passed (local, `.dev.vars` present).
- When credentials are present locally: both R6 `it` blocks pass.
- When credentials are absent: `describe.skipIf` skips the entire suite — no test failures.

#### Manual Verification

- Run `npm test` locally with `.dev.vars` populated. Confirm the R6 suite runs (not skipped) and both tests pass.
- Check the dev Supabase dashboard: the test user email is absent after the run (cascade + afterAll cleaned up).

**Implementation Note**: After completing Phase 1 and verifying manually, pause for confirmation before proceeding.

---

## Phase 2: SSR RLS Verification (R2 Closure)

### Overview

Create `tests/integration/plans-read-rls.r2.test.ts`. Verify that the `plans_select_own` RLS policy blocks User B from reading User A's plan via the same query the SSR route uses. Test at the DB layer (not via HTTP) using a real User B session token.

### Changes Required

#### 1. SSR RLS test file

**File**: `tests/integration/plans-read-rls.r2.test.ts`

**Intent**: Prove that the `plans` RLS policy `plans_select_own` (`auth.uid() = user_id`) prevents cross-user reads at the database layer — independently of any app-layer check.

**Contract**:

- Same `process.env` credential pattern as Phase 1. No `cloudflare:test` import. Same `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` guard.
- `adminClient`: service role, for user and plan creation.
- `beforeAll`:
  - Create User A (admin client). Insert one plan for User A. Store `planAId`.
  - Create User B (admin client). Sign in as User B via `anonClient.auth.signInWithPassword(...)` to get a session. Build `userBClient` by calling `createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: \`Bearer \${session.access_token}\` } } })`. This is the RLS-enforced client authenticated as User B.
- `afterAll`: delete User A and User B via admin client (cascade removes User A's plan).
- Test "User B cannot read User A's plan": call `userBClient.from("plans").select("id").eq("id", planAId)` — do NOT use `.single()` (it throws on 0 rows); use plain `.select()`. Assert `data` has length 0. Assert `error` is null (RLS returns empty, not an error code).
- `describe` label: `"R2 SSR — cross-user plan read blocked by RLS"`.

### Success Criteria

#### Automated Verification

- `npm test` exits 0; R2 SSR suite shows skipped (no credentials) or passed (credentials present).
- When credentials are present: the cross-user read returns `data = []` and `error = null`.

#### Manual Verification

- Run `npm test` locally. Confirm both the R6 and R2 SSR suites run and pass.
- Confirm no orphaned test users remain in the dev project after the run.

**Implementation Note**: Pause after Phase 2 for manual confirmation before proceeding.

---

## Phase 3: Pre-Commit Gate

### Overview

Update `.husky/pre-commit` so that committing TypeScript, TSX, or Astro files triggers the full test suite before lint-staged runs. Commits that change only JSON/CSS/Markdown bypass the test gate. No change to `lint-staged` config.

### Changes Required

#### 1. Pre-commit hook update

**File**: `.husky/pre-commit`

**Intent**: Run `npm test` when staged files include `.ts`, `.tsx`, or `.astro` content — catching test regressions at commit time before they reach CI. Lint-staged still runs after, unconditionally.

**Contract**:

Prepend the following to the existing `npx lint-staged` line. The full file after the change:

```sh
#!/usr/bin/env sh

staged=$(git diff --cached --name-only)
if echo "$staged" | grep -qE '\.(ts|tsx|astro)$'; then
  npm test
fi

npx lint-staged
```

The `grep -qE` exits 0 (triggering the test run) when at least one staged file has a `.ts`, `.tsx`, or `.astro` extension. The `npm test` command is `vitest run` — exits 0 on all-pass, non-zero on any failure.

### Success Criteria

#### Automated Verification

- `npm test` continues to pass (no regression from hook content).

#### Manual Verification

- Stage a `.ts` file with a deliberate syntax error and attempt `git commit`. The pre-commit hook should run `npm test`, fail, and block the commit.
- Stage only a `.md` change. Confirm `npm test` does NOT run and the commit completes normally.

**Implementation Note**: Pause after Phase 3 for manual confirmation before proceeding.

---

## Phase 4: Cookbook + Plan Sync

### Overview

Fill in `context/foundation/test-plan.md §6.3` with the integration test patterns established in Phases 1 and 2. Update §3 Phase 3 status to `complete`.

### Changes Required

#### 1. Fill in test-plan.md §6.3 — account deletion cascade pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD — see §3 Phase 3" placeholder for account deletion cascade with the pattern actually implemented. Future contributors writing real-DB integration tests should start here.

**Contract**: Replace the placeholder under `#### Account deletion cascade (TBD — see §3 Phase 3)` with documentation covering:
- File location: `tests/integration/`
- Env var access pattern: `process.env.SUPABASE_URL` / `process.env.SUPABASE_SERVICE_ROLE_KEY` / `process.env.SUPABASE_KEY`, populated at startup by `tests/integration/setup.ts` (globalSetup parses `.dev.vars`). Do NOT use `import { env } from "cloudflare:test"` — fails without a production build artifact.
- `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` guard — required for all integration tests.
- Integration tests run via `vitest.integration.config.ts` (Node.js pool, not workerd). The main `vitest.config.ts` excludes `tests/integration/**`.
- Admin client pattern (service role, bypasses RLS).
- User B client pattern (anon key + `Authorization: Bearer <access_token>` header).
- Test data cleanup: `afterAll` with `.catch(() => {})` on admin delete calls.
- Reference tests: `tests/integration/account-lifecycle.r6.test.ts`, `tests/integration/plans-read-rls.r2.test.ts`.
- Oracle rule: assert DB state (row count, auth error), not HTTP response codes.

#### 2. Update §3 Phase 3 status and update §8 freshness date

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 3 complete in the orchestrator status table and update the freshness ledger.

**Contract**: In §3, set Phase 3 Status to `complete`. In §8, update "Last updated" to today's date with a note that Phase 3 shipped.

### Success Criteria

#### Automated Verification

- `npm test` passes (no regressions).
- `context/foundation/test-plan.md §3` Phase 3 row shows `complete`.

#### Manual Verification

- Open the cookbook §6.3 and verify a new contributor can understand how to write a real-DB integration test from that section alone.

---

## References

- Research: `context/changes/testing-account-lifecycle/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 R2/R6, §3 Phase 3, §6.3 cookbook)
- Cascade migration: `supabase/migrations/20260528000000_create_plans_table.sql:3`
- Deletion endpoint: `src/pages/api/auth/delete-account.ts:22`
- SSR read route: `src/pages/plans/[id].astro:13`
- Plan type reference: `src/types/database.ts:1–34`
- Pre-commit hook: `.husky/pre-commit`
- Prior phase reference tests: `tests/lib/middleware.r3.test.ts`, `tests/api/plans-id.r2.test.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: R6 Cascade Integration Test

#### Automated

- [x] 1.1 `vitest.config.ts` excludes `tests/integration/**`; existing 20 workerd tests pass (`vitest run`) — 7606fd3
- [x] 1.2 `tests/integration/setup.ts` and `vitest.integration.config.ts` created; `vitest run --config vitest.integration.config.ts` exits 0 — 7606fd3
- [x] 1.3 `package.json` test script updated; `npm test` runs both configs and exits 0 — 7606fd3
- [x] 1.4 `account-lifecycle.r6.test.ts` rewritten to use `process.env`; suite shows skipped (no credentials) or passed (credentials present) — 7606fd3

#### Manual

- [x] 1.5 Run `npm test` locally with `.dev.vars` populated; both R6 `it` blocks pass — 7606fd3
- [x] 1.6 Confirm no orphaned test user remains in dev Supabase dashboard after the run — 7606fd3

### Phase 2: SSR RLS Verification

#### Automated

- [x] 2.1 `npm test` exits 0; R2 SSR suite shows skipped (no credentials) or passed (credentials present) — 2778667

#### Manual

- [x] 2.2 Run `npm test` locally; cross-user read returns empty data and no error — 2778667
- [x] 2.3 Confirm no orphaned test users or plans remain in dev project after the run — 2778667

### Phase 3: Pre-Commit Gate

#### Automated

- [x] 3.1 `npm test` passes (no regression from hook change) — ed9d032

#### Manual

- [x] 3.2 Stage a `.ts` file with a failing test; confirm `git commit` is blocked — ed9d032
- [x] 3.3 Stage only a `.md` change; confirm `npm test` does not run and commit succeeds — ed9d032

### Phase 4: Cookbook + Plan Sync

#### Automated

- [x] 4.1 `npm test` passes — 7a7a8e0
- [x] 4.2 `test-plan.md §3` Phase 3 row shows `complete` — 7a7a8e0

#### Manual

- [x] 4.3 §6.3 cookbook documents the integration test pattern completely enough for a new contributor — 7a7a8e0
