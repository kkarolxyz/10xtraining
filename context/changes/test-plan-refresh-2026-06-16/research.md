---
date: 2026-06-17T00:00:00+00:00
researcher: claude-sonnet-4-6
git_commit: e1cc483b316b1af4c97395c5417bf99f491c8bb4
branch: master
repository: kkarolxyz/10xtraining
topic: "Test plan refresh — per-edit hooks (R7) and delete-account error branches (R8)"
tags: [research, hooks, PostToolUse, vitest, delete-account, error-branches]
status: complete
last_updated: 2026-06-17
last_updated_by: claude-sonnet-4-6
---

# Research: Test Plan Refresh — R7 (Per-Edit Hooks) and R8 (Delete-Account Error Branches)

**Date**: 2026-06-17
**Researcher**: claude-sonnet-4-6
**Git Commit**: e1cc483b316b1af4c97395c5417bf99f491c8bb4
**Branch**: master
**Repository**: kkarolxyz/10xtraining

## Research Question

Ground two new risks identified during the 2026-06-16 test-plan refresh:

- **R7**: Agent edits a risk-area file with no mid-session feedback; regression surfaces at CI minutes later, not at edit time.
- **R8**: `delete-account` endpoint error branches are untested; the endpoint went through a review-fix cycle.

For each risk, verify or correct the response guidance from the refresh brief, locate file:line anchors, and identify the cheapest useful test layer.

---

## Summary

**R7 (per-edit hooks):** PostToolUse hook is feasible and partially grounded. `vitest related <file> --run` works with source files in the workerd pool. Three risk-area files have immediate coverage: `src/middleware.ts`, `src/lib/openrouter.ts`, `src/pages/api/plans/[id].ts`. The fourth risk-area file (`src/pages/api/auth/delete-account.ts`) has no workerd-pool tests yet — coverage there depends on Phase 5 shipping first.

**R8 (delete-account error branches):** The endpoint has five error paths; four are untested. A correctness bug was found: `deleteUser()` at `src/pages/api/auth/delete-account.ts:22` is not wrapped in try-catch — a throw propagates to the Astro runtime as an HTML error page, not a JSON 500. The endpoint is fully mockable via `vi.mock('@/lib/supabase')` following the existing `plans-id.r2.test.ts` pattern. Tests belong in `tests/api/delete-account.r8.test.ts` (workerd pool), not the integration pool — this also enables per-edit hook coverage for that file once Phase 5 ships.

**Ordering dependency discovered:** Phase 5 (delete-account hermetic tests) enables Phase 4 (per-edit hook) to cover `src/pages/api/auth/delete-account.ts`. The phases are correctly sequenced in the refresh brief (Phase 4 first, Phase 5 second), but the plan should note that the hook's delete-account coverage is gated on Phase 5.

---

## Detailed Findings

### R7 — Per-Edit Hook Feasibility

#### Hook event and matcher (CLAUDE.md:58)

- **Event**: `PostToolUse`
- **Matcher**: `Write|Edit` — fires once per file save during an agent turn
- **Multiple edits in one turn**: Three edits in one turn fire three independent hook invocations; no built-in aggregation (`CLAUDE.md:100`)

#### Signal mechanism (CLAUDE.md:76–82)

- Exit code **0** → success, no interruption
- Exit code **2** → blocking error; stdout flows into `additionalContext` in the agent's next-turn context (cap: 10,000 characters)
- **Other exit codes** → non-blocking, logged but does not interrupt

#### vitest related — pool behavior (vitest.config.ts, vitest.integration.config.ts)

`vitest related <source-file> --run` works with source files (not only test files). The workerd pool resolves the import graph and finds test files that import the specified source file.

| Source file edited | vitest related result | Pool |
|---|---|---|
| `src/middleware.ts` | `tests/lib/middleware.r3.test.ts` ✓ | workerd |
| `src/lib/openrouter.ts` | `tests/lib/openrouter.r1.test.ts`, `openrouter.r4.test.ts` ✓ | workerd |
| `src/pages/api/plans/[id].ts` | `tests/api/plans-id.r2.test.ts` ✓ | workerd |
| `src/pages/api/auth/delete-account.ts` | **0 tests found** ✗ | workerd (integration tests are in Node pool only) |

