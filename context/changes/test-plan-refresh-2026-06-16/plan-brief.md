# Test Plan Refresh — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-06-16/plan.md`
> Research: `context/changes/test-plan-refresh-2026-06-16/research.md`

## What & Why

Wire the per-edit quality gate described in CLAUDE.md Lesson 3 (PostToolUse hook: lint
on every edit + scoped tests on risk-area files), and close the test gap found in the
delete-account endpoint (unhandled throw + zero unit tests on all error paths). Both
gaps were surfaced by the 2026-06-16 test-plan refresh run.

## Starting Point

All three original rollout phases are complete. The pre-commit Husky gate runs both
pools on staged `.ts` files. No PostToolUse hook exists yet. The delete-account endpoint
has a correctness bug (throw at line 22 propagates as HTML 500, not JSON) and is covered
only by a DB-cascade integration test that never calls the endpoint.

## Desired End State

After all three phases: every agent edit to a risk-area file triggers lint + scoped
tests before the next tool call. The delete-account endpoint is protected by hermetic
unit tests covering all six paths. `test-plan.md §3` records Phases 4 and 5 as complete;
§5 marks the per-edit gate as wired; §6.5 documents how to extend the hook.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Hook handler scope | Lint always + vitest related for risk-area files | Fullest per-edit feedback; lint is fast enough for every edit, tests stay scoped | Plan |
| Bug fix inclusion | Fix throw + test (try-catch at line 22) | Throw currently returns HTML; the fix is the precondition for the P4 test | Research |
| Test pool for R8 | Workerd pool (`tests/api/`) not integration | Enables `vitest related` to find tests from the per-edit hook | Research |
| Phase ordering | Phase 4 (hooks) before Phase 5 (tests) | Hook ships immediately for 3 files; Phase 5 extends it to 4 | Research |
| Oracle for R8 tests | Assert status + Content-Type + `body.error` key (not message string) | Message strings are implementation details; Content-Type traces to 18b9a3e fix history | Research |

## Scope

**In scope:**
- `PostToolUse` hook wired in `.claude/settings.json` via `update-config` skill
- `.claude/hooks/post-edit.sh` handler script
- Bug fix: try-catch around `deleteUser()` at `delete-account.ts:22`
- `tests/api/delete-account.r8.test.ts` — 6 hermetic unit tests (P1–P6)
- `test-plan.md` §3, §5, §6.3, §6.5, §8 updates

**Out of scope:**
- Integration tests in the Node pool
- Changes to the pre-commit Husky gate
- E2e or visual tests
- Testing the DB cascade (already covered)

## Architecture / Approach

The hook is a bash script at `.claude/hooks/post-edit.sh` that reads the edited file
path from stdin (`jq -r .tool_input.file_path`), runs `eslint "$FILE"` unconditionally,
then checks a hard-coded risk-area list and runs `vitest related "$FILE" --run` if
matched. Exit code 2 on failure routes stdout to the agent's `additionalContext`. The
R8 hermetic tests mock `@/lib/supabase` at the module level (following the
`plans-id.r2.test.ts` pattern) and stub `deleteUser` as both `mockResolvedValue({error})`
(P3) and `mockRejectedValue(thrown)` (P4) — two distinct stub types for two distinct
code paths.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Per-Edit Hook | Hook script + settings.json wiring; lint on every edit, tests on 3 risk-area files | Hook JSON schema is undocumented locally — must be inferred via update-config skill |
| 2. Delete-Account Error Branches | try-catch fix + 6 hermetic unit tests; extends hook to 4 risk-area files | P4 test depends on the bug fix landing first |
| 3. Test-Plan.md Sync | §3 Phase 4 + Phase 5 rows; §5 + §6.3 + §6.5 + §8 updated | None — pure documentation |

**Prerequisites:** test-plan-refresh-2026-06-16 change folder exists (done); existing
test suite passes (`npm test` green).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Hook JSON schema must be discovered via `update-config` skill during Phase 1; if the
  schema differs from the CLAUDE.md prose description, the wiring step may require
  iteration.
- `jq` must be available in the hook execution environment (Bash on Windows via Git
  Bash or WSL); if absent, a Python fallback is needed.
- `[id]` bracket quoting in the hook is verified during the Phase 1 smoke test; if
  quoting fails, the hook silently finds no file and exits 0 rather than running tests.

## Success Criteria (Summary)

- Editing `src/middleware.ts` in an agent turn shows lint/test output in the agent's
  next response (not just at the CI step minutes later).
- `npx vitest related src/pages/api/auth/delete-account.ts --run` reports ≥5 tests
  passing, including one that stubs `deleteUser` as a rejected promise.
- `test-plan.md §3` lists Phases 4 and 5 as `complete`.
