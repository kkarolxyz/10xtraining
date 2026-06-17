# Test Plan Refresh — Per-Edit Hooks and Delete-Account Error Branches

## Overview

Wire a PostToolUse per-edit hook (Phase 1), fix an unhandled throw and add hermetic
unit tests for the delete-account endpoint (Phase 2), then sync the two new rollout
phases into `context/foundation/test-plan.md` (Phase 3). Delivers the per-edit quality
gate from CLAUDE.md Lesson 3 and closes the test gap surfaced by the delete-account
review-fix cycle.

## Current State Analysis

- No `PostToolUse` hook exists in `.claude/settings.json` or `.claude/settings.local.json`.
- Pre-commit gate is already wired via `.husky/pre-commit` (runs both pools on staged
  `.ts|.tsx|.astro` files) — Phase 1 is additive, not a replacement.
- `src/pages/api/auth/delete-account.ts:22` calls `adminClient.auth.admin.deleteUser()`
  without a try-catch; an SDK throw propagates to the Astro runtime and returns an HTML
  error page, not `application/json`. Zero tests cover any of the endpoint's six paths.
- `tests/integration/account-lifecycle.r6.test.ts` tests the DB cascade only (calls
  `deleteUser()` directly, bypasses the endpoint entirely).

## Desired End State

After Phase 1: editing any risk-area file in the agent's turn triggers lint and scoped
tests before the next tool call. After Phase 2: `deleteUser()` throws return
`500 + application/json`; all six endpoint paths are covered by hermetic unit tests;
`vitest related src/pages/api/auth/delete-account.ts --run` finds the new tests. After
Phase 3: `test-plan.md §3` lists Phase 4 and Phase 5 as `complete`, §5 records the
per-edit gate as wired, and §6.5 documents the hook cookbook pattern.

### Key Discoveries

- `CLAUDE.md:58` — PostToolUse event, `Write|Edit` matcher; hook stdin carries tool
  input JSON; file path extracted via `jq -r .tool_input.file_path`
- `CLAUDE.md:76–82` — exit code 2 = blocking; stdout → `additionalContext` (10 KB cap)
- `CLAUDE.md:99` — `vitest related` is a subcommand, not a flag; `--run` prevents
  watch mode
- `vitest.config.ts:12–16` — workerd pool includes `tests/lib/**`, `tests/api/**`,
  `tests/smoke/**` only; integration pool is separate and unreachable by per-edit hook
- `src/pages/api/plans/[id].ts` contains bracket characters (`[`, `]`) that the shell
  expands as globs unless `"$FILE"` is double-quoted in the hook script
- `src/lib/supabase.ts:6–11` — `createAdminClient()` returns null when
  `SUPABASE_SERVICE_ROLE_KEY` is absent; this is the P2 test path
- `tests/api/plans-id.r2.test.ts:34–36` — reference mock pattern for
  `vi.mock('@/lib/supabase')` that Phase 2 reuses

## What We're NOT Doing

- Not running integration tests (Node pool) in the per-edit hook — those stay at
  pre-commit and CI layers only.
- Not adding e2e or visual tests.
- Not wiring hooks for non-risk `.ts` files beyond lint.
- Not changing the pre-commit Husky gate.
- Not testing the DB cascade or re-login rejection (those are covered by the existing
  integration test in `tests/integration/account-lifecycle.r6.test.ts`).

## Implementation Approach

Phase 1 creates a hook handler script and wires it via the `update-config` skill so the
JSON schema is applied correctly. Phase 2 fixes the throw bug first, then adds unit
tests — because the P4 test can only assert correct behavior after the fix exists. Phase
2 also extends the hook's risk-area list to include `delete-account.ts` now that tests
exist in the workerd pool. Phase 3 is a pure documentation sync.

## Critical Implementation Details

