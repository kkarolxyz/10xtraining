---
date: 2026-06-16T00:00:00+00:00
researcher: Claude Sonnet 4.6
git_commit: 63c1b96002d0129dd8afb93fcb6688cf6897fd5d
branch: master
repository: kkarolxyz/10xtraining
topic: "Testing account lifecycle — Phase 3: account deletion cascade + quality gates"
tags: [research, testing, supabase, account-lifecycle, cascade, quality-gates, ci, pre-commit]
status: complete
last_updated: 2026-06-16
last_updated_by: Claude Sonnet 4.6
---

# Research: Testing Account Lifecycle (Phase 3)

**Date**: 2026-06-16  
**Researcher**: Claude Sonnet 4.6  
**Git Commit**: 63c1b96002d0129dd8afb93fcb6688cf6897fd5d  
**Branch**: master  
**Repository**: kkarolxyz/10xtraining

---

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md`:

- **R6**: Account deletion cascade — prove that after an account is deleted, all plan rows for that user are gone.
- **R5**: Latency / loading feedback — a smoke test against staging, not an automated test.
- **CI gate**: `npm test` before the build step.
- **Pre-commit gate**: add a test step to the Husky hook.

---

## Summary

| Finding | Verdict |
|---|---|
| CASCADE FK on `plans.user_id` | Confirmed — `ON DELETE CASCADE` present in migration |
| Deletion mechanism | Only `auth.admin.deleteUser(userId)` — no manual plan cleanup |
| Service role key required | Yes — `SUPABASE_SERVICE_ROLE_KEY` in `.dev.vars` |
| CI test step | **Already wired** — `npm test` at `ci.yml:21`, between lint and build |
| Pre-commit gap | Confirmed — `.husky/pre-commit` runs only `npx lint-staged`, no test gate |
| Real Supabase integration tests | None yet — all existing tests are hermetic |
| Env var strategy in workerd | **Critical open question** — secrets in `.dev.vars` are available via `import { env } from "cloudflare:test"`, not `process.env` |
| SSR IDOR deferred from Phase 2 | Confirmed in scope — `src/pages/plans/[id].astro` relies on RLS; hermetic mock cannot verify it; same real-Supabase session as R6 |

**Bottom line**: The hardest design decision for Phase 3 is how to pass real Supabase credentials into the workerd test runtime. Everything else (cascade FK, deletion flow, CI wiring) is already confirmed by prior work. The pre-commit gate is a one-liner change. The SSR RLS test is confirmed deferred scope that belongs alongside R6 in this phase.

---

## Detailed Findings

### R6: Account Deletion Cascade

#### Deletion endpoint (`src/pages/api/auth/delete-account.ts`)

The endpoint is a `DELETE` handler at `/api/auth/delete-account`. Its step-by-step flow:

1. **Auth guard** (`delete-account.ts:5–10`) — returns 401 if `context.locals.user` is absent.
2. **Capture user ID** (`delete-account.ts:12`) — `userId = context.locals.user.id`.
3. **Admin client** (`delete-account.ts:14`) — calls `createAdminClient()` from `@/lib/supabase`.
4. **Null guard** (`delete-account.ts:15–19`) — returns 500 `{ error: "Service unavailable" }` if the admin client could not be created (missing `SUPABASE_SERVICE_ROLE_KEY`).
5. **Delete user** (`delete-account.ts:22`) — `adminClient.auth.admin.deleteUser(userId)`. This is the **only** data-deletion call. No `DELETE FROM plans` exists anywhere in this endpoint.
6. **Error guard** (`delete-account.ts:23–29`) — returns 500 on `deleteUser` error.
7. **Sign out** (`delete-account.ts:32–39`) — best-effort `supabase.auth.signOut()`, wrapped in try/catch that swallows errors.
8. **Success** (`delete-account.ts:41–44`) — returns 200 `{ success: true }`.

**Oracle implication**: The endpoint returns 200 even if `signOut` fails. The test must NOT rely on the response body alone — it must query the `plans` table to verify cascade fired.

#### CASCADE constraint (`supabase/migrations/20260528000000_create_plans_table.sql`)

```sql
user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
```

This is the sole mechanism for plan cleanup. When `auth.admin.deleteUser` removes the `auth.users` row, Postgres automatically deletes every `plans` row where `user_id` matches. There is no application-level ordering concern.

**Must challenge**: The test plan's R6 response guidance says "must challenge: deleting auth.users cascades plan rows automatically." The integration test must **prove** this fires end-to-end, not assume it. A test that only calls `deleteUser` and checks the API response would miss the anti-pattern.

#### Supabase client factories (`src/lib/supabase.ts`)

Two exported factories:

| Factory | Key used | RLS | Purpose |
|---|---|---|---|
| `createAdminClient()` (`supabase.ts:6–11`) | `SUPABASE_SERVICE_ROLE_KEY` | Bypassed | Admin-level ops: `auth.admin.deleteUser` |
| `createClient(req, cookies)` (`supabase.ts:13–32`) | `SUPABASE_KEY` (anon) | Enforced | All other routes and middleware |

Both import from `astro:env/server` (`supabase.ts:4`), which is an Astro virtual module not available in the test environment without mocking.

**Key architectural constraint**: The test cannot call `createAdminClient()` directly. It must either:
- Mock `astro:env/server` to return real values, or
- Construct the admin client directly via `createClient` from `@supabase/supabase-js`.

---

### Env Var Strategy in the Workerd Test Runtime

This is the most critical unresolved question for Phase 3.

#### How the test environment loads secrets

The vitest pool is configured in `vitest.config.ts:7–9`:

```typescript
cloudflareTest({
  wrangler: { configPath: "./wrangler.jsonc" },
})
```

The `wrangler.jsonc` has **no `vars` section** — secrets are not declared there. In Cloudflare Workers development, secrets live in `.dev.vars`. The `@cloudflare/vitest-pool-workers` plugin reads `.dev.vars` and injects those values as Worker bindings into the workerd runtime.

In workerd, bindings are accessed via `import { env } from "cloudflare:test"` — **not** via `process.env`. This is the access path for `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in tests.

