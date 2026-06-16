# Data Isolation and Auth Boundary Tests — Implementation Plan

## Overview

Phase 2 of the test rollout. Adds integration-style tests (library-level, direct function calls) for R2 (IDOR — plan ownership filter must exist in every API write/delete) and R3 (auth boundary — expired/missing session must redirect to `/auth/signin`, not surface a 500). Phase 2 also patches a real production gap: `middleware.ts` has no `try/catch` around `supabase.auth.getUser()`, so a network failure during auth validation currently produces an unhandled 500 instead of a login redirect.

## Current State Analysis

**Test infrastructure**: Vitest + `@cloudflare/vitest-pool-workers` is in place from Phase 1. The workerd pool runs tests inside the Cloudflare runtime, matching production behavior. The `tests/lib/` directory exists with Phase 1 tests; `tests/api/` does not yet exist.

**Established mock patterns** (from `tests/lib/openrouter.r1.test.ts`):
- `vi.hoisted()` for mutable state shared across mock factories
- `vi.mock("astro:env/server", ...)` for virtual module env vars
- `vi.mock("<module>", ...)` for third-party and internal modules

**R2 — ownership filter exists but is not tested**: Both `POST` (update) and `DELETE` handlers in `src/pages/api/plans/[id].ts` chain `.eq("user_id", context.locals.user.id)` onto every plan-modifying query. This is the correct app-layer ownership check. It is not covered by any test; if a developer removes it thinking RLS alone is sufficient, no test fails.

**R3 — middleware gap**: `src/middleware.ts:11` awaits `supabase.auth.getUser()` with no `try/catch`. An invalid/expired JWT returns `{ data: { user: null } }` (not a throw) — that path is safe. A genuine network failure throws and propagates as an unhandled 500. The fix is a 3-line try/catch. The test proves the fix holds.

**Not yet tested**: The SSR plan read (`src/pages/plans/[id].astro:13`) queries by plan ID with no app-layer user_id filter, relying entirely on RLS. This path requires a real Supabase test project to verify RLS enforcement and is deferred to Phase 3.

## Desired End State

Running `npm test` exercises both risk surfaces. For R2: any refactor that removes `.eq("user_id", ...)` from `[id].ts` makes at least two tests red. For R3: the middleware correctly redirects on missing session, expired token, and `getUser()` throw — confirmed by tests that import `onRequest` directly and call it with a mocked Supabase client. The cookbook §6.2 documents the auth boundary test pattern so future tests follow the same shape.

### Key Discoveries

- `src/pages/api/plans/[id].ts:37,61` — both handlers already have `.eq("user_id", context.locals.user.id)`. The test protects this contract, not adds it.
- `src/pages/api/plans/[id].ts:7,50` — auth guard fires before any DB call; the 401 tests are simple (no Supabase mock needed for that branch).
- `src/middleware.ts:11` — `await supabase.auth.getUser()` has no `try/catch`; this is the production code change in Phase 2.
- `src/middleware.ts:4` — `PROTECTED_ROUTES` covers UI pages (`/dashboard`, `/generate`, `/plans`, `/account`) only; `/api/` routes are NOT listed and self-protect via their own 401 checks.
- `astro:middleware` is a pass-through type helper (`defineMiddleware(fn) === fn`); it must be mocked like `astro:env/server` for the workerd pool.
- `wrangler.jsonc:4` — `"main"` points to the Astro adapter package path, not a built file; `SELF.fetch()` requires a production build. All Phase 2 tests use direct function imports instead.

## What We're NOT Doing

- **SELF.fetch() HTTP-level tests** — requires a `npm run build` step; not worth the complexity when direct function calls cover the same decision points.
- **SSR plan read test** (`/plans/[id].astro`) — read isolation relies on RLS; a hermetic mock cannot verify that. Deferred to Phase 3 with a real Supabase test client.
- **Silent-200 fix** — when User A tries to update/delete User B's plan, both handlers return 200 with a no-op (the ownership filter matches 0 rows; Supabase returns no error). This is a correctness gap but not a security issue. Tests document 200 as the oracle for cross-user writes; fixing the response code is out of scope for Phase 2.
- **RLS policy testing** — the migrations at `supabase/migrations/` set up correct policies. Phase 2 tests do not verify the policies themselves; they verify the endpoint-level check that exists independently of RLS.
- **Stryker mutation testing** — cookbook §6.1 notes it as ad-hoc. Not wired for this phase.

## Implementation Approach

**Phase 1** writes `tests/api/plans-id.r2.test.ts`, testing the `POST` and `DELETE` handlers from `[id].ts` directly (imported, not via HTTP). A chainable Supabase mock records all `.eq()` calls; assertions verify that `.eq("user_id", userId)` was included. The handlers also import `generatePlan` from `@/lib/openrouter`; that module is mocked to resolve immediately so tests reach the Supabase layer.

