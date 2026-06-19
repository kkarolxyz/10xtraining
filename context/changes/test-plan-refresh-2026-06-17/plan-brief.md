# Test Plan Refresh 2026-06-17 — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-06-17/plan.md`
> Prior refresh: `context/changes/test-plan-refresh-2026-06-16/plan.md`

## What & Why

Wire Playwright E2E tests for the two risks without automated coverage — R5 (generation latency/feedback) and new R9 (plan disappears after page refresh) — then update `test-plan.md` to reflect the Playwright era. Triggered by: `@playwright/test` 1.61.0 installed in the working tree, CLAUDE.md updated to Lesson 4 (E2E), and §7 now reading incorrectly as "E2E: not planned."

## Starting Point

All 5 rollout phases are complete and 29 tests pass. Playwright is installed but has no config, no test directory, and no npm script. A `speed.spec.ts` seed file sits at the root testing a different project (deck app). R5 is covered only by manual smoke test. R9 (plan persistence) has zero test coverage and was just identified as a risk. R7 and R8 are referenced in §3 but missing from §2 Risk Map.

## Desired End State

`npm run test:e2e` passes two Playwright tests in Chromium: loading state visible before plan appears (R5), plan still visible after `page.reload()` (R9). A CI `e2e` job runs on every push/PR. `test-plan.md` has R7/R8/R9 in §2, Phase 6 row in §3, Playwright in §4, E2E stance corrected in §7, and §6.6 E2E cookbook added.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| E2E stance | Add Phase 6 (flip §7) | Playwright installed; R5 + R9 have no automated coverage; §7 otherwise contradicts reality | Plan |
| Risks for E2E | R5 (latency) + R9 (persistence) | R5 is the only risk still manual-only; R9 is a newly identified gap with high impact | Plan |
| seed spec disposition | Move to tests/e2e/, replace content | Structural pattern (try/finally) is correct; content tests a foreign project | Plan |
| CI scope | Add e2e job (wire into CI) | Regressions caught on every PR; E2E credentials already manageable via GitHub Secrets | Plan |
| Test pool | Real LLM + real Supabase | Mocking would defeat R5's signal; Playwright tests run against full dev server | Plan |
| Browser | Chromium only | Matches §7 "cost × signal" principle; cross-browser is not a stated risk | Plan |

## Scope

**In scope:**
- `playwright.config.ts` (webServer → npm run dev, timeout 60s, Chromium)
- `tests/e2e/generation-feedback.r5.spec.ts` — loading state + 30s plan appearance
- `tests/e2e/plan-persistence.r9.spec.ts` — plan visible after page.reload()
- `package.json` test:e2e script
- `.github/workflows/ci.yml` e2e job with .dev.vars synthesis
- `test-plan.md` §2 (R7/R8/R9), §3 (Phase 6), §4, §5, §6.6, §7, §8

**Out of scope:**
- Visual regression / snapshot tests
- Multi-browser E2E
- Pre-commit E2E gate (too slow)
- R3 E2E (already covered by Phase 2 integration tests)

## Architecture / Approach

`playwright.config.ts` uses the `webServer` option to start `npm run dev` (Astro + workerd) automatically during `npm run test:e2e`. Both E2E tests authenticate via the Supabase sign-in page with a dedicated test account, generate a real plan via OpenRouter, assert the DOM state, then clean up in a `try/finally` block. CI synthesizes `.dev.vars` from GitHub Secrets before starting the dev server.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Playwright Bootstrap | playwright.config.ts, tests/e2e/, npm script, seed relocation | Dev server URL must be verified before fixing webServer.url |
| 2. E2E Tests | generation-feedback.r5.spec.ts + plan-persistence.r9.spec.ts | Requires dedicated Supabase test account to exist |
| 3. CI Wiring | e2e job in ci.yml; .dev.vars synthesis; artifact upload | 3 new GitHub Secrets must be added manually before CI passes |
| 4. test-plan.md Sync | §2 R7/R8/R9, §3 Phase 6, §4/§5/§6.6/§7/§8 updated | None — pure documentation |

**Prerequisites:** `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` test account created in Supabase; `OPENROUTER_API_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` added as GitHub Secrets before Phase 3 CI passes.
**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- Actual dev server URL (port) must be verified — plan assumes 4321 (Astro default) but wrangler may differ
- `.dev.vars` must be synthesized in CI before the webServer starts; if wrangler ignores it or reads from process.env instead, the CI E2E step will fail to connect to Supabase
- Real LLM calls in E2E make R5/R9 tests slower and occasionally flaky; retry logic in `playwright.config.ts` (e.g. `retries: 1`) may be needed

## Success Criteria (Summary)

- `npm run test:e2e` passes 2 tests locally with real credentials; skips cleanly without them
- CI `e2e` job appears in GitHub Actions and passes on master
- `test-plan.md §3` shows 6 phases with Phase 6 `complete` after this change lands