**Hook stdin format.** Hook stdin is a JSON object; the edited file path lives at
`.tool_input.file_path`. The hook must parse this with `jq -r .tool_input.file_path`
(not as a positional argument). If `jq` is unavailable in the environment, `python3 -c
"import sys,json;print(json.load(sys.stdin)['tool_input']['file_path'])"` is the
fallback.

**Bracket quoting.** `src/pages/api/plans/[id].ts` contains `[` and `]` which the shell
treats as glob metacharacters. Every invocation of `vitest related` in the hook must
pass the file path as a double-quoted variable — `npx vitest related "$FILE" --run` —
not an interpolated string, to prevent glob expansion.

**Bug fix before P4 test.** The try-catch fix at `delete-account.ts:22` must land in
the same commit as or before `tests/api/delete-account.r8.test.ts`. Committing the test
without the fix produces a permanently-red suite.

**Oracle source for R8 tests.** Expected values come from the HTTP spec and PRD FR-012
intent, not from reading the implementation. Assert `status`, `Content-Type`, and that
the body has an `error` key (string, non-empty) — not the exact error message string,
which is an implementation detail.

---

## Phase 1: Per-Edit Hook

### Overview

Create the hook handler script and wire it as a `PostToolUse` hook in
`.claude/settings.json`. The hook runs `eslint` on every edited file and additionally
runs `vitest related` when the edited file is in the risk-area list (3 files at Phase 1
launch; 4 after Phase 2 ships).

### Changes Required

#### 1. Hook handler script

**File**: `.claude/hooks/post-edit.sh` (new file)

**Intent**: Shell script that (a) reads the edited file path from hook stdin, (b) runs
`npx eslint "$FILE"` unconditionally, (c) checks whether the file matches any entry in
a hard-coded risk-area list and if so runs `npx vitest related "$FILE" --run`, (d) exits
2 if either command fails so stdout flows into the agent's `additionalContext`.

**Contract**: The script must double-quote `"$FILE"` in every command invocation to
prevent glob expansion of bracket characters. The risk-area list at Phase 1 launch:
`src/middleware.ts`, `src/lib/openrouter.ts`, `src/pages/api/plans/[id].ts`. A comment
marks where Phase 2 will add `src/pages/api/auth/delete-account.ts`.

#### 2. PostToolUse hook entry in settings.json

**File**: `.claude/settings.json`

**Intent**: Add a `PostToolUse` hook entry that runs `.claude/hooks/post-edit.sh` on
every `Write` or `Edit` tool use, using the `update-config` skill to apply the correct
JSON schema.

**Contract**: Use `/update-config` to wire the hook. The event is `PostToolUse`, the
matcher covers `Write` and `Edit` tool names, and the handler is the shell script from
step 1. After wiring, the `permissions.allow` list must also permit the hook's bash
commands if needed.

### Success Criteria

#### Automated Verification

- `npm test` passes after settings.json edit — no regressions from the config change
- `bash -n .claude/hooks/post-edit.sh` exits 0 (syntax check)

#### Manual Verification

- Ask Claude to edit `src/middleware.ts` with a trivial change; confirm hook output
  (lint result or test result) appears in the agent's next-turn context
- Edit a non-risk `.ts` file (e.g., `src/pages/index.astro`) — lint runs, `vitest
  related` does NOT run (no test output in context)
- Edit `src/pages/api/plans/[id].ts` — both lint and `npx vitest related
  "src/pages/api/plans/[id].ts" --run` run; bracket quoting works (no "no such file"
  glob error)

**After manual verification passes, pause and confirm before Phase 2.**

---

## Phase 2: Delete-Account Error Branches

### Overview

Fix the unhandled throw at `delete-account.ts:22`, write hermetic unit tests for all
six endpoint paths in `tests/api/delete-account.r8.test.ts` (workerd pool), extend the
hook's risk-area list to include the new test file's source, and add the error-branch
sub-pattern to §6.3 of the test-plan cookbook.

### Changes Required

#### 1. Bug fix — wrap deleteUser() in try-catch

**File**: `src/pages/api/auth/delete-account.ts`