**Phase 2** makes the one-line production fix in `middleware.ts` (wrap `getUser()` in try/catch), then writes `tests/lib/middleware.r3.test.ts`. The middleware is imported as `onRequest`, called with a minimal mock context and a mocked Supabase client. One test makes `getUser()` throw and asserts the fixed behavior (redirect, not throw). Additional tests cover the missing-session and expired-token paths (both safe before the fix; tested anyway as regression guards).

**Phase 3** updates the test plan cookbook and marks the rollout phase complete.

## Critical Implementation Details

**Chainable Supabase query builder mock** — The handlers call `supabase.from(...).update(...).eq(...).eq(...)` (or `.delete().eq().eq()`) and await the result. The mock chain must satisfy two contracts simultaneously: every builder method returns the chain itself (so chaining works), and `await chain` resolves to `{ error: null }` (so the handler continues past the Supabase call). The `then` property makes the chain thenable. Do NOT apply `mockReturnThis()` to `then` — it must actually resolve.

```typescript
// In vi.hoisted() — shared across tests in the file
const eqSpy = vi.fn().mockReturnThis();

const chain: any = {
  update:  vi.fn().mockReturnThis(),
  delete:  vi.fn().mockReturnThis(),
  insert:  vi.fn().mockReturnThis(),
  select:  vi.fn().mockReturnThis(),
  single:  vi.fn().mockReturnThis(),
  eq: eqSpy,
  then(resolve: (v: { error: null; data: unknown }) => void, reject: (e: unknown) => void) {
    return Promise.resolve({ error: null, data: { id: "plan-id" } }).then(resolve, reject);
  },
};
```

Then `supabase.from(...)` returns `chain`, and every subsequent builder call returns `chain`. Assert with:

```typescript
expect(eqSpy).toHaveBeenCalledWith("user_id", "user-a");
```

Reset `eqSpy` between tests via `eqSpy.mockClear()` in `beforeEach`.

**Middleware context mock** — `createClient` is mocked, so `context.request.headers` and `context.cookies` are passed to the mock but ignored. Only three properties matter for the middleware logic: `context.url.pathname` (route matching), `context.locals` (written to), and `context.redirect` (called on auth failure). Construct a minimal object for each.

---

## Phase 1: R2 — Plan Ownership Filter Tests

### Overview

Creates `tests/api/plans-id.r2.test.ts`. Proves that both the `POST` (update) and `DELETE` handlers in `src/pages/api/plans/[id].ts` include `.eq("user_id", authenticatedUserId)` in every plan-modifying database query, and return 401 when the caller is unauthenticated.

### Changes Required

#### 1. New test directory and file

**File**: `tests/api/plans-id.r2.test.ts` (creates `tests/api/` directory)

**Intent**: Import `POST` and `DELETE` from `@/pages/api/plans/[id]`, call them with a mock context, and assert observable behavior — not internal state.

**Contract**: Two `describe` blocks mirroring the two exported handlers:

- `describe("R2 — DELETE /api/plans/[id]")`:
  - `it("returns 401 when user is not authenticated")` — call with `locals: { user: null }`, assert response status 401, no Supabase calls.
  - `it("includes .eq('user_id', authenticated user id) in the delete query")` — call with `locals: { user: { id: "user-a" } }`, assert `eqSpy` was called with `("user_id", "user-a")`. The oracle is `src/pages/api/plans/[id].ts:61` plus the PRD's data-isolation requirement — not the test output.

- `describe("R2 — POST /api/plans/[id] (update)")`:
  - `it("returns 401 when user is not authenticated")`
  - `it("includes .eq('user_id', authenticated user id) in the update query")` — requires a valid JSON request body (`{ rideStats: "r1\nr2\nr3", goal: "speed" }`) and `@/lib/openrouter` mocked to resolve.

Mocks needed:
- `@/lib/supabase` — `createClient` returns a mock client whose `from()` returns the chain described in "Critical Implementation Details."
- `astro:env/server` — `SUPABASE_URL` and `SUPABASE_KEY` present (so `createClient` is not null).
- `@/lib/openrouter` — `generatePlan` resolves with a stub `TrainingPlan` (DELETE handler does not call it; POST handler does before reaching the Supabase update).

### Success Criteria

#### Automated Verification

- `npm test` runs both new test cases without error.
- `npm run lint` passes (no TypeScript errors in the new file).

#### Manual Verification

- Read each assertion and confirm the expected value comes from the PRD data-isolation requirement or from `src/pages/api/plans/[id].ts:61` (the line that was written to enforce isolation), not from running the code and reading its output.

**Implementation Note**: After automated verification passes, pause for manual review of test assertions before moving to Phase 2.

---

## Phase 2: R3 — Middleware Fix + Auth Boundary Tests

### Overview

