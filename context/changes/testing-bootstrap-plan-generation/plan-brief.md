# Bootstrap + Plan Generation Tests — Plan Brief

> Full plan: `context/changes/testing-bootstrap-plan-generation/plan.md`
> Research: `context/changes/testing-bootstrap-plan-generation/research.md`

## What & Why

Install vitest configured for Cloudflare Workers (workerd) and write the project's first
integration tests covering two confirmed risks: R1 (LLM bad response persists an invalid
plan) and R4 (sparse user input silently accepted → meaningless plan). This is rollout
Phase 1 of `context/foundation/test-plan.md` — it establishes the test runner and the
first risk coverage before later phases add data-isolation and account-lifecycle tests.

## Starting Point

No test runner, no test files, no test config exist anywhere in the project. The
`generatePlan()` function in `src/lib/openrouter.ts` is the single server-side
enforcement point for both risks. The stack (vite 7.3.3, `nodejs_compat` flag already
in `wrangler.jsonc`) is compatible with vitest + `@cloudflare/vitest-pool-workers`;
wrangler needs a minor bump from 4.90.0 → 4.100.0.

## Desired End State

`npm test` runs a vitest suite in the real workerd runtime and exits green. CI runs
`npm test` before `npm run build`. Tests prove: (1) empty and single-ride input throw
with user-readable guidance; (2) non-JSON and missing-`weeks` LLM responses throw with
the correct internal message (which the API handler maps to 422); (3) a well-formed LLM
response returns a valid plan. `test-plan.md §6.1` documents the concrete test pattern.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Test target | `generatePlan()` directly, not HTTP endpoint | Auth fixture complexity (middleware, Supabase session) belongs in Phase 2; 422 mapping is a trivial try/catch verifiable by inspection | Research + Plan |
| LLM mock layer | `vi.mock('openai', ...)` at SDK level | Exercises the real `JSON.parse` + `weeks` check in `openrouter.ts`; avoids MSW workerd compatibility uncertainty | Plan |
| R1 structural depth | Test existing caught paths only (bad JSON, missing `weeks`) | PRD guardrail gap is known but adding Zod is out of scope for Phase 1 — documented explicitly | Plan |
| Implementation mode | `/10x-tdd` for R4 and R1 phases | Both have nameable red tests before any code is written; satisfies Lesson 2's oracle-first discipline | Plan |
| Test file location | `tests/` at project root | Separates integration tests from `src/` application code; matches pool-workers convention | Plan |
| Error message oracle | Internal `generatePlan()` messages, not user-facing | Phase 1 calls `generatePlan()` directly; sanitization (Failed to parse → generic) happens in the API handler layer above | Research + Plan |

## Scope

**In scope:**
- Upgrade wrangler 4.90.0 → 4.100.0
- Install vitest + @cloudflare/vitest-pool-workers
- `vitest.config.ts` with defineWorkersConfig, path alias, wrangler config path
- Smoke test (Phase 1 infra proof)
- R4 tests: empty, whitespace, single-line, and boundary (2 lines) inputs
- R1 tests: non-JSON response, missing `weeks`, empty choices, missing API key, happy path
- Wire CI: `npm test` before `npm run build`
- Cookbook §6.1 fill-in

**Out of scope:**
- HTTP endpoint testing via `SELF.fetch()` (deferred to Phase 2)
- Zod structural validation for PRD guardrails (documented gap)
- `goal` field validation gap (invalid goal → 500; deferred)
- Regenerate endpoint tests (covered transitively by `generatePlan` tests)

## Architecture / Approach

Tests import `generatePlan` from `@/lib/openrouter` and call it directly. For R4, no
mock is needed — the sparse-input guard throws before the OpenAI client is constructed.
For R1, `vi.mock('openai', ...)` replaces the OpenAI class at the module level so
`chat.completions.create()` returns a controlled response; `openrouter.ts` then runs
the real `JSON.parse`, markdown fence stripping, and `weeks` array check on that
response. The error messages asserted in tests come from the PRD and the literal source
strings, never from reading the implementation output.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Vitest + workerd env | `npm test` green in CI, smoke test passes | wrangler peer-dep warning if upgrade order is wrong; `vi.mock` hoisting in workerd unconfirmed until run |
| 2. R4 sparse input tests | 4 green tests proving server-side input guard | Boundary case (2 lines) needs a mock/env setup to stop before network call |
| 3. R1 LLM error tests | 5 green tests proving error catch + happy-path structural return | `vi.mock('openai', ...)` hoisting must work in workerd; happy-path oracle must be PRD-sourced, not implementation-copied |
| 4. Cookbook + plan sync | §6.1 filled, §3 Phase 1 marked complete | None |

**Prerequisites:** wrangler upgraded before vitest install; `OPENROUTER_API_KEY` env
handling in workerd test env resolved before Phase 3.

**Estimated effort:** ~2 sessions across 4 phases; Phase 1 and 4 are `implement`; 2 and
3 are `tdd`.

## Open Risks & Assumptions

- `vi.mock('openai', ...)` hoisting behaviour in workerd is unconfirmed. If it does not
  work, fallback is `vi.mock('@/lib/openrouter')` with documented signal reduction.
- `OPENROUTER_API_KEY` access path in `generatePlan()` (Astro env module vs raw binding
  vs process.env) determines how to control it per-test. Resolve in Phase 3 before
  writing the missing-API-key test.
- Wrangler 4.90 → 4.100 is a minor bump; unlikely to break anything, but check the
  changelog before committing.

## Success Criteria (Summary)

- `npm test` exits 0 in CI with all R4 and R1 tests green
- No `expect` value in the test suite was derived from reading the implementation
- `test-plan.md §6.1` is a self-contained guide a new contributor can follow to add a
  test for a new endpoint
