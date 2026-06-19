# Test Plan Refresh 2026-06-17 Implementation Plan

## Overview

Update `context/foundation/test-plan.md` for the Playwright era: backfill risks R7/R8 into §2 (referenced in §3 but never defined), surface new R9 (plan persistence after reload), add Phase 6 (E2E for R5 + R9), scaffold Playwright infrastructure, write the two E2E tests, wire CI, and sync all affected test-plan sections.

## Current State Analysis

- All 5 rollout phases complete; 29 tests pass across workerd + integration pools
- `@playwright/test` 1.61.0 installed but unconfigured — no `playwright.config.ts`, no `tests/e2e/`
- `speed.spec.ts` at the repo root is a 10xDevs course seed for a deck/flashcard app; content is entirely wrong for this project but the structural pattern (try/finally, Arrange + Act + Assert + cleanup) is correct
- `.gitignore` already has `playwright/.auth/` (added when Playwright was installed)
- `test-plan.md §2` does not define R7 or R8 even though §3 Phase 4 and Phase 5 rows reference them
- `test-plan.md §4` still lists "e2e: none — Not planned"; §7 blanket-excludes E2E

### Key Discoveries

- `npm run dev` is `astro dev` which uses `@astrojs/cloudflare` and starts on port 4321 (Astro default, even with workerd under the hood) — implementation must verify the actual port before fixing the playwright.config.ts `webServer.url`
- Wrangler reads env vars from `.dev.vars` at startup; CI does not have a `.dev.vars` file, so the CI E2E job must synthesize one from secrets before starting the dev server
- CI already has `SUPABASE_URL` and `SUPABASE_KEY`; `OPENROUTER_API_KEY`, `E2E_TEST_EMAIL`, and `E2E_TEST_PASSWORD` must be added as new GitHub Secrets
- A dedicated Supabase test account must exist before the Phase 2 tests can pass

## Desired End State

After all four phases:
- `playwright.config.ts` starts the dev server and runs `tests/e2e/*.spec.ts` against it
- `npm run test:e2e` passes: loading state visible before plan appears (R5), plan still present after page.reload() (R9)
- CI has an `e2e` job that passes on every push/PR to master
- `test-plan.md §2` defines R7, R8, R9; §3 has Phase 6 as `pending` (flips to `complete` when this change lands); §4, §5, §6.6, §7, §8 updated

## What We're NOT Doing

- Visual regression or snapshot tests (§7 visual-UI exclusion remains)
- Multi-browser E2E (Chromium only)
- Playwright MCP / browser-control automation (separate tool category)
- R3 E2E (auth redirect already well-covered by Phase 2 integration tests)
- Adding E2E to the pre-commit gate (too slow for commit time)
- Deep infra mocking (§7 exclusion remains)

## Implementation Approach

Four phases in dependency order: configure Playwright first (Phase 1), write tests second (Phase 2), wire CI third (Phase 3), document last (Phase 4). CI job depends on tests that pass locally, so phases must execute in sequence.

## Critical Implementation Details

**Dev server port**: run `npm run dev` locally and confirm the port before setting `playwright.config.ts webServer.url`. Port 4321 is the Astro default but may differ if `wrangler.jsonc` overrides it.

**`.dev.vars` in CI**: Playwright's `webServer` inherits the CI shell environment but wrangler reads secrets from `.dev.vars`, not from process.env. The CI job must write `.dev.vars` before `npm run test:e2e` runs.

**E2E test account**: a dedicated Supabase account (`E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`) must be created manually before Phase 2 tests pass. Phase 2 tests use `test.skip` guards so missing credentials produce a skip, not a failure.

---

## Phase 1: Playwright Bootstrap

### Overview

Create `playwright.config.ts`, add the `test:e2e` npm script, create `tests/e2e/`, relocate `speed.spec.ts`, and add output dirs to `.gitignore`.

### Changes Required

#### 1. Playwright configuration

**File**: `playwright.config.ts`

**Intent**: Create the root-level config that wires Playwright to `tests/e2e/`, starts the dev server automatically, and sets a generous timeout for LLM-driven tests.

**Contract**: Must define `testDir: './tests/e2e'`, `timeout: 60_000`, `use.baseURL` pointing at the dev server (verify the actual URL first), `webServer.command: 'npm run dev'`, `webServer.reuseExistingServer: !process.env.CI`, and a single `chromium` project. No other browsers.

#### 2. npm test:e2e script

**File**: `package.json`

**Intent**: Add `"test:e2e": "playwright test"` to the scripts block so CI and the cookbook can reference a stable command name.

**Contract**: Script name must be `test:e2e` — the CI job uses it verbatim.