Two sub-tasks: (a) patch `src/middleware.ts` to handle a `getUser()` network failure gracefully, then (b) write `tests/lib/middleware.r3.test.ts` that proves the patched behavior and covers the session-missing and expired-token paths.

### Changes Required

#### 1. Production fix — middleware try/catch

**File**: `src/middleware.ts`

**Intent**: Wrap `supabase.auth.getUser()` (line 11) in a try/catch so a network failure during JWT validation is treated as unauthenticated, not propagated as an uncaught 500.

**Contract**: Replace the bare `const { data: { user } } = await supabase.auth.getUser();` and its assignment with a try/catch block. On catch, set `context.locals.user = null`. The catch block must not re-throw. The surrounding `if (supabase)` guard remains — this change is entirely inside the `if (supabase)` branch.

#### 2. Middleware auth boundary tests

**File**: `tests/lib/middleware.r3.test.ts`

**Intent**: Import `onRequest` from `@/middleware`, call it with a minimal context mock and mocked Supabase client, and assert the redirect vs. pass-through behavior for every auth path.

**Contract**: One `describe("R3 — middleware auth boundary")` block with these cases:

- `it("redirects to /auth/signin when session cookie is missing")` — mock `getUser` to resolve `{ data: { user: null } }`; URL is `/dashboard`; assert `context.redirect` called with `/auth/signin`; assert `next` not called.
- `it("redirects to /auth/signin when getUser returns no user (expired or invalid token)")` — same mock, different framing; explicit that an expired JWT is the scenario.
- `it("redirects to /auth/signin when getUser throws (network failure — proves the Phase 2 fix)")` — mock `getUser` to reject; assert redirect to `/auth/signin` (would have been an unhandled throw before the fix).
- `it("calls next() and does not redirect when session is valid")` — mock `getUser` to resolve a real user (`{ data: { user: { id: "u1" } } }`); URL is `/dashboard`; assert `next()` called; assert `redirect` not called.
- `it("calls next() and does not redirect for an unprotected route even with no session")` — URL is `/api/plans/generate`; `getUser` returns no user; assert `next()` called (not redirected, because `/api/` is not in `PROTECTED_ROUTES`).

Additional `describe("R3 — API route self-auth guard (generate.ts)")`:
- `it("returns 401 when context.locals.user is null")` — import `POST` from `@/pages/api/plans/generate`, call with `locals: { user: null }`, assert status 401. No Supabase or OpenRouter mock needed (auth check fires before those calls).

Mocks needed:
- `astro:middleware` — `{ defineMiddleware: (fn: unknown) => fn }` (pass-through, mirrors actual behavior).
- `@/lib/supabase` — `createClient` returns a mock client with `auth: { getUser: mockState.getUser }`. Per-test control of `getUser` via `mockState`.
- `astro:env/server` — `SUPABASE_URL` and `SUPABASE_KEY` present.