#### Pattern used by existing tests

All current tests mock `astro:env/server` with hardcoded values:

```typescript
// middleware.r3.test.ts:16–22
vi.mock("astro:env/server", () => ({
  get SUPABASE_URL() { return "http://127.0.0.1:54321"; },
  get SUPABASE_KEY() { return "test-anon-key"; },
}));
```

These are fake values — fine for hermetic tests, wrong for a real-DB integration test.

#### Options for the real integration test

**Option A — Mock `astro:env/server` with values sourced from `cloudflare:test` env**

```typescript
import { env } from "cloudflare:test";

vi.mock("astro:env/server", () => ({
  get SUPABASE_URL() { return (env as Env).SUPABASE_URL; },
  get SUPABASE_SERVICE_ROLE_KEY() { return (env as Env).SUPABASE_SERVICE_ROLE_KEY; },
}));
```

Then call `createAdminClient()` from `@/lib/supabase` — it will pick up real values. This keeps the test aligned with the production code path but relies on `.dev.vars` being present.

**Option B — Construct client directly in the test**

```typescript
import { env } from "cloudflare:test";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  (env as Env).SUPABASE_URL,
  (env as Env).SUPABASE_SERVICE_ROLE_KEY,
);
```

Bypasses `astro:env/server` and `@/lib/supabase` entirely. Tests the cascade behavior at the DB level, not the endpoint's code path. **Recommended for R6** because it cleanly separates "does the DB cascade?" from "does the endpoint handle errors?".

**Option C — Separate vitest config for integration tests (Node.js pool)**

Create a `vitest.integration.config.ts` that uses the default Node.js pool (not workerd). Integration tests run with `vitest run --config vitest.integration.config.ts`. Can use `process.env` directly.

Tradeoff: two test configs to maintain; `npm test` might not run both.

**Plan must decide which option to use.** Option B is recommended because it is the cheapest path that gives a real signal: it bypasses the astro virtual module entirely and directly exercises the Supabase cascade behavior that R6 requires to be verified.

#### CI implications

For CI to run this test, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be available in the workerd environment. This requires one of:

- **A dedicated Supabase test project** with its credentials stored as GitHub secrets (separate from the production project). This is the safe option for CI.
- **Conditional skip**: The test skips if env vars are absent (guard: `if (!env.SUPABASE_SERVICE_ROLE_KEY) return`). This makes the gate advisory rather than required in CI.
- **Local Supabase in CI**: `supabase start` in the CI workflow, then run tests. Requires Docker in CI runner — possible on GitHub Actions standard runners.

**Current state**: `.env` / `.dev.vars` hold credentials for the real dev project (`dossusbexlaxxcnijedv`). No test-specific Supabase project exists. Phase 3 must decide this before writing the test.

---

### SSR IDOR Deferred from Phase 2