`vitest related` **does not cross pools**. The main `vitest.config.ts` (lines 12–16) includes only `tests/lib/**`, `tests/api/**`, `tests/smoke/**`. The integration pool (`vitest.integration.config.ts:6`) includes only `tests/integration/**`. A hook running the main config cannot reach `tests/integration/account-lifecycle.r6.test.ts`.

**Practical implication**: The per-edit hook scope is workerd-only. The Node integration pool stays at pre-commit and CI layers only.

#### File path extraction in hook handler (CLAUDE.md:59)

Hook stdin carries the tool input JSON. The edited file path is extracted via:

```bash
jq -r .tool_input.file_path
```

**Important**: `src/pages/api/plans/[id].ts` contains shell-special characters (`[`, `]`). The hook command must quote the file path when passing it to `vitest related`:

```bash
FILE=$(echo "$HOOK_INPUT" | jq -r .tool_input.file_path)
npx vitest related "$FILE" --run
```

Quoting `"$FILE"` prevents the shell from expanding `[id]` as a glob.

#### Hook JSON schema — not present in codebase

No `.claude/settings.json` hook example exists in the project. CLAUDE.md §Lesson 3 describes the pattern in prose but does not show the JSON schema. The hook structure must be inferred from the prose description (event, matcher, handler, signal). The `update-config` skill (`C:\10xdevs\.claude\skills\update-config`) handles wiring settings.json hooks and should be used during Phase 4 implementation.

#### Existing pre-commit layer (`.husky/pre-commit`)

The pre-commit gate (Phase 3 deliverable) is wired as a raw bash script:

```bash
# .husky/pre-commit
staged=$(git diff --cached --name-only)
if echo "$staged" | grep -qE '\.(ts|tsx|astro)$'; then
  npm test
fi
npx lint-staged
```

This runs **both pools** (`npm test` = workerd + integration) on staged `.ts|.tsx|.astro` files. The pre-commit gate is NOT a Claude Code hook — it's a git hook. The per-edit layer (Phase 4) is additive, not a replacement.

#### Risk-area file map for Phase 4

| File | Has workerd-pool tests? | `vitest related` finds tests? | Include in Phase 4 hook? |
|---|---|---|---|
| `src/middleware.ts` | ✓ | ✓ | yes |
| `src/lib/openrouter.ts` | ✓ | ✓ | yes |
| `src/pages/api/plans/[id].ts` | ✓ | ✓ (but quote path) | yes |
| `src/pages/api/auth/delete-account.ts` | ✗ (Node pool only) | ✗ | **after Phase 5 only** |

---

### R8 — Delete-Account Error Branches

#### Endpoint file: `src/pages/api/auth/delete-account.ts`

Full error-path map:

| Path | Trigger | Line | HTTP status | Content-Type | Body |
|---|---|---|---|---|---|
| **P1** | `!context.locals.user` | 5–10 | 401 | `application/json` | `{ error: "Not authenticated" }` |
| **P2** | `createAdminClient()` returns null | 14–20 | 500 | `application/json` | `{ error: "Service unavailable" }` |
| **P3** | `deleteUser()` returns `{ error }` | 22–30 | 500 | `application/json` | `{ error: "Failed to delete account" }` |
| **P4** | `deleteUser()` **throws** | 22 | **unhandled** | **HTML (Astro error page)** | **not JSON** |
| **P5** | `signOut()` throws | 32–39 | 200 | `application/json` | `{ success: true }` |
| **P6** | success | 41–44 | 200 | `application/json` | `{ success: true }` |

#### Correctness bug at `delete-account.ts:22`

`adminClient.auth.admin.deleteUser(userId)` is called with `await` but is **not wrapped in try-catch**. If the Supabase SDK throws (network error, timeout, malformed response, SDK version mismatch), the exception propagates uncaught to the Astro/Cloudflare Workers runtime. The runtime returns a 500 with an HTML body — not `application/json`. The fix is a try-catch around line 22 that catches the throw and returns the same `{ error: "Failed to delete account" }` response as P3. Phase 5 plan should include this fix before writing the throw test.