**Intent**: Wrap `await adminClient.auth.admin.deleteUser(userId)` (currently at line 22)
in a try-catch block so that an SDK throw (network error, timeout, malformed response)
returns `500 + application/json` instead of propagating to the Astro runtime and
returning an HTML error page.

**Contract**: The catch block must return the same response shape as the existing P3
error path (`status: 500`, `Content-Type: application/json`, body with an `error` key)
and should log the caught error via `console.error` for Cloudflare log-tail visibility
(matching the pattern at the current line 25).

#### 2. Hermetic unit tests

**File**: `tests/api/delete-account.r8.test.ts` (new file, workerd pool)

**Intent**: Write one test per endpoint path using `vi.hoisted()` + `vi.mock('@/lib/supabase')` following the `plans-id.r2.test.ts` reference pattern. Cover P1 (unauthenticated → 401), P2 (admin client null → 500), P3 (deleteUser returns error object → 500), P4 (deleteUser throws → 500, now catchable after the fix), P5 (signOut throws → 200, non-fatal), P6 (success → 200).

**Contract**: Mock scaffold reuses `vi.hoisted` to hoist `deleteUser`, `signOut`,
`createAdminClient`, and `createClient` spies; `vi.mock('@/lib/supabase')` returns them.
`beforeEach` resets all spies and sets the happy-path default (deleteUser resolves with
`{ error: null }`, signOut resolves). Each test overrides only what it needs.

Assert on `response.status` and `response.headers.get('Content-Type')` for every path.
For error paths, assert `body.error` is a non-empty string — do NOT assert the exact
error message text. For success paths, assert `body.success === true`.

Test stubs:
- P3: `mockState.deleteUser.mockResolvedValue({ error: new Error("...") })`
- P4: `mockState.deleteUser.mockRejectedValue(new Error("network failure"))`
(These are NOT equivalent — the distinction matters for coverage.)

#### 3. Extend hook risk-area list

**File**: `.claude/hooks/post-edit.sh`

**Intent**: Add `src/pages/api/auth/delete-account.ts` to the risk-area array so the
per-edit hook now runs `vitest related` when the endpoint is edited.

**Contract**: The risk-area list comment from Phase 1 marks exactly where this entry
goes. No other changes to the script.

#### 4. Test-plan §6.3 cookbook update

**File**: `context/foundation/test-plan.md`

**Intent**: Append an "Error-branch sub-pattern (shipped in Phase 5)" section to §6.3,
documenting the throw-vs-error-object distinction, the mock stubs for P3 and P4, the
oracle rule (assert status + Content-Type + body.error key, not the message string), and
a reference to `tests/api/delete-account.r8.test.ts`.

### Success Criteria

#### Automated Verification

- `npm test` passes (both pools)
- `npx vitest related src/pages/api/auth/delete-account.ts --run` finds and runs the
  new test file (verify count ≥ 5 test cases)
- All six paths (P1–P6) reported as passed

#### Manual Verification

- Confirm `delete-account.ts:22` is wrapped in try-catch (read the file)
- Confirm at least one test per path asserts `Content-Type: application/json`
- Confirm P3 and P4 use distinct stubs (`mockResolvedValue` vs `mockRejectedValue`)
- `npm run lint` passes (no ESLint errors in the new test file)

**After manual verification passes, pause and confirm before Phase 3.**

---

## Phase 3: Test-Plan.md Sync

### Overview

Add the two new rollout phases to `context/foundation/test-plan.md §3`, update §8
freshness, and add §6.5 cookbook for the per-edit hook pattern.

### Changes Required

#### 1. §3 Phased Rollout — two new rows

**File**: `context/foundation/test-plan.md`

**Intent**: Append Phase 4 and Phase 5 rows to the §3 status table, both marked
`complete`, both pointing to `context/changes/test-plan-refresh-2026-06-16` as the
change folder.

**Contract**:

| # | Phase name | Goal | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 4 | Per-edit hooks | Wire PostToolUse hook: lint on every edit, vitest related on risk-area file edits | R7 | Hook config + manual smoke | complete | context/changes/test-plan-refresh-2026-06-16 |
| 5 | Delete-account error branches | Fix unhandled throw; hermetic tests for all six endpoint paths | R8 | hermetic (unit, workerd pool) | complete | context/changes/test-plan-refresh-2026-06-16 |

#### 2. §5 Quality Gates — mark per-edit gate wired

**File**: `context/foundation/test-plan.md`

**Intent**: Update the per-edit row in §5 from "not yet wired" to "required — wired in
§3 Phase 4". Add a note that the hook covers lint always + vitest related for risk-area
files.

#### 3. §8 Freshness Ledger — update date

**File**: `context/foundation/test-plan.md`

**Intent**: Update "Strategy (§1–§5) last reviewed" and "Stack versions last verified"
to 2026-06-17.

#### 4. §6.5 Cookbook — per-edit hook pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Add §6.5 "Adding a risk-area file to the per-edit hook" with: the script
location (`.claude/hooks/post-edit.sh`), the risk-area array pattern, the double-quote
requirement for bracket paths, the `--run` flag requirement, and a verification step
(run `vitest related <file> --run` manually to confirm the test is found before adding
it to the list).

### Success Criteria

#### Automated Verification

- `npm test` passes (no regressions from the documentation edit)

#### Manual Verification

- test-plan.md §3 shows Phase 4 and Phase 5 rows with `complete` status
- test-plan.md §5 per-edit row says "wired" not "not yet wired"
- test-plan.md §8 freshness date is 2026-06-17
- test-plan.md §6.5 exists and is coherent

---

## References

- Research: `context/changes/test-plan-refresh-2026-06-16/research.md`
- Hook pattern: `CLAUDE.md:58–82, 99` (Lesson 3 section)
- Mock reference: `tests/api/plans-id.r2.test.ts:34–36`
- Endpoint under test: `src/pages/api/auth/delete-account.ts`
- Existing test (DB cascade only): `tests/integration/account-lifecycle.r6.test.ts`
- Workerd pool config: `vitest.config.ts:12–16`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step
> lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Per-Edit Hook

#### Automated

- [x] 1.1 `npm test` passes after settings.json edit — d9b42fc
- [x] 1.2 `bash -n .claude/hooks/post-edit.sh` exits 0 — d9b42fc

#### Manual

- [x] 1.3 Edit `src/middleware.ts` via agent — hook output visible in next-turn context — d9b42fc
- [x] 1.4 Edit a non-risk `.ts` file — lint runs, vitest does NOT run — d9b42fc
- [x] 1.5 Edit `src/pages/api/plans/[id].ts` — both lint and vitest run; no glob error — d9b42fc

### Phase 2: Delete-Account Error Branches

#### Automated

- [x] 2.1 `npm test` passes (both pools)
- [x] 2.2 `npx vitest related src/pages/api/auth/delete-account.ts --run` finds ≥5 tests
- [x] 2.3 All six paths (P1–P6) reported passed
- [x] 2.4 `npm run lint` passes on the new test file

#### Manual

- [x] 2.5 `delete-account.ts:22` is wrapped in try-catch (read the file to confirm)
- [x] 2.6 Each error path test asserts `Content-Type: application/json`
- [x] 2.7 P3 uses `mockResolvedValue({ error: ... })`, P4 uses `mockRejectedValue(...)`

### Phase 3: Test-Plan.md Sync

#### Automated

- [ ] 3.1 `npm test` passes after documentation edit

#### Manual

- [ ] 3.2 test-plan.md §3 shows Phase 4 and Phase 5 rows, both `complete`
- [ ] 3.3 test-plan.md §5 per-edit row updated to "wired"
- [ ] 3.4 test-plan.md §8 freshness date is 2026-06-17
- [ ] 3.5 test-plan.md §6.5 exists with hook cookbook pattern