`src/pages/plans/[id].astro` (line 13) queries plans by ID with **no app-layer `user_id` filter**. Isolation relies entirely on RLS. The Phase 2 hermetic tests could not verify RLS enforcement — it was explicitly deferred.

This is in scope for Phase 3 because:
1. It requires the same real Supabase test client as R6.
2. It is already noted in `test-plan.md §6.3` as "deferred to Phase 3."
3. The test session needed for R6 (create user A, create plan, delete user) can be extended to verify that User B cannot read User A's plan via the SSR query pattern.

**What the test must prove**: Create User A's plan. Attempt to read it with User B's RLS-enforced anon-key client. Assert that the query returns 0 rows (RLS blocks cross-user reads).

**Note**: This is R2 scope that landed in Phase 3, not R6. It should be reflected in Phase 3's "Risks covered" column in `test-plan.md §3` (currently shows "R5 (smoke), R6" only). This is a **backport recommendation** — the plan phase can surface this to `/10x-test-plan` for §3 correction, or it can be added to this phase's plan directly.

---

### CI Gate — Already Wired

`.github/workflows/ci.yml:21` already runs `npm test` between `npm run lint` (line 20) and `npm run build` (line 22). No CI changes are needed for this gate.

Full CI step order:
1. Checkout
2. Setup Node 22
3. `npm ci`
4. `npx astro sync`
5. `npm run lint`
6. **`npm test`** ← already present
7. `npm run build`
8. Upload artifacts

---

### Pre-Commit Gate — Gap Confirmed

`.husky/pre-commit` contains a single line:

```sh
npx lint-staged
```

`lint-staged` (configured at `package.json:65–72`) runs:
- `eslint --fix` on `*.{ts,tsx,astro}`
- `prettier --write` on `*.{json,css,md}`

No test step exists. The gap: a developer can commit code that breaks tests as long as linting passes.

**Fix**: Add `npm test` before `npx lint-staged`. The pre-commit hook should fail fast — tests before lint means a test failure exits immediately without wasting time on formatting.

Tradeoff to evaluate in the plan: running the full test suite (`vitest run`) on every commit adds ~5–10 seconds. If that becomes disruptive, scope it to only run when test files change (via lint-staged pattern `tests/**/*.test.ts`). The simplest version (full suite always) is recommended as the starting point.

---

### Existing Test Infrastructure (Phases 1 and 2)

| Item | Detail |
|---|---|
| Test runner | `vitest run` (`package.json:13`) |
| Vitest version | 4.1.9 (`package.json:59`) |
| Pool | `@cloudflare/vitest-pool-workers` 0.16.15 (`package.json:40`) |
| Path alias | `@` → `./src` (`vitest.config.ts:12–14`) |
| Test files | 5: `tests/smoke/basic.test.ts`, `tests/lib/openrouter.r1.test.ts`, `tests/lib/openrouter.r4.test.ts`, `tests/api/plans-id.r2.test.ts`, `tests/lib/middleware.r3.test.ts` |
| Real Supabase tests | **None** — all tests use hermetic mocks |

The `vi.hoisted` + `vi.mock("astro:env/server")` pattern is the established convention for all tests needing env var control. Phase 3 will extend this for the real-credentials path.

---

## Code References

| File | Lines | What's there |
|---|---|---|
| `src/pages/api/auth/delete-account.ts` | 5–44 | Full deletion endpoint; `auth.admin.deleteUser` at line 22 |
| `src/lib/supabase.ts` | 4 | `SUPABASE_SERVICE_ROLE_KEY` import from `astro:env/server` |
| `src/lib/supabase.ts` | 6–11 | `createAdminClient()` — service-role factory |
| `src/lib/supabase.ts` | 13–32 | `createClient()` — anon SSR factory |
| `supabase/migrations/20260528000000_create_plans_table.sql` | 3 | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `src/pages/plans/[id].astro` | 13 | SSR plan read — no app-layer `user_id` filter; relies on RLS |
| `.github/workflows/ci.yml` | 21 | `npm test` — already wired, between lint and build |
| `.husky/pre-commit` | 1 | `npx lint-staged` — only line; test gate missing |
| `package.json` | 65–72 | lint-staged config (no test pattern) |
| `vitest.config.ts` | 7–9 | `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })` |
| `wrangler.jsonc` | full | No `vars` section — secrets in `.dev.vars` only |
| `tests/lib/middleware.r3.test.ts` | 16–23 | Reference pattern for mocking `astro:env/server` |
| `tests/api/plans-id.r2.test.ts` | 10–31 | Chainable Supabase mock with `.eq()` spy |