#### 3. Relocate seed test

**File**: delete `speed.spec.ts`, create `tests/e2e/plan-persistence.r9.spec.ts`

**Intent**: Move the course seed into `tests/e2e/` under the project naming convention. The R9 test body will be written in Phase 2; for now the file can be an empty describe block so `playwright test --list` finds it.

**Contract**: `tests/e2e/plan-persistence.r9.spec.ts` must exist. `speed.spec.ts` must no longer exist at the root (Playwright may pick it up via glob otherwise).

#### 4. .gitignore additions

**File**: `.gitignore`

**Intent**: Suppress Playwright's default output directories so they are not accidentally committed.

**Contract**: Add `playwright-report/` and `test-results/` as separate lines.

### Success Criteria

#### Automated Verification

- `npx playwright test --list` exits 0 and lists `tests/e2e/plan-persistence.r9.spec.ts`
- `npm run test:e2e` starts without crashing during Playwright setup phase

#### Manual Verification

- `npm run dev` prints a URL — confirm `playwright.config.ts webServer.url` matches it exactly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the dev server URL is correct before proceeding.

---

## Phase 2: E2E Tests for R5 + R9

### Overview

Write two E2E tests that require real Supabase auth and real OpenRouter LLM calls. Each test is independent and cleans up its own data.

### Changes Required

#### 1. R5 — generation feedback test

**File**: `tests/e2e/generation-feedback.r5.spec.ts`

**Intent**: Prove the UI surfaces a visible loading/processing state immediately after the user submits the generation form, and that a plan result appears within 30 seconds. A real LLM call is required — mocking the LLM would defeat R5's signal.

**Contract**:
- `describe` block: `"R5 — generation feedback and latency"`
- `it` block: `"shows loading state then plan within 30 s"`
- `test.skip(!process.env.E2E_TEST_EMAIL, 'E2E credentials not set')` at the describe level
- Auth: `page.goto('/auth/signin')` → fill email/password → submit → `page.waitForURL('/dashboard')`
- Navigate to generate form, fill with valid cycling stats (e.g. 5 rides, 8 h total, 25 km/h avg, 500 m elevation, goal: speed)
- Submit → immediately assert a loading indicator is visible (use `getByRole` or `getByText` for the loading element, NOT CSS selectors)
- Assert plan heading/result area is visible within 30 s: `await expect(planElement).toBeVisible({ timeout: 30_000 })`
- Cleanup in `finally`: navigate to `/dashboard`, for each visible delete button click → confirm

#### 2. R9 — plan persistence test

**File**: `tests/e2e/plan-persistence.r9.spec.ts` (body replaces the empty skeleton from Phase 1)

**Intent**: Prove that a generated plan survives a page reload — it was persisted to the database, not just held in React state.

**Contract**:
- `describe` block: `"R9 — plan persists after page reload"`
- `it` block: `"generated plan is still visible after page.reload()"`
- Same auth + generate setup as R5 (each test is independent)
- After plan heading is visible: `await page.reload()`
- Assert the same plan heading is visible after reload (no timeout override needed — DOM check only)
- Cleanup in `finally`: same delete flow as R5

### Success Criteria

#### Automated Verification

- `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` set → `npm run test:e2e` reports 2 tests passing
- Credentials absent → 2 tests skipped, not failed

#### Manual Verification

- Loading state is visibly present (spinner, progress text, or similar) before the plan appears
- After `page.reload()`, the plan content matches what was generated — not an empty state or a different plan

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: CI Wiring

### Overview

Add an `e2e` job to `.github/workflows/ci.yml` that depends on the existing `ci` job, synthesizes `.dev.vars`, installs Playwright browsers, and runs the E2E suite.

### Changes Required

#### 1. CI E2E job

**File**: `.github/workflows/ci.yml`

**Intent**: Add the `e2e` job after `ci` so E2E only runs when lint + build + unit/integration tests all pass. The job must create `.dev.vars` from secrets (wrangler requirement), install only Chromium, and upload the HTML report on failure for debugging.

**Contract**: New top-level job named `e2e`:

```yaml
e2e:
  needs: ci
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: npm }
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - name: Create .dev.vars
      run: |
        echo "SUPABASE_URL=${{ secrets.SUPABASE_URL }}" >> .dev.vars
        echo "SUPABASE_KEY=${{ secrets.SUPABASE_KEY }}" >> .dev.vars
        echo "OPENROUTER_API_KEY=${{ secrets.OPENROUTER_API_KEY }}" >> .dev.vars
    - run: npm run test:e2e
      env:
        E2E_TEST_EMAIL: ${{ secrets.E2E_TEST_EMAIL }}
        E2E_TEST_PASSWORD: ${{ secrets.E2E_TEST_PASSWORD }}
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 7
```

