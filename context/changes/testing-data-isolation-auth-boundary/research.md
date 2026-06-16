---
date: 2026-06-16T00:00:00+00:00
researcher: Claude Sonnet 4.6
git_commit: ebae756301c1119e60345148001a5efe0c0c8b56
branch: master
repository: 10xdevs
topic: "Data isolation and auth boundary — grounding R2 (IDOR) and R3 (auth middleware) for Phase 2 test rollout"
tags: [research, testing, data-isolation, idor, middleware, auth, supabase, rls]
status: complete
last_updated: 2026-06-16
last_updated_by: Claude Sonnet 4.6
---

# Research: Data Isolation and Auth Boundary (R2, R3)

**Date**: 2026-06-16
**Researcher**: Claude Sonnet 4.6
**Git Commit**: ebae756301c1119e60345148001a5efe0c0c8b56
**Branch**: master
**Repository**: 10xdevs

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md`. Verify R2 (IDOR — User A cannot read/modify/delete User B's plan) and R3 (auth boundary — expired/missing session redirects to login, not 500) in the actual codebase. Identify the exact failure surfaces, confirm or correct the risk response guidance, and determine the cheapest test layer that gives real signal.

## Summary

**R2 (IDOR)**: Both the API update handler and the API delete handler include an explicit app-layer ownership filter (`.eq("user_id", context.locals.user.id)`) that the test plan's guidance anticipated. The filter is present. However, there is no GET API endpoint for plans — plan reads happen through a server-side Astro page (`src/pages/plans/[id].astro`) that does **not** have an app-layer ownership filter; it relies entirely on RLS. This is a meaningful distinction: the "reads" arm of R2 is protected differently than the writes, and a test plan that targets only the API endpoints would miss it. Additionally, when a cross-user write/delete silently matches 0 rows, both handlers return 200 (not 403/404) — a correctness gap worth noting.

**R3 (auth boundary)**: The middleware correctly sets `context.locals.user` for every request and redirects unauthenticated users from protected routes. The protected route list covers UI pages only (`/dashboard`, `/generate`, `/plans`, `/account`); API routes under `/api/` are not in the list and self-protect via their own 401 checks. An invalid or expired JWT does not throw — `supabase.auth.getUser()` returns `{ data: { user: null } }`, which the middleware handles safely. The one unhandled exception path is a genuine network failure during `getUser()`, which has no `try/catch` and would surface as an unhandled 500.

**Test layer recommendation**: Library-level tests (direct function calls with mocked Supabase), not `SELF.fetch()`. The wrangler `main` points to `@astrojs/cloudflare/entrypoints/server` — a package path that requires a production build before `SELF.fetch()` resolves to a real worker. Direct function calls require no build step, are faster, and cover exactly the decision points that matter for R2 and R3.

---

## Detailed Findings

### R2 — IDOR / Data Isolation

#### API update and delete — app-layer ownership filter confirmed

File: `src/pages/api/plans/[id].ts`

Both exported handlers apply a double-filter to every database operation that accepts a URL-supplied plan ID:

```typescript
// POST (update) — lines 33–37
const { error } = await supabase
  .from("plans")
  .update({ plan: planData, ride_stats: rideStats, goal, name })
  .eq("id", id)                           // URL-supplied plan ID
  .eq("user_id", context.locals.user.id); // app-layer ownership check

// DELETE — lines 59–61
const { error } = await supabase
  .from("plans")
  .delete()
  .eq("id", id)
  .eq("user_id", context.locals.user.id); // app-layer ownership check
```

Both operations gate on `context.locals.user` being non-null (lines 7 and 50) before reaching the Supabase call. The user ID is set by the middleware via `supabase.auth.getUser()` (see R3 findings), not from the request body — it cannot be spoofed.

**The regression the test must catch**: a developer removes `.eq("user_id", context.locals.user.id)` assuming RLS alone is sufficient. Without the filter, a request from User A with User B's plan ID would still pass the `!context.locals.user` check (A is authenticated) and proceed to a DB operation that RLS might block — but the test should not rely on RLS to catch it; the endpoint-level filter is the boundary.

#### Plan insert — user_id hardcoded from authenticated session

File: `src/pages/api/plans/generate.ts`, lines 32–35

```typescript
const { data, error } = await supabase
  .from("plans")
  .insert({ user_id: context.locals.user.id, name, goal, ... })