---

## Architecture Insights

1. **Cascade is structural, not behavioral**: The plan cleanup on account deletion is a DB-level guarantee (`ON DELETE CASCADE`), not application code. The test must verify it fires end-to-end — not just that the API returns 200.

2. **`createAdminClient()` is the only admin surface**: It's used in exactly one place (`delete-account.ts:14`). No other file calls it. This makes it a clean seam for both the integration test and the null-guard test.

3. **Workerd has no `process.env`**: All secrets must come through the Cloudflare binding system (`.dev.vars` → workerd `env` object via `cloudflare:test`). Any integration test that uses real Supabase credentials must account for this — `process.env.SUPABASE_URL` will be `undefined`.

4. **SSR routes are outside the API test scope**: `src/pages/plans/[id].astro` is a server-rendered Astro page, not an API handler. Testing its RLS behavior requires querying the DB directly — there is no simple `SELF.fetch()` pattern for SSR pages in the workerd pool. The plan phase must decide whether to test via the Supabase client directly (DB query) or via an HTTP integration test.

5. **CI is ahead of pre-commit**: Tests run in CI but not on commit. This means a broken test can reach `master` as long as the developer doesn't run `npm test` locally. The pre-commit gate closes this window.

---

## Historical Context

- `context/changes/delete-account/plan.md:9` — confirms CASCADE migration exists; no new migration needed for Phase 3.
- `context/changes/delete-account/plan-brief.md:23` — records decision to use service-role key + `createAdminClient()` (idiomatic Supabase pattern).
- `context/changes/delete-account/plan-brief.md:65–66` — notes that `supabase start` exposes the service_role key locally at `http://localhost:54323` — potential local test infrastructure path.
- `context/changes/testing-data-isolation-auth-boundary/research.md:88–92` — explicitly defers SSR IDOR (RLS verification) to Phase 3 with real Supabase.
- `context/changes/testing-data-isolation-auth-boundary/plan.md:20` — "Not yet tested: SSR plan read (`src/pages/plans/[id].astro:13`) — deferred to Phase 3."
- `context/changes/testing-bootstrap-plan-generation/research.md:124–128` — noted R6 CASCADE FK in Phase 1 research as "relevant to R6, not Phase 1."

---

## Open Questions

### OQ1 — Supabase test environment: local vs. remote

**Options:**
- **Local** (`supabase start`): isolated, free, requires Docker in CI
- **Remote test project**: separate Supabase project with its own credentials; no Docker; costs money; needs GitHub secret
- **Same dev project**: simple to start, risky (shared data, cannot reset schema in CI)

**Recommendation for the plan phase**: Start with the dev project credentials gated by a `vi.skipIf` guard, so CI skips the test if `SUPABASE_SERVICE_ROLE_KEY` is not set. Document the local Supabase path for the cookbook. The CI gate for R6 can be wired properly once a test project is provisioned.

### OQ2 — Env var access pattern in the integration test

Which option (A, B, or C from the Env Var Strategy section above) does the plan adopt? **Option B (direct `createClient` from `cloudflare:test` env)** is recommended as the lowest-coupling approach for proving cascade behavior.

### OQ3 — SSR RLS scope: add to Phase 3 or defer?

The SSR plan-read IDOR test is a real Supabase test deferred from Phase 2. It belongs in Phase 3 because Phase 3 opens the real Supabase session. Adding it to Phase 3 means updating `test-plan.md §3` Phase 3 "Risks covered" to include R2 (SSR RLS). This backport recommendation should be surfaced to `/10x-test-plan` before or during planning.

### OQ4 — Pre-commit: full suite or scoped?

Should `.husky/pre-commit` run `npm test` unconditionally (full suite, ~5–10s) or only when test/source files change? The simplest starting point is unconditional. The plan can add a lint-staged pattern if performance becomes a concern.

### OQ5 — SSR route test mechanism

How to verify that `src/pages/plans/[id].astro` enforces RLS? Options:
- Query the DB directly with a user-B client and assert 0 rows (tests RLS at the Supabase layer, not the Astro route).
- Use `SELF.fetch()` with a session cookie for user B (tests the full SSR path, but constructing a valid session cookie in tests is non-trivial).

**Recommendation**: Query the DB directly. The Astro page is a thin wrapper over the Supabase query; the RLS policy is the actual safeguard being tested. A DB-level assertion is the cheapest real signal.
