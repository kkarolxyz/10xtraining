# Data Isolation and Auth Boundary Tests — Plan Brief

> Full plan: `context/changes/testing-data-isolation-auth-boundary/plan.md`
> Research: `context/changes/testing-data-isolation-auth-boundary/research.md`

## What & Why

Phase 2 of the test rollout adds tests for R2 (IDOR — User A must not be able to modify or delete User B's plans) and R3 (auth boundary — stale or missing sessions must redirect to login, not produce a 500). It also patches a real production gap discovered during research: `middleware.ts` has no `try/catch` around `supabase.auth.getUser()`, so a network failure during auth validation surfaces as an unhandled 500 rather than a login redirect.

## Starting Point

Vitest + `@cloudflare/vitest-pool-workers` is fully configured from Phase 1. The `vi.hoisted` + `vi.mock` patterns are established in `tests/lib/openrouter.r1.test.ts`. The plan API handlers already contain the correct app-layer ownership filter (`.eq("user_id", ...)`) at `src/pages/api/plans/[id].ts:37,61` — Phase 2 tests protect that filter, not add it.

## Desired End State

`npm test` covers both risk surfaces. Any commit that removes `.eq("user_id", context.locals.user.id)` from either plan handler makes two tests red. The middleware correctly redirects on missing session, expired token, and `getUser()` throw — all proven by tests. The cookbook §6.2 documents the auth boundary pattern so future auth tests follow the same shape.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Test layer | Direct function imports (no SELF.fetch()) | `wrangler.jsonc` points to a package path — SELF.fetch() requires a production build | Research |
| getUser() throw path | Fix it + test the fix | The change is 3 lines and the test is the regression guard | Plan |
| Silent 200 on cross-user write | Document gap, 200 is the oracle | Correctness issue but not a security issue; fixing response codes is out of scope | Plan |
| SSR plan read IDOR | Defer to Phase 3 | Hermetic test can only verify null-result handling, not that RLS actually enforces ownership | Research |
| Supabase chain mock | Thenable chain object with eq spy | Fluent builder requires each method to return `this`; the chain itself must be awaitable | Plan |

## Scope

**In scope:**
- `tests/api/plans-id.r2.test.ts` — ownership filter + unauthenticated 401 for plan update/delete handlers
- `tests/lib/middleware.r3.test.ts` — middleware redirect behavior + `generate.ts` self-auth 401
- `src/middleware.ts` — 3-line try/catch fix for `getUser()` network failure
- `context/foundation/test-plan.md §6.2, §6.3, §3` — cookbook + status update

**Out of scope:**
- SELF.fetch() HTTP-level tests
- SSR plan read test (`/plans/[id].astro`) — deferred to Phase 3
- Fixing the misleading 200 on cross-user write
- RLS policy testing
- Stryker mutation testing

## Architecture / Approach

Two new test files, one production patch. Phase 1 tests the plan API handlers by importing `POST` and `DELETE` directly, constructing a minimal mock context (`locals.user`, `params`, `request`), and mocking `@/lib/supabase` with a chainable query builder that records `.eq()` calls. Phase 2 patches `middleware.ts`, then tests `onRequest` directly with a mocked Supabase client and a context that has a `redirect` spy. All tests run in the existing workerd pool — no new test infrastructure.

The trickiest detail: the Supabase query builder is a fluent chain where every method returns `this` and the entire chain is awaitable. The mock uses `vi.fn().mockReturnThis()` for builder methods and a `then` property to make the chain thenable, resolving to `{ error: null }`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. R2 ownership filter tests | `plans-id.r2.test.ts`: DELETE + POST ownership filter + 401 | Supabase chain mock complexity — must be thenable |
| 2. R3 middleware fix + tests | `middleware.ts` try/catch patch + `middleware.r3.test.ts` | Must test redirect (not throw) for the getUser() throw case |
| 3. Cookbook sync | §6.2 auth boundary pattern, §3 Phase 2 complete | None — editorial only |

**Prerequisites:** Phase 1 (vitest + workerd pool) complete. ✓
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- The chainable Supabase chain mock's `then` property must not use `mockReturnThis()` — it must actually resolve. Getting the thenable protocol wrong causes all Supabase-dependent tests to hang.
- `astro:middleware` must be mocked for the workerd pool (`vi.mock("astro:middleware", () => ({ defineMiddleware: (fn) => fn }))`) — failure to do so causes an import error when loading `src/middleware.ts` in tests.

## Success Criteria (Summary)

- `npm test` is green with 10+ new test cases covering R2 and R3.
- A deliberate removal of `.eq("user_id", ...)` from either plan handler makes tests fail immediately.
- The middleware correctly redirects on auth failure — including `getUser()` throw — confirmed by a failing test before the fix and a passing test after.