#### Throw vs. error-object distinction at the same line

- `mockResolvedValue({ error: new Error("...") })` → exercises P3 (error-object path, already caught)
- `mockRejectedValue(new Error("..."))` → exercises P4 (throw path, currently unhandled — needs the try-catch fix first)

Both stubs are needed. They are NOT equivalent.

#### Plans cascade — no separate deletion step

`supabase/migrations/20260528000000_create_plans_table.sql:3`:
```sql
user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
```

Plans deletion is implicit via database FK `ON DELETE CASCADE`. The endpoint does not run a separate DELETE on the plans table. If `deleteUser()` succeeds at the DB layer, plans are removed automatically. There is no partial-failure scenario where plans are deleted but auth.users is not (or vice versa) — both happen atomically inside Supabase's admin API call.

#### Existing test coverage — scope is DB cascade only

`tests/integration/account-lifecycle.r6.test.ts` tests the **database constraint**, not the endpoint:
- It calls `adminClient.auth.admin.deleteUser()` directly (bypassing the endpoint)
- Asserts `plans` table is empty afterward
- Asserts re-login is rejected

**No test exercises the DELETE `/api/auth/delete-account` endpoint at all.** P1–P6 are entirely uncovered by any test.

#### Mock pattern — follows plans-id.r2.test.ts

`createAdminClient` and `createClient` are both exported from `src/lib/supabase.ts` and imported via the `@/lib/supabase` alias at `delete-account.ts:2`. This is the same alias mocked in `tests/api/plans-id.r2.test.ts:34–36`. Phase 5 tests live in `tests/api/delete-account.r8.test.ts` (workerd pool, under the `tests/api/` include glob).

Mock scaffold:

```typescript
const mockState = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  signOut: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: mockState.createAdminClient,
  createClient: mockState.createClient,
}));

beforeEach(() => {
  mockState.deleteUser.mockReset();
  mockState.signOut.mockReset();
  mockState.createAdminClient.mockReturnValue({
    auth: { admin: { deleteUser: mockState.deleteUser } },
  });
  mockState.createClient.mockReturnValue({
    auth: { signOut: mockState.signOut },
  });
});
```

#### Oracle sources for R8 tests

Oracles come from HTTP spec and PRD intent, **not** from reading the current implementation:

| Path | Oracle source | Expected value |
|---|---|---|
| P1 (401) | HTTP 401 = unauthenticated; PRD FR-012 implies account deletion requires auth | `status: 401`, `Content-Type: application/json`, body has `error` key |
| P2 (500) | Admin client requires `SUPABASE_SERVICE_ROLE_KEY`; missing key = server misconfiguration = 5xx | `status: 500`, `Content-Type: application/json`, body has `error` key |
| P3 (500) | Supabase returns a structured error → server failed to delete → 5xx | `status: 500`, `Content-Type: application/json`, body has `error` key |
| P4 (throw) | Same as P3 — throw should be treated as server error → 5xx + JSON (requires the try-catch fix) | `status: 500`, `Content-Type: application/json`, body has `error` key |
| P5 (signOut throws) | signOut is best-effort; a successfully deleted user session no longer exists regardless | `status: 200`, `Content-Type: application/json`, `{ success: true }` |

**Anti-pattern warning**: Do not assert `{ error: "Failed to delete account" }` as the exact body — that string is an implementation detail. Assert that `body.error` is a non-empty string and `status` is 500. The Content-Type assertion is the oracle from the 18b9a3e fix history.

---

## Code References