#### 2. New GitHub Secrets (manual prerequisite)

Before the CI job can pass, three new secrets must be added in GitHub repo Settings → Secrets and variables → Actions:

- `OPENROUTER_API_KEY` — the existing OpenRouter API key
- `E2E_TEST_EMAIL` — email of a dedicated Supabase test account
- `E2E_TEST_PASSWORD` — password for that account

The test account must exist in the Supabase project before the CI `e2e` job produces green results.

### Success Criteria

#### Automated Verification

- CI pipeline shows three jobs on a PR: `ci`, `e2e`, `deploy` (deploy is master-only but `e2e` runs on PRs)
- `e2e` job exits 0 with 2 tests passing when secrets are wired

#### Manual Verification

- On a PR: `e2e` job appears in the GitHub Actions checks list alongside `ci`
- On a failure: `playwright-report` artifact is downloadable from the Actions run summary
- Three new secrets visible in repo Settings (values not visible, but names should show)

**Implementation Note**: The three new GitHub Secrets and the dedicated test account must exist before the CI job can pass. These are manual steps — confirm they are done before running CI.

---

## Phase 4: test-plan.md Sync

### Overview

Update all affected sections of `context/foundation/test-plan.md` to reflect the Playwright era.

### Changes Required

#### 1. §2 Risk Map — add R7, R8, R9

**File**: `context/foundation/test-plan.md`

**Intent**: R7 and R8 are currently referenced in §3 but absent from §2. R9 is the new persistence risk. Add all three rows to the risk map table and the risk response guidance table.

**Contract**: Append after the R6 row in both the risk map table and the risk response guidance table:

- **R7**: Agent edits a risk-area source file → per-edit hook does not fire (misconfigured matcher or missing `jq`) → lint/test feedback is silently skipped mid-session | Impact: Medium | Likelihood: Low | Source: Phase 4 review; configuration risk for hook infra
- **R8**: `deleteUser()` SDK call throws (network failure, timeout) → unhandled throw propagates to Astro runtime → endpoint returns HTML 500 instead of `application/json`, breaking any client expecting JSON | Impact: Medium | Likelihood: Low | Source: Phase 5 code review; `delete-account.ts` lacked try-catch
- **R9**: Plan record not persisted to DB, or SSR page query fails on reload → user sees their generated plan disappear on page refresh, destroying core product value | Impact: High | Likelihood: Medium | Source: Phase 6 planning session; S-01 core scenario not yet validated end-to-end

#### 2. §3 Phased Rollout — add Phase 6

**File**: `context/foundation/test-plan.md`

**Intent**: Append the Phase 6 row to the rollout table.

**Contract**: Append after the Phase 5 row:
```
| 6 | E2E generation + persistence | Playwright tests against local dev server (real LLM + real Supabase): loading feedback visible (R5), plan survives page reload (R9) | R5, R9 | e2e (Playwright, Chromium, real LLM, real Supabase) | pending | context/changes/test-plan-refresh-2026-06-17 |
```

#### 3. §4 Stack — update e2e row

**File**: `context/foundation/test-plan.md`

**Intent**: Replace "e2e: none" with the Playwright entry.

**Contract**: Replace the `e2e` row:
```
| e2e | @playwright/test 1.61.0 | Phase 6; Chromium only; webServer starts npm run dev (workerd/wrangler); .dev.vars required for secrets; test account via E2E_TEST_EMAIL/PASSWORD env vars |
```

#### 4. §5 Quality Gates — add E2E gate

**File**: `context/foundation/test-plan.md`

**Intent**: Record E2E as a quality gate required after Phase 6.

**Contract**: Append after the pre-prod smoke row:
```
| e2e (Playwright) | local + CI | required after §3 Phase 6 | browser-level state and timing regressions (R5 latency, R9 persistence) |
```

#### 5. §6.6 Cookbook — Adding an E2E test

**File**: `context/foundation/test-plan.md`

**Intent**: Document the E2E pattern so future contributors do not have to reverse-engineer the existing tests.

**Contract**: New subsection `### 6.6 Adding an E2E test` covering:
- Location: `tests/e2e/<risk>.<rN>.spec.ts`
- Run commands: `npm run test:e2e` / `npx playwright test tests/e2e/foo.spec.ts`
- Auth pattern: `page.goto('/auth/signin')` → fill → submit → `waitForURL('/dashboard')`
- Skip guard: `test.skip(!process.env.E2E_TEST_EMAIL, 'E2E credentials not set')` at describe level
- try/finally cleanup: navigate dashboard → delete each plan via UI
- Reference tests: `generation-feedback.r5.spec.ts`, `plan-persistence.r9.spec.ts`
- Oracle rule: assert visible DOM state and URL, not response codes

