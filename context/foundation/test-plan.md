# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-15 (Phase 1 change opened)

---

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   \<area\>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (21 commits / 30 days).

---

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| R1 | LLM returns malformed or missing-field response → generation crashes or persists a structurally invalid plan | High | High | Interview Q1, Q3; PRD §Guardrails (no duplicate sessions, ≥1 rest day, visible load progression); PRD FR-006 |
| R2 | Logged-in User A reads, deletes, or modifies User B's plan via direct API call using a valid plan ID (IDOR) | High | Medium | PRD §NFR "data isolation is absolute"; roadmap S-02 risk note (app-layer ownership check); hot-spot dir `src/pages/api/plans` (3 commits/30d) |
| R3 | Stale or missing auth session reaches a protected route — middleware redirects fail or return 500 instead of login | High | Medium | Roadmap S-01 (largest proposed slice, untested end-to-end); hot-spot dirs `src/pages/auth` (7 commits/30d), `src/pages/api/auth` (6 commits/30d), `src/components/auth` (6 commits/30d) |
| R4 | Empty or single-ride stats are accepted by the server → LLM generates a meaningless plan with no user error shown | Medium | Medium | PRD US-01 AC ("too sparse input shows error, no silent junk output"); PRD FR-004; untrusted-input abuse lens |
| R5 | Plan generation returns no feedback when slow or failing mid-stream — user cannot distinguish loading from broken | Medium | Medium | PRD §NFR (30s user-visible response); roadmap F-02 LLM latency note; Cloudflare Workers cold-start risk |
| R6 | Account deletion partially completes — plan rows persist in the database after auth.users is deleted | High | Low | PRD FR-012 (GDPR right to erasure); roadmap S-04 risk note (must delete across all tables) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| R1 | When LLM returns bad JSON or omits required fields, the endpoint returns an error and zero plans are saved | "Happy-path JSON means all fields are always present" | LLM response schema definition, error-handling path in generation endpoint, what structural coherence means at the data layer | Integration test with mocked LLM returning bad JSON and partial responses | Oracle problem: asserting an expected value lifted from the LLM output rather than from the PRD's coherence constraints |
| R2 | User A cannot read or delete User B's plan via direct API call with a valid plan ID | "RLS at the DB layer means no app-layer ownership check is needed" | How API endpoints extract the plan ID from the request and verify ownership independently of RLS | Integration test: request User B's plan with User A's valid session token | Testing the DB RLS policy in isolation — the endpoint-level check is the real boundary |
| R3 | A request with a missing or expired session cookie to a protected route is redirected to login — not 500, not passed through | "If middleware redirects, the route handler will not execute" | Middleware session-check logic, the protected-route list in middleware.ts, how Cloudflare Workers SSR handles cookie parsing | Integration test: hit a protected endpoint with no auth cookie, with an expired token, and with a valid token | Testing only the successful-login path — the failure modes are the risk |
| R4 | Submitting empty stats or a single-ride entry to the generation endpoint returns a 4xx with user-readable guidance | "Client-side validation catches all bad input before it reaches the server" | Where server-side validation lives in the generation API handler and what it checks | Integration test: POST to generation endpoint with empty body, whitespace-only body, and single-ride body | Trusting client validation or testing only happy-path inputs |
| R5 | Generation endpoint responds (success or structured error) within 30 seconds, and the UI surfaces feedback if the response is delayed | "Streaming behaves identically in Cloudflare Workers (workerd) and Node" | Whether streaming is used, how timeout is handled in the edge runtime, workerd cold-start behavior | Manual smoke test against staging with a real LLM call — not meaningful to mock for latency | Mocking the LLM call and claiming the latency test passes |
| R6 | After the deletion API call succeeds, re-login with the same credentials is rejected and the plans table returns 0 rows for that user ID | "Deleting auth.users cascades plan rows automatically" | Deletion ordering (plans first or auth.users first), whether CASCADE is configured in the DB schema or deletion is manual | Integration test with a Supabase test client: delete account → query plans for that user ID | Asserting only that the API returns 200 without verifying that data was actually removed |