- `src/pages/api/auth/delete-account.ts:5` — P1 auth guard
- `src/pages/api/auth/delete-account.ts:14` — P2 admin client null guard
- `src/pages/api/auth/delete-account.ts:22` — **throw not caught (P4 bug)**
- `src/pages/api/auth/delete-account.ts:23` — P3 error-object check
- `src/pages/api/auth/delete-account.ts:32–39` — P5 signOut try-catch (non-fatal)
- `src/pages/api/auth/delete-account.ts:41` — P6 success response
- `src/lib/supabase.ts:6–11` — `createAdminClient()` factory (mockable)
- `tests/api/plans-id.r2.test.ts:34–36` — reference mock pattern for `@/lib/supabase`
- `tests/integration/account-lifecycle.r6.test.ts` — existing DB cascade test (Node pool, no endpoint coverage)
- `vitest.config.ts:12–16` — workerd pool include patterns (`tests/lib/**`, `tests/api/**`, `tests/smoke/**`)
- `vitest.integration.config.ts:6` — Node pool include pattern (`tests/integration/**`)
- `CLAUDE.md:58` — PostToolUse event, `Write|Edit` matcher
- `CLAUDE.md:59` — file path extraction: `jq -r .tool_input.file_path`
- `CLAUDE.md:76–82` — exit codes, additionalContext feedback
- `CLAUDE.md:99` — `vitest related` (subcommand, not flag) + `--run` requirement
- `.husky/pre-commit:2–8` — existing pre-commit gate (runs both pools on staged ts files)

---

## Architecture Insights

**Dual-pool boundary is a hard constraint for per-edit hooks.** The workerd and Node pools are separate vitest invocations; `vitest related` scopes to whichever config is invoked. A per-edit hook using the main config reaches only `tests/lib/`, `tests/api/`, `tests/smoke/`. Integration tests stay at pre-commit and CI. This is correct per §6.3 of the cookbook ("Location: tests/integration/ — real-DB tests, NOT in the workerd pool").

**Phase ordering dependency.** Phase 4 wires the per-edit hook for three files immediately. `src/pages/api/auth/delete-account.ts` is excluded from the hook's risk-area list until Phase 5 adds `tests/api/delete-account.r8.test.ts`. The Phase 4 plan should document this as a known gap with a TODO comment: "add delete-account to risk-area list after Phase 5 ships."

**Correctness bug in Phase 5 scope.** The unhandled throw at `delete-account.ts:22` is a real defect (HTML error page instead of JSON 500). Phase 5 must fix this before the throw test can pass. The fix is a try-catch around the `deleteUser()` call. The test is the regression guard.

---

## Historical Context

- `context/changes/testing-account-lifecycle/plan.md` — Phase 3 rollout; established the integration test pattern for R6 in the Node pool. The "SSR RLS integration test" (Phase 2 in that plan) confirmed pool isolation.
- `context/changes/testing-data-isolation-auth-boundary/` — Phase 2 rollout; established the `vi.mock('@/lib/supabase')` chainable-builder mock pattern that Phase 5 will reuse for the admin client stub.
- `context/changes/delete-account/` — original delete-account implementation; commit `18b9a3e` added Content-Type headers and error logging as a review fix.

---

## Open Questions

1. **Hook JSON schema**: CLAUDE.md describes PostToolUse hooks in prose but does not show a `.claude/settings.json` example. The `update-config` skill should be used during Phase 4 to wire the actual settings.json entry. If the schema requires a specific key name (`hooks`, `postToolUse`, etc.), it will be discovered during `/10x-implement` for Phase 4.

2. **`[id]` glob in hook command**: `src/pages/api/plans/[id].ts` contains bracket characters that a shell may expand. The hook script must quote `"$FILE"` when passing to `vitest related`. Verify quoting behavior during Phase 4 smoke test.

3. **P4 fix scope**: The try-catch fix at `delete-account.ts:22` is a code change, not just a test. Phase 5 plan should explicitly list this as the first sub-phase (fix the bug, then write the test against the fixed behavior).

4. **Phase 4 lint command**: CLAUDE.md:99 says `vitest related` for tests. For lint in the per-edit hook, `eslint "$FILE"` is the natural choice. Whether the hook should run lint-only, test-only, or lint-then-test on each edit needs to be decided in the Phase 4 plan (cost × signal tradeoff: lint is fast, `vitest related` is a few seconds).
