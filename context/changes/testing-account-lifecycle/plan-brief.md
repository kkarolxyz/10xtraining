# Account Lifecycle Tests — Plan Brief

> Full plan: `context/changes/testing-account-lifecycle/plan.md`
> Research: `context/changes/testing-account-lifecycle/research.md`

## What & Why

Phase 3 of the test rollout adds the first real-database integration tests to the project. Two risks require a live Supabase connection — R6 (account deletion cascade) and R2 SSR (cross-user plan read blocked by RLS) — because hermetic mocks cannot verify PostgreSQL CASCADE behaviour or RLS policy enforcement. Phase 3 also gates commits with a scoped pre-commit test run.

## Starting Point

Vitest + `@cloudflare/vitest-pool-workers` is installed from Phase 1; five hermetic tests exist (R1, R2 API, R3, R4). The deletion endpoint (`src/pages/api/auth/delete-account.ts`) calls only `auth.admin.deleteUser` — plan cleanup is delegated entirely to `ON DELETE CASCADE` on the `plans` table. The SSR plan-read route (`src/pages/plans/[id].astro:13`) has no app-layer ownership filter; its isolation relies on the `plans_select_own` RLS policy. Neither has been tested end-to-end.

## Desired End State

`npm test` runs four integration test files. The two new real-DB tests prove: (1) deleting an auth user removes all their plan rows; (2) an authenticated User B querying User A's plan gets 0 rows back from Supabase. Both tests skip gracefully in CI until Supabase credentials are wired as secrets. A staged-file check in the pre-commit hook runs the full suite when `.ts`/`.tsx`/`.astro` files are committed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Supabase test environment | Dev project + `vi.skipIf` guard | Zero setup; tests run locally now, CI wired later | Plan |
| SSR RLS scope | Include in Phase 3 | Deferred from Phase 2; same real-DB session needed | Research / Plan |
| Env var access in workerd | Direct `createClient` from `cloudflare:test` env | Cleanest: no Astro virtual module, tests DB layer only | Research / Plan |
| RLS test client | Anon key + `Authorization: Bearer <token>` header | Authenticated session is required for `auth.uid()` to return User B's ID | Plan |
| Pre-commit gate | Scoped to staged `.ts`/`.tsx`/`.astro` files | Avoids running tests on docs/config-only commits | Plan |
| CI gate | No change needed | `npm test` already present at `ci.yml:21` | Research |

## Scope

**In scope:**
- `tests/integration/account-lifecycle.r6.test.ts` — cascade integration test
- `tests/integration/plans-read-rls.r2.test.ts` — SSR RLS integration test
- `.husky/pre-commit` — staged-file gate
- `test-plan.md §6.3` cookbook + `§3` Phase 3 status update

**Out of scope:**
- CI credential wiring (separate Supabase test project provisioning)
- Testing the HTTP endpoint via `SELF.fetch()`
- Using `createAdminClient()` from `@/lib/supabase` in tests (avoids Astro virtual module)
- Fixing the 200 silent no-op for cross-user writes (Known Gap, documented in §6.2)
- Mutation testing (Stryker) for this phase

## Architecture / Approach

Both integration tests import `env` from `"cloudflare:test"` (the workerd binding surface that exposes `.dev.vars` secrets) and construct Supabase clients directly from `@supabase/supabase-js`. No mocking of `astro:env/server`. Each `describe` block is wrapped in `describe.skipIf(!env.SUPABASE_SERVICE_ROLE_KEY)` so the suite degrades gracefully in CI. User data is created in `beforeAll` and destroyed in `afterAll` (with `.catch(() => {})` to tolerate double-delete). The pre-commit hook uses a shell `grep` on `git diff --cached --name-only` to decide whether to run `npm test` before `npx lint-staged`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. R6 cascade test | `account-lifecycle.r6.test.ts` — proves `ON DELETE CASCADE` fires; re-login rejected | Plan insert must satisfy all NOT NULL fields (`src/types/database.ts:1–34`) |
| 2. SSR RLS test | `plans-read-rls.r2.test.ts` — proves User B's session sees 0 rows from User A's plan | User B client must carry a real JWT (not just anon key) for `auth.uid()` to be non-null |
| 3. Pre-commit gate | `.husky/pre-commit` staged-file check | Shell `grep` must correctly detect `.ts`/`.tsx`/`.astro` extensions |
| 4. Cookbook + sync | `test-plan.md §6.3` filled in; §3 Phase 3 → `complete` | None |

**Prerequisites:** `.dev.vars` must contain `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for Phases 1 and 2 to run locally.  
**Estimated effort:** ~1 session across 4 phases.

## Open Risks & Assumptions

- `@cloudflare/vitest-pool-workers` loads `.dev.vars` into the workerd `env` object. If the plugin version (0.16.15) does not expose `.dev.vars` keys via `cloudflare:test`, Option A (mocking `astro:env/server` with real values) is the fallback.
- The SSR query uses `.single()` in production; the test uses `.select("id")` without `.single()` to distinguish "0 rows" from an error. This is intentional — assert `data.length === 0`, not an error code.
- Orphaned test data risk if `beforeAll` succeeds but `afterAll` fails. Mitigated by unique email addresses per run and admin-delete `.catch(() => {})`.

## Success Criteria (Summary)

- `npm test` exits 0 locally with credentials present; both integration suites show 2 passing tests each.
- `npm test` exits 0 in CI without credentials; integration suites show as skipped.
- A commit touching a `.ts` file runs the test suite via the pre-commit hook.