#### 6. §7 Deliberate Exclusions — narrow E2E exclusion

**File**: `context/foundation/test-plan.md`

**Intent**: Remove the blanket E2E exclusion; replace with the narrower visual-only exclusion.

**Contract**: Replace the E2E bullet: "**Browser UI look and feel** — visual correctness of Tailwind/React layout, z-index, and animation is subjective and snapshot-fragile. Functional E2E tests (R5, R9) are now planned and in Phase 6; purely visual assertions (pixel diffs, CSS layout) remain excluded."

#### 7. §8 Freshness Ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Update review dates.

**Contract**: Set "Strategy (§1–§5) last reviewed" and "Stack versions last verified" to `2026-06-17`.

### Success Criteria

#### Automated Verification

- `grep -c "R9" context/foundation/test-plan.md` returns ≥ 3
- §3 table has exactly 6 phase rows
- Phase 6 status in §3 is `pending`

#### Manual Verification

- §2 Risk Map has rows for R7, R8, R9 with descriptions that match the actual failures
- §7 no longer says "Not planned" for E2E; visual/snapshot testing remains excluded

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the test-plan.md reads correctly end-to-end.

---

## Testing Strategy

### E2E Run Commands

```bash
npm run test:e2e                                           # full E2E suite
npx playwright test tests/e2e/generation-feedback.r5.spec.ts  # R5 only
npx playwright test tests/e2e/plan-persistence.r9.spec.ts     # R9 only
npx playwright test --ui                                   # interactive UI mode
```

### Manual Testing Steps

1. Run `npm run dev` and note the URL — verify it matches `playwright.config.ts webServer.url`
2. Set `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` in the local shell
3. Run `npm run test:e2e` — confirm 2 tests pass and no plan rows are left behind
4. Unset `E2E_TEST_EMAIL` — run again → confirm 2 tests skip
5. Push to a branch → confirm `e2e` job appears in GitHub Actions checks

## Migration Notes

- `speed.spec.ts` must not exist at the repo root after Phase 1 — if left there alongside `playwright.config.ts`, Playwright may pick it up outside `testDir` depending on config
- The three GitHub Secrets and the Supabase test account are manual prerequisites; the CI job will skip tests (not fail) if `E2E_TEST_EMAIL` is unset, but the job itself must be able to start the dev server (needs `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` in `.dev.vars`)

## References

- Seed pattern: `speed.spec.ts` (to be deleted in Phase 1)
- Prior refresh plan: `context/changes/test-plan-refresh-2026-06-16/plan.md`
- Test plan: `context/foundation/test-plan.md`
- CI workflow: `.github/workflows/ci.yml`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Playwright Bootstrap

#### Automated

- [x] 1.1 `npx playwright test --list` exits 0 and lists `tests/e2e/plan-persistence.r9.spec.ts` — a88679d
- [x] 1.2 `npm run test:e2e` starts without crashing during setup — a88679d

#### Manual

- [x] 1.3 Dev server URL in playwright.config.ts matches actual URL from `npm run dev` — a88679d

### Phase 2: E2E Tests for R5 + R9

#### Automated

- [x] 2.1 E2E credentials set → `npm run test:e2e` reports 2 tests passing
- [x] 2.2 Credentials absent → 2 tests skipped, not failed

#### Manual

- [x] 2.3 Loading state is visibly present before plan appears
- [x] 2.4 Plan content matches after `page.reload()` — not empty state

### Phase 3: CI Wiring

#### Automated

- [ ] 3.1 CI pipeline shows `e2e` job on PR alongside `ci`
- [ ] 3.2 `e2e` CI job passes with 2 tests passing

#### Manual

- [ ] 3.3 `playwright-report` artifact downloadable on CI failure
- [ ] 3.4 Three new GitHub Secrets added: `OPENROUTER_API_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`
- [ ] 3.5 Dedicated Supabase test account created and verified

### Phase 4: test-plan.md Sync

#### Automated

- [ ] 4.1 `grep -c "R9" context/foundation/test-plan.md` returns ≥ 3
- [ ] 4.2 §3 table has exactly 6 phase rows
- [ ] 4.3 Phase 6 status is `pending`

#### Manual

- [ ] 4.4 §2 Risk Map has R7, R8, R9 with meaningful descriptions
- [ ] 4.5 §7 no longer excludes all E2E; visual exclusion remains