Context factory (no `SELF.fetch()`):
```typescript
function makeCtx(pathname: string) {
  return {
    url: new URL(`http://localhost${pathname}`),
    request: new Request(`http://localhost${pathname}`),
    cookies: {},
    locals: {} as App.Locals,
    redirect: vi.fn((path: string) =>
      new Response(null, { status: 302, headers: { Location: path } })
    ),
  };
}
```

### Success Criteria

#### Automated Verification

- `npm test` runs all new middleware test cases.
- `npm run lint` passes (includes TypeScript in `src/middleware.ts` and the new test file).

#### Manual Verification

- Inspect `src/middleware.ts` after the edit: confirm the `try/catch` wraps only the `supabase.auth.getUser()` call and assignment; the `if (supabase)` outer guard and the `PROTECTED_ROUTES` check are unchanged.
- Confirm the throw test asserts `context.redirect` was called (not that an error was thrown) — proving the fix, not the broken behavior.

**Implementation Note**: Pause after all automated checks pass for manual review of the middleware diff and the throw-case assertion before proceeding to Phase 3.

---

## Phase 3: Cookbook Sync

### Overview

Update `context/foundation/test-plan.md` to reflect what Phase 2 shipped: fill in §6.2, note the SSR read IDOR deferral, and mark Phase 2 `complete` in §3.

### Changes Required

#### 1. Update test-plan.md §6.2

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `§6.2 Adding a data-isolation test` placeholder with the patterns Phase 2 established, so future tests in this area follow the same shape.

**Contract**: The new §6.2 body should cover:
- **Location**: `tests/api/<route>.r<N>.test.ts` for API handler tests.
- **Mock pattern for Supabase chain**: the chainable `eq`-spy pattern from "Critical Implementation Details" above; reference `tests/api/plans-id.r2.test.ts`.
- **Key rule**: assert that `.eq("user_id", authenticatedUserId)` is present in any plan-modifying query — not that the response is 200 or that Supabase is called N times. The oracle is the PRD data-isolation requirement.
- **Known gap**: cross-user write/delete returns 200 (not 403/404) when the ownership filter matches 0 rows. Do not assert 200 as a success; assert only that the filter was applied.
- **Reference**: `tests/api/plans-id.r2.test.ts` — ownership filter + unauthenticated 401 for plan API.

#### 2. Update test-plan.md §6.3 (auth boundary note)

**File**: `context/foundation/test-plan.md`

**Intent**: Partially fill in §6.3 with the middleware auth boundary pattern from Phase 2.

**Contract**: Note in §6.3:
- **Location**: `tests/lib/middleware.r3.test.ts`.
- **Pattern**: mock `astro:middleware` as identity, mock `@/lib/supabase` `createClient`, import `onRequest` directly, construct minimal context with `url`, `locals`, and `redirect` spy.
- **Cases to always include**: no-session → redirect; `getUser()` throw → redirect (requires try/catch in middleware — now in place); valid session → `next()`.
- **Reference**: `tests/lib/middleware.r3.test.ts`.
- Note SSR read IDOR (`/plans/[id].astro`) as a Phase 3 concern: read isolation relies on RLS only; test with real Supabase test project.

#### 3. Update test-plan.md §3 Phase 2 status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark the Phase 2 row `complete` and set the Change folder value.

**Contract**: In the §3 table, row for Phase 2: Status → `complete`, Change folder → `context/changes/testing-data-isolation-auth-boundary`.

### Success Criteria

#### Automated Verification

- `npm test` still passes after the test-plan.md edit (no test files were changed).
- Read `context/foundation/test-plan.md §3` — Phase 2 row reads `complete`.

#### Manual Verification

- Read §6.2 and confirm the chainable-mock pattern and the "assert filter, not response code" oracle rule are present and clear enough for a future implementer to follow without reading this plan.
- Confirm §6.3 includes the SSR deferral note.

---

## Testing Strategy

### What these tests protect

| Test case | Regression it catches |
|---|---|
| DELETE includes `.eq("user_id", userId)` | Developer removes app-layer ownership filter, assuming RLS alone is enough |
| POST (update) includes `.eq("user_id", userId)` | Same |
| DELETE/POST unauthenticated → 401 | Auth guard accidentally removed from handler |
| Middleware: no session → redirect | `PROTECTED_ROUTES` check or null-user guard removed |
| Middleware: `getUser()` throws → redirect | try/catch removed or exception path re-added |
| Middleware: valid session → `next()` | Middleware accidentally blocks authenticated users |
| Middleware: unprotected route → `next()` | Middleware accidentally redirects API routes |
| `generate.ts` unauthenticated → 401 | Auth guard removed from generate handler |

### Known gaps (documented, not tested in Phase 2)

- Cross-user write/delete returns 200 when ownership filter matches 0 rows.
- SSR plan read (`/plans/[id].astro`) relies on RLS only — no hermetic test can verify RLS enforcement; deferred to Phase 3.

## References

- Research: `context/changes/testing-data-isolation-auth-boundary/research.md`
- Ownership filter: `src/pages/api/plans/[id].ts:37,61`
- Auth guard (handlers): `src/pages/api/plans/[id].ts:7,50`
- Middleware gap: `src/middleware.ts:11`
- Protected route list: `src/middleware.ts:4`
- RLS policies: `supabase/migrations/20260528000000_create_plans_table.sql:12–22`
- Phase 1 mock pattern reference: `tests/lib/openrouter.r1.test.ts`
- Test plan: `context/foundation/test-plan.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: R2 — Plan Ownership Filter Tests

#### Automated

- [x] 1.1 `npm test` passes with new `tests/api/plans-id.r2.test.ts` — c761797
- [x] 1.2 `npm run lint` passes (no TypeScript errors in the new file) — c761797

#### Manual

- [x] 1.3 Confirm each assertion's expected value comes from PRD/source, not from running the code

### Phase 2: R3 — Middleware Fix + Auth Boundary Tests

#### Automated

- [x] 2.1 `npm test` passes with new `tests/lib/middleware.r3.test.ts`
- [x] 2.2 `npm run lint` passes (includes `src/middleware.ts` diff and new test file)

#### Manual

- [x] 2.3 Inspect `src/middleware.ts` diff — try/catch wraps only the `getUser()` call
- [x] 2.4 Confirm the throw-case test asserts redirect, not that an error was thrown

### Phase 3: Cookbook Sync

#### Automated

- [ ] 3.1 `npm test` still passes (no test files changed)
- [ ] 3.2 `context/foundation/test-plan.md §3` Phase 2 row reads `complete`

#### Manual

- [ ] 3.3 §6.2 chainable-mock pattern and oracle rule are clear to a future implementer
- [ ] 3.4 §6.3 includes SSR deferral note