---

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status and Change folder as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Bootstrap + plan generation | Install vitest with Cloudflare Workers pool; prove LLM errors are caught before save; prove sparse input is rejected server-side | R1, R4 | integration (API endpoints, mocked LLM) | change opened | context/changes/testing-bootstrap-plan-generation |
| 2 | Data isolation + auth boundary | Prove User A cannot reach User B's data; prove expired session is blocked and not silently passed through | R2, R3 | integration (API routes, middleware) | not started | — |
| 3 | Account lifecycle + quality gates | Prove account deletion cascades completely; wire test run into CI before the build step; add test gate to pre-commit | R5 (smoke), R6 | integration (Supabase test client), CI YAML update, pre-commit hook | not started | — |

---

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:`
date so future readers can see which lines need re-verification.
Recommendations are grounded in local manifests/configs and the MCP tools
actually exposed in the current session.

| Layer | Tool | Notes |
|---|---|---|
| unit + integration | vitest + @cloudflare/vitest-pool-workers | None yet — to be installed in Phase 1; pool workers runs tests inside the workerd runtime, matching production behavior |
| LLM / fetch mocking | vi.mock or MSW fetch adapter | None yet — Phase 1 research will confirm the right approach for mocking OpenRouter calls in workerd |
| Supabase test client | @supabase/supabase-js (test project) | Phase 3 will confirm local vs. remote test project approach |
| e2e | none | Not planned; risks covered by integration layer at lower cost |
| AI-native | none | Not planned; user explicitly excluded visual and infra-heavy testing (see §7) |

**Stack grounding tools (current session):**
- Docs: none — no Context7 or framework docs MCP available in this session; checked: 2026-06-15
- Search: none — no Exa.ai or web search MCP available in this session; checked: 2026-06-15
- Runtime/browser: none — no Playwright MCP or browser tool available; checked: 2026-06-15
- Provider/platform: none — no GitHub/Cloudflare/Supabase MCP available; checked: 2026-06-15

Stack tooling versions (vitest, @cloudflare/vitest-pool-workers, MSW) must be verified by `/10x-research` in Phase 1 against the installed wrangler 4.x and vite 7.x overrides in package.json before recommending specific version pins.

---

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local + CI | required (already wired in CI) | syntactic and type drift |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions in generation and data isolation |
| pre-commit test run | local (lint-staged) | required after §3 Phase 3 | regressions at commit time before they reach CI |
| pre-prod smoke (latency) | staging | recommended after §3 Phase 3 | environment-specific failures and 30s NFR (R5) |
| visual diff / e2e | CI on PR | not planned | excluded per §7 |

---

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding an integration test for an API endpoint

TBD — see §3 Phase 1 (plan generation endpoint: mocked LLM, malformed response, sparse input rejection pattern).

### 6.2 Adding a data-isolation test

TBD — see §3 Phase 2 (ownership verification: cross-user plan access and middleware session guard pattern).

### 6.3 Adding a test for the account lifecycle

TBD — see §3 Phase 3 (account deletion cascade: Supabase test client, delete → verify no orphaned rows pattern).

### 6.4 Per-rollout-phase notes

(Filled in as phases ship.)

---

## 7. What We Deliberately Don't Test

Exclusions agreed during the Phase 2 interview (Q5). Future contributors
should respect these unless the underlying assumption changes.

- **UI look and feel** — visual correctness of Tailwind/React components is subjective, snapshot-fragile, and low blast-radius. Re-evaluate if a CSS regression causes a production incident. (Source: Phase 2 interview Q5.)
- **Configuration values** — env vars, wrangler config, ESLint config, Prettier config. These are validated at build time or by tool execution; testing the config itself adds noise with no signal. Re-evaluate if a misconfiguration causes a production outage. (Source: Phase 2 interview Q5.)
- **Deep infrastructure mocking** — do not replicate the Cloudflare Workers runtime, Supabase internals, or OpenRouter internals in test doubles. Use `@cloudflare/vitest-pool-workers` (real workerd) and a real Supabase test project instead. Re-evaluate if the test suite becomes flaky due to real-environment constraints. (Source: Phase 2 interview Q5; also enforces the cost × signal principle from §1.)

---

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-15
- Stack versions last verified: 2026-06-15 (none installed yet — Phase 1 research will pin versions)
- AI-native tool references last verified: 2026-06-15 (none planned)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