```

The `user_id` in the insert always comes from the authenticated session, not from any request body field. No IDOR surface on creation.

#### SSR plan read — no app-layer ownership filter (RLS-only)

File: `src/pages/plans/[id].astro`, line 13

```typescript
const queryResult = supabase
  ? await supabase.from("plans").select("*").eq("id", id).single()
  : null;
```

This is the only read path for a plan by ID — there is no GET API endpoint. The query filters only on `id`; there is no `.eq("user_id", ...)` here. If User A navigates to `/plans/<B-plan-id>`, the Supabase client uses User A's JWT, and the RLS policy `plans_select_own` (`auth.uid() = user_id`) causes the query to return no rows. `plan` is set to null and the page redirects to `/dashboard`.

**This is RLS-only protection for reads.** If RLS were disabled or the policy had a bug, the page would expose User B's plan to User A. This is a real risk surface, but testing it hermetically requires either a real Supabase test project (to exercise the RLS policy) or mocking the DB layer. A hermetic mock for this path would only prove that the page handles a null result — it cannot verify that the ownership filter is correctly enforced.

**Recommendation for the plan**: The SSR read path is a distinct sub-risk from the API write/delete path. Note it in the plan as a RLS-integration concern; defer testing it to Phase 3 when a real Supabase test client is available. Phase 2 should focus on the app-layer check in the API handlers.

#### DB-level RLS policies

File: `supabase/migrations/20260528000000_create_plans_table.sql`, lines 12–23; `supabase/migrations/20260529000000_plans_update_policy.sql`

All four operations are covered:
- SELECT: `USING (auth.uid() = user_id)`
- INSERT: `WITH CHECK (auth.uid() = user_id)`
- DELETE: `USING (auth.uid() = user_id)`
- UPDATE: `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`

RLS is enabled on the `plans` table. The policies are a correct second defence layer. The Phase 2 test is NOT about testing these policies — it is about verifying that the endpoint adds the app-layer filter in addition to whatever the DB enforces.

#### Gap: misleading 200 on cross-user write attempt

When User A attempts to update or delete User B's plan, the query runs successfully but matches 0 rows (the `user_id` filter eliminates User B's row). Supabase returns `{ error: null }` for a zero-row update/delete. Both handlers check only `if (error)` — they do not check whether any rows were actually affected. The response is `200 { planId: id }` or `200 { success: true }`.

This is not a security vulnerability (no data is exposed or corrupted), but it is a correctness gap: the caller cannot distinguish "operation succeeded" from "operation was silently rejected due to ownership mismatch." This should be flagged in the plan as a follow-on improvement, not a test-plan blocker.

---

### R3 — Auth Boundary / Middleware

#### Full middleware flow

File: `src/middleware.ts`

```typescript
const PROTECTED_ROUTES = ["/dashboard", "/generate", "/plans", "/account"]; // line 4

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies); // line 7

  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser(); // line 11
    context.locals.user = user ?? null;                        // line 13
  } else {
    context.locals.user = null;                                // line 15
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");                 // line 20
    }
  }

  return next();                                               // line 23
});
```

`defineMiddleware` from `astro:middleware` is a pass-through type helper — it returns the function unchanged. `onRequest` is the handler function directly. It can be imported and called in tests.

#### Protected routes — UI pages only, NOT API routes

PROTECTED_ROUTES (`src/middleware.ts:4`) contains `/dashboard`, `/generate`, `/plans`, `/account`. An API path such as `/api/plans/generate` does NOT start with any of these prefixes (it starts with `/api/`). API routes are not middleware-redirected.

API routes self-protect: `src/pages/api/plans/generate.ts:7` and `src/pages/api/plans/[id].ts:7,50` both open with:
```typescript
if (!context.locals.user) {
  return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
}
```

These checks read `context.locals.user` set by the middleware. The middleware always runs before any route handler (Astro middleware chain).

#### Session validation: `getUser()` not `getSession()`

The middleware calls `supabase.auth.getUser()` (line 11), not `getSession()`. `getUser()` makes a server-side JWT validation call against the Supabase Auth API — it does not merely decode the local cookie. For an expired JWT, Supabase returns `{ data: { user: null }, error: AuthApiError }` (no throw). The middleware's `user ?? null` handles this correctly.

A completely missing Cookie header produces an empty array from `parseCookieHeader` (`src/lib/supabase.ts:20`) — the Supabase client is still created but has no session, so `getUser()` returns `{ data: { user: null } }`. Safe path.

#### Unhandled exception: `getUser()` network failure

`src/middleware.ts:11` — `await supabase.auth.getUser()` has no surrounding `try/catch`. If Supabase Auth is unreachable (genuine network failure, cold-start timeout), the awaited call throws, the exception propagates through the middleware chain, and Cloudflare Workers surfaces a 500 to the user. This is the "500 instead of login" scenario from R3.

This path is not practically triggerable in a hermetic test (it requires the network to fail mid-request). For a hermetic coverage of this branch, the mock would need to throw from `getUser()`. The oracle is clear: the correct behavior would be `return context.redirect("/auth/signin")` on any auth failure, not a 500. **The test can and should cover this scenario** by making the mock throw, asserting that the current code does NOT redirect (it 500s), and flagging this as a known gap.

Whether to add a `try/catch` and fix the gap is a plan-phase decision, not a research-phase decision.

#### Supabase client null path (missing env vars)

`src/lib/supabase.ts:13-17` — `createClient` returns null if `SUPABASE_URL` or `SUPABASE_KEY` is falsy. In that case, the middleware sets `context.locals.user = null` (line 15) without calling `getUser()`. Protected routes redirect to signin. This is safe behavior — a misconfigured environment results in all users being treated as unauthenticated.

#### `astro:middleware` — mock requirement for tests

In the workerd vitest pool, Astro virtual modules (`astro:env/server`, `astro:middleware`) must be mocked explicitly. Existing tests mock `astro:env/server` via `vi.mock("astro:env/server", ...)`. Tests for the middleware must similarly mock `astro:middleware`:

```typescript
vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));
```

This is accurate because `defineMiddleware` is a trivial identity wrapper.

---

### Test Infrastructure — Direct Function Call vs. SELF.fetch()

`wrangler.jsonc:4`: `"main": "@astrojs/cloudflare/entrypoints/server"` — this is an npm package path, not a built output file. For `SELF.fetch()` to dispatch to a real worker, the Astro app must be built first (`npm run build`) to produce `dist/_worker.js`. No tests in the current suite use `SELF.fetch()`.

**Recommendation**: Use direct function calls for Phase 2.
- Import `POST`/`DELETE` from `src/pages/api/plans/[id].ts` and call them with a mock context.
- Import `onRequest` from `src/middleware.ts` and call it with a mock context and a `vi.fn()` `next`.
- This requires no build step, runs in workerd via the existing vitest config, and targets exactly the decision points that matter.

**Future reference**: If Phase 3 needs SELF.fetch() (e.g., to test the full account-deletion flow end-to-end), add `"main": "./dist/_worker.js"` to `wrangler.jsonc` as a test-only override, or run a separate wrangler config for tests.

---

### Mock Patterns — Extension of Phase 1 Patterns

Phase 1 tests (`tests/lib/openrouter.r1.test.ts`) established:
- `vi.hoisted()` for mutable mock state shared across mock factories
- `vi.mock("astro:env/server", ...)` for env vars
- `vi.mock("openai", ...)` for third-party modules

Phase 2 tests need one additional mock: the Supabase client factory.

```typescript
// Hoist mutable mock state
const mockState = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

// Mock the factory — returns a mock client or null (for env-missing scenarios)
vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockState.getUser },
    from: mockState.from,
  })),
}));
```

The Supabase query builder is a fluent chain (`.from().update().eq().eq()`). The mock needs to return an object where each method returns `this` (or another mock) and the terminal call (`.eq()`) returns a Promise. The plan phase should detail this chain mock.

#### Constructing the Astro context mock for middleware tests

The middleware accesses: `context.request.headers` (passed to `createClient`), `context.cookies` (passed to `createClient`), `context.url.pathname` (for route matching), `context.locals` (written to), and calls `context.redirect(path)`. Since `createClient` will be mocked, only `context.url.pathname`, `context.locals`, and `context.redirect` need real implementations:

```typescript
function makeContext(pathname: string) {
  return {
    url: new URL(`http://localhost${pathname}`),
    request: new Request(`http://localhost${pathname}`),
    cookies: {} as AstroCookies,
    locals: {} as App.Locals,
    redirect: vi.fn((path: string) => new Response(null, { status: 302, headers: { Location: path } })),
  };
}
```

#### Constructing the Astro context mock for API handler tests

API handlers access: `context.locals.user`, `context.params`, `context.request.json()`, `context.request.headers`, `context.cookies`. Since `createClient` will be mocked, only `locals.user`, `params`, and `request` body need real values:

```typescript
function makePlanContext(userId: string | null, planId: string, body: object) {
  return {
    locals: { user: userId ? { id: userId } : null },
    params: { id: planId },
    request: new Request("http://localhost/api/plans/" + planId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    cookies: {} as AstroCookies,
  };
}
```

---

## Code References

| Reference | Relevance |
|---|---|
| `src/pages/api/plans/[id].ts:7` | Auth guard — POST handler |
| `src/pages/api/plans/[id].ts:37` | App-layer ownership filter — POST update |
| `src/pages/api/plans/[id].ts:50` | Auth guard — DELETE handler |
| `src/pages/api/plans/[id].ts:61` | App-layer ownership filter — DELETE |
| `src/pages/api/plans/generate.ts:7` | Auth guard — generate/insert handler |
| `src/pages/api/plans/generate.ts:34` | user_id hardcoded from session on insert |
| `src/pages/plans/[id].astro:13` | SSR plan read — no app-layer ownership filter, RLS-only |
| `src/middleware.ts:4` | PROTECTED_ROUTES list |
| `src/middleware.ts:7` | createClient call — passes headers + cookies |
| `src/middleware.ts:11` | `supabase.auth.getUser()` — no try/catch |
| `src/middleware.ts:13` | `context.locals.user` assignment |
| `src/middleware.ts:18–22` | Protected route check + redirect target |
| `src/lib/supabase.ts:13–32` | `createClient` — cookie parsing from header |
| `src/lib/supabase.ts:6–11` | `createAdminClient` — service role client (Phase 3 relevance) |
| `supabase/migrations/20260528000000_create_plans_table.sql:12–22` | RLS enable + SELECT/INSERT/DELETE policies |
| `supabase/migrations/20260529000000_plans_update_policy.sql:1–4` | UPDATE policy (USING + WITH CHECK) |
| `src/types/database.ts:24–33` | `Plan` type — `user_id: string` field confirms DB shape |
| `tests/lib/openrouter.r1.test.ts` | Reference: `vi.hoisted` + module mock pattern |
| `vitest.config.ts` | `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })` |
| `wrangler.jsonc:4` | `"main": "@astrojs/cloudflare/entrypoints/server"` — requires build for SELF.fetch() |

---

## Architecture Insights

**Two-tier ownership model for plans**:
- *Writes* (update, delete via API): app-layer filter + RLS. Both layers agree.
- *Reads* (view via SSR page): RLS only. No app-layer filter.

This is not a bug — the SSR Supabase client uses the user's JWT, and RLS correctly enforces `auth.uid() = user_id`. But it means the test strategy for reads is different from writes: reads require a real (or realistically stubbed) RLS evaluation, which means a real Supabase test project. Phase 2 should scope to write/delete ownership (hermetic) and defer read IDOR to Phase 3.

**Middleware sets `context.locals.user` for ALL routes** — protected and unprotected. This means:
- Protected routes: middleware blocks unauthenticated requests before the handler runs.
- Unprotected routes (including all `/api/` routes): middleware still populates `context.locals.user` (or null), and the handler reads this value for its own auth check.

**`getUser()` over `getSession()`**: The middleware uses server-side JWT validation. This is more secure than local cookie decode — it catches revoked tokens. The trade-off is a network call on every request. The test must mock this call; the mock returning `{ data: { user: null } }` accurately represents what Supabase returns for invalid/expired tokens (not a throw).

---

## Risk Response Guidance — Verification and Corrections

### R2 corrections

| Guidance field | Test plan stated | Research finding | Correction needed? |
|---|---|---|---|
| What proves protection | User A cannot read or delete User B's plan via direct API call | Confirmed for API write/delete. Read goes through SSR page (no API endpoint). | Scope test to API write/delete; note read IDOR is RLS-only and deferred to Phase 3 |
| Must challenge | "RLS at DB layer means no app-layer check needed" | App-layer check IS present in both handlers. The SSR page does rely on RLS only for reads. Challenge holds for reads. | Test plan guidance is accurate for API handlers; SSR read path is a separate case |
| Likely cheapest layer | Integration test: request User B's plan with User A's valid session token | Library-level handler call with mocked Supabase is cheaper and sufficient for verifying the ownership filter exists | Update to: library-level handler call (direct function import) |
| Anti-pattern to avoid | Testing DB RLS policy in isolation | Still correct — test the endpoint-level filter, not the RLS behavior | No change |

### R3 corrections

| Guidance field | Test plan stated | Research finding | Correction needed? |
|---|---|---|---|
| What proves protection | Missing/expired session cookie to protected route → redirect, not 500 | Confirmed. Invalid JWT returns null user (no throw). Missing cookie also returns null user. One real 500 path: `getUser()` throws on network failure (no try/catch). | Test plan guidance is accurate; add: also test the `getUser()` throw path (current code 500s, which the test should capture as a known gap) |
| Must challenge | "If middleware redirects, the route handler will not execute" | Confirmed — middleware `return context.redirect(...)` short-circuits the chain. Route handler is never called. | No change |
| Context research must ground | Protected-route list in middleware.ts, how Cloudflare Workers SSR handles cookie parsing | Grounded: PROTECTED_ROUTES are UI pages only; `/api/` routes are NOT in the list; cookie parsing is via `parseCookieHeader` which handles missing header safely | No change needed in test plan |
| Likely cheapest layer | Integration test: hit protected endpoint with no auth cookie, expired token, valid token | Library-level `onRequest()` call with mocked Supabase client — cheaper, no SELF.fetch() needed | Update to: direct middleware function call |
| Anti-pattern to avoid | Testing only the successful-login path | Still correct | No change |

---

## Historical Context

No prior changes in `context/archive/` are relevant to this phase. Phase 1 (`testing-bootstrap-plan-generation`) established the vitest + workerd environment and the mock patterns that Phase 2 builds on.

---

## Proposed Test File Locations

Following the cookbook naming in `context/foundation/test-plan.md §6.1`:

| File | Risk | Approach |
|---|---|---|
| `tests/api/plans-id.r2.test.ts` | R2 — IDOR | Import `POST`/`DELETE` from `@/pages/api/plans/[id]`; mock `@/lib/supabase`; construct mock context |
| `tests/lib/middleware.r3.test.ts` | R3 — auth boundary | Import `onRequest` from `@/middleware`; mock `@/lib/supabase` + `astro:middleware`; construct mock context |

The `tests/api/` directory does not yet exist; it should be created in Phase 2.

---

## Open Questions

1. **Silent 200 on cross-user write**: Should the plan explicitly decide whether to add a 403/404 when the ownership filter matches 0 rows, or defer that fix? The test can document current behavior (200) as a known gap without requiring a fix in Phase 2.

2. **`getUser()` network failure**: The current middleware has no `try/catch` around the `getUser()` call. Should Phase 2 add the fix (wrap in try/catch, redirect on error) and write a test for it, or test the current behavior (500) and defer the fix? This is a plan-phase decision — both are valid choices.

3. **SSR read IDOR deferral**: Confirming that testing `src/pages/plans/[id].astro` for ownership is deferred to Phase 3 (real Supabase test client) is a plan decision to be made explicit.
