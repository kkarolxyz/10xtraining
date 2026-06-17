# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-16 (Phase 3 complete)

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
| 1 | Bootstrap + plan generation | Install vitest with Cloudflare Workers pool; prove LLM errors are caught before save; prove sparse input is rejected server-side | R1, R4 | integration (API endpoints, mocked LLM) | complete | context/changes/testing-bootstrap-plan-generation |
| 2 | Data isolation + auth boundary | Prove User A cannot reach User B's data; prove expired session is blocked and not silently passed through | R2, R3 | integration (API routes, middleware) | complete | context/changes/testing-data-isolation-auth-boundary |
| 3 | Account lifecycle + quality gates | Prove account deletion cascades completely; wire test run into CI before the build step; add test gate to pre-commit | R5 (smoke), R6 | integration (Supabase test client), CI YAML update, pre-commit hook | complete | context/changes/testing-account-lifecycle |
| 4 | Per-edit hooks | Wire PostToolUse hook: lint on every edit, vitest related on risk-area file edits | R7 | Hook config + manual smoke | complete | context/changes/test-plan-refresh-2026-06-16 |
| 5 | Delete-account error branches | Fix unhandled throw; hermetic tests for all six endpoint paths | R8 | hermetic (unit, workerd pool) | complete | context/changes/test-plan-refresh-2026-06-16 |

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
| per-edit lint + scoped tests | local (PostToolUse hook) | required — wired in §3 Phase 4 | lint errors and risk-area test failures surfaced mid-session; hook covers lint always + vitest related for risk-area files (`src/middleware.ts`, `src/lib/openrouter.ts`, `src/pages/api/plans/[id].ts`, `src/pages/api/auth/delete-account.ts`) |
| pre-commit test run | local (lint-staged) | required after §3 Phase 3 | regressions at commit time before they reach CI |
| pre-prod smoke (latency) | staging | recommended after §3 Phase 3 | environment-specific failures and 30s NFR (R5) |
| visual diff / e2e | CI on PR | not planned | excluded per §7 |

---

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding an integration test for an API endpoint

**Location**

- `tests/lib/<module>.r<N>.test.ts` — library-level tests that call the module function directly (preferred when the function has clear inputs/outputs and can be isolated with a mock).
- `tests/api/<route>.r<N>.test.ts` — HTTP handler tests via `SELF.fetch()` (use only when auth fixture complexity is worth the signal; see §3 Phase 2 for the auth boundary pattern).

**Run command**

```bash
npm test                                                   # full suite
npx vitest run tests/lib/openrouter.r1.test.ts             # single file
npx vitest run tests/lib/openrouter.r1.test.ts --reporter=verbose  # with names
```

**Naming convention**

- `describe` block: `"<risk-code> — <risk name>"` (e.g. `"R1 — LLM error handling"`)
- `it` block: one sentence naming the observable outcome, not the mechanism (e.g. `"throws when SDK returns non-JSON content"`, not `"calls JSON.parse"`)

**Mock pattern**

```typescript
// 1. Hoist mutable state so mock factories can close over it
const mockState = vi.hoisted(() => ({
  apiKey: "test-api-key",   // string inferred; set to undefined in tests that need absence
  create: vi.fn(),
}));

// 2. Mock the Astro virtual env module (module-level import in the target file)
vi.mock("astro:env/server", () => ({
  get OPENROUTER_API_KEY() { return mockState.apiKey; },
}));

// 3. Mock the OpenAI SDK at the class level — use a regular function, NOT an arrow,
//    because arrow functions cannot be called with `new`
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: mockState.create } } };
  }),
}));

// 4. Reset between tests
beforeEach(() => {
  mockState.apiKey = "test-api-key";
  mockState.create.mockReset();
});
```

**Oracle rule**

Expected values must come from the PRD acceptance criteria or from the literal error strings in the source file — never from running the code and capturing its output. A test that mirrors the implementation passes against bugs.

**Reference tests**

- `tests/lib/openrouter.r4.test.ts` — sparse-input rejection (no mock needed for the guard cases; boundary case exercises the API key check)
- `tests/lib/openrouter.r1.test.ts` — LLM error handling (SDK mock at class level, `vi.hoisted` for per-test API key control, PRD-grounded happy-path assertions)

### 6.2 Adding a data-isolation test

**Location**

`tests/api/<route>.r<N>.test.ts` — import the API route function directly; no HTTP server needed.

**Chainable Supabase query-builder mock**

The Supabase client uses a fluent builder: `.from().update().eq().eq()`. Every builder method must return the chain itself, and the chain must be thenable so `await chain` resolves without hanging.

```typescript
const mockState = vi.hoisted(() => {
  const eqSpy = vi.fn().mockReturnThis();
  const chain = {
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    eq: eqSpy,
    // then must NOT use mockReturnThis — it must actually resolve
    then(resolve: (v: { error: null; data: null }) => void, reject: (e: unknown) => void) {
      return Promise.resolve({ error: null, data: null }).then(resolve, reject);
    },
  };
  return { eqSpy, chain, createClient: vi.fn() };
});

vi.mock("@/lib/supabase", () => ({ createClient: mockState.createClient }));

beforeEach(() => {
  mockState.eqSpy.mockClear();
  mockState.createClient.mockReturnValue({ from: vi.fn(() => mockState.chain) });
});
```

**Oracle rule — assert the filter, not the response code**

Assert that `.eq("user_id", authenticatedUserId)` appears in every plan-modifying query. Do NOT use the response status code as a proxy for ownership enforcement — when the ownership filter matches 0 rows, Supabase returns `{ error: null }` and the handler returns 200 with a silent no-op (see "Known gap" below).

```typescript
expect(mockState.eqSpy).toHaveBeenCalledWith("user_id", "user-a");
```

The oracle is the PRD NFR "data isolation is absolute", not the observed handler output.

**Known gap**

When User A POSTs or DELETEs using User B's plan ID, both handlers return 200 with a silent no-op (ownership filter matches 0 rows; Supabase returns no error). This is a correctness gap, not a security issue. Tests document 200 as the oracle and assert that the filter was applied; fixing the response code is out of scope.

**Reference**

- `tests/api/plans-id.r2.test.ts` — ownership filter + unauthenticated 401 for plan update/delete handlers.

### 6.3 Adding a test for the account lifecycle

#### Auth boundary sub-pattern (shipped in Phase 2)

**Location**: `tests/lib/middleware.r3.test.ts`

**Pattern**: mock `astro:middleware` as an identity pass-through (it is a type helper, not logic), mock `@/lib/supabase` `createClient`, import `onRequest` directly, and construct a minimal context with `url`, `locals`, and a `redirect` spy.

```typescript
vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

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

**Cases to always include**:
- No session (`getUser` returns `{ data: { user: null } }`) + protected route → `redirect("/auth/signin")`
- `getUser()` throws (network failure) + protected route → `redirect("/auth/signin")` — requires the try/catch fix in `src/middleware.ts` (landed in Phase 2)
- Valid session + protected route → `next()` called, no redirect
- No session + unprotected route (e.g. `/api/…`) → `next()` called (API routes self-protect via 401)

**SSR read IDOR note** (`/plans/[id].astro`): the SSR route queries by plan ID with no app-layer `user_id` filter; isolation relies entirely on RLS. A hermetic mock cannot verify that RLS actually enforces ownership — deferred to Phase 3 with a real Supabase test project.

**Reference**: `tests/lib/middleware.r3.test.ts`

---

#### Account deletion cascade + RLS enforcement (shipped in Phase 3)

**Location**: `tests/integration/` — real-DB tests, NOT in the workerd pool.

**Why a separate pool**: `import { env } from "cloudflare:test"` fails in this project because `wrangler.jsonc:main` (`@astrojs/cloudflare/entrypoints/server`) only exists after `npm run build`. Integration tests therefore run in the **Node.js vitest pool** via `vitest.integration.config.ts`. The main `vitest.config.ts` explicitly includes only `tests/lib`, `tests/api`, and `tests/smoke`.

**Run command**

```bash
npm test                                                           # full suite (workerd + integration)
npx vitest run --config vitest.integration.config.ts               # integration only
npx vitest run --config vitest.integration.config.ts --reporter=verbose  # with test names
```

**Env var access pattern**

Credentials live in `.dev.vars`. A `globalSetup` file (`tests/integration/setup.ts`) parses `.dev.vars` at startup and writes each key into `process.env`. Inside test files:

```typescript
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";
```

Do **not** use `import { env } from "cloudflare:test"` — it fails without a built worker artifact.

**Skip guard (required on every integration describe)**

```typescript
describe.skipIf(!SUPABASE_SERVICE_ROLE_KEY)("R6 — account deletion cascade", () => {
  // ...
});
```

When `.dev.vars` is absent (CI without credentials wired), the guard skips the entire suite — no failures.

**Admin client** (service role key — bypasses RLS, can call `auth.admin.*`)

```typescript
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
```

**User B client** (authenticated as a real user — RLS uses `auth.uid()`)

A bare anon-key client has `auth.uid() = null`, which blocks reads for the wrong reason (unauthenticated, not cross-user). To test RLS isolation, User B must sign in first:

```typescript
const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const { data: signInData } = await anonClient.auth.signInWithPassword({ email, password });

const userBClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { headers: { Authorization: `Bearer ${signInData.session!.access_token}` } },
  auth: { persistSession: false },
});
```

**Cleanup pattern**

```typescript
afterAll(async () => {
  if (userAId) await adminClient.auth.admin.deleteUser(userAId).catch(() => {});f
  if (userBId) await adminClient.auth.admin.deleteUser(userBId).catch(() => {});
  // cascade removes plans rows automatically via ON DELETE CASCADE
});
```

Always wrap cleanup in `.catch(() => {})` — `afterAll` must tolerate the case where the test already deleted the user.

**Oracle rule**

Assert DB state (row count, auth error), **not** HTTP response codes:

```typescript
// R6 — cascade fired
const { data } = await adminClient.from("plans").select("id").eq("user_id", testUserId);
expect(data).toHaveLength(0);                   // cascade removed the row

// R6 — re-login rejected
const { data: authData, error } = await anonClient.auth.signInWithPassword({ ... });
expect(error).not.toBeNull();
expect(authData.user).toBeNull();

// R2 — RLS blocks cross-user read (use .select(), never .single())
const { data: rlsData, error: rlsErr } = await userBClient.from("plans").select("id").eq("id", planAId);
expect(rlsErr).toBeNull();                      // RLS returns empty, not an error code
expect(rlsData).toHaveLength(0);
```

**Reference tests**

- `tests/integration/account-lifecycle.r6.test.ts` — deletion cascade + re-login rejected
- `tests/integration/plans-read-rls.r2.test.ts` — RLS blocks cross-user plan read via authenticated User B session

#### Error-branch sub-pattern (shipped in Phase 5)

**Location**: `tests/api/delete-account.r8.test.ts` (workerd pool)

**When to use**: any endpoint that calls an external SDK method which can both return `{ error }` *and* throw. These are distinct failure modes and require distinct stubs.

**Mock scaffold** — hoist four spies, mock `@/lib/supabase`, wire happy-path defaults in `beforeEach`:

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
  // ... reset all spies ...
  mockState.deleteUser.mockResolvedValue({ error: null });   // happy-path default
  mockState.createAdminClient.mockReturnValue({
    auth: { admin: { deleteUser: mockState.deleteUser } },
  });
});
```

**P3 vs P4 stubs — not equivalent**:

```typescript
// P3: SDK resolves but signals failure in the return value
mockState.deleteUser.mockResolvedValue({ error: new Error("db error") });

// P4: SDK rejects (network failure, timeout, malformed response)
mockState.deleteUser.mockRejectedValue(new Error("network failure"));
```

P4 requires a try-catch wrapping the `await` call in the endpoint. Without it, the throw propagates to the Astro runtime and returns an HTML error page, not `application/json`. Commit the fix before the test — a permanently-red suite is harder to debug than a missing test.

**Oracle rule**: assert `response.status`, `response.headers.get("Content-Type")`, and that `body.error` is a non-empty string. Do **not** assert the exact error message text — that is an implementation detail.

```typescript
const body = (await response.json()) as { error: string };
expect(response.status).toBe(500);
expect(response.headers.get("Content-Type")).toBe("application/json");
expect(typeof body.error).toBe("string");
expect(body.error.length).toBeGreaterThan(0);
```

**Reference**: `tests/api/delete-account.r8.test.ts`

---

### 6.4 Per-rollout-phase notes

(Filled in as phases ship.)

---

### 6.5 Adding a risk-area file to the per-edit hook

**Script location**: `.claude/hooks/post-edit.sh`

The hook fires on every `Write` or `Edit` tool use (PostToolUse event in `.claude/settings.json`). It always runs `npx eslint "$FILE"`. It additionally runs `npx vitest related "$FILE" --run` when the edited file matches an entry in the `RISK_AREAS` array.

**Adding a new entry**:

1. Run `npx vitest related <file> --run` manually first to confirm the test is found and passes before adding it to the list. If `vitest related` returns 0 tests, the hook adds no signal — don't add the file.
2. Open `.claude/hooks/post-edit.sh` and append the path to the `RISK_AREAS` array:

   ```bash
   RISK_AREAS=(
     "src/middleware.ts"
     "src/lib/openrouter.ts"
     "src/pages/api/plans/[id].ts"
     "src/pages/api/auth/delete-account.ts"
     "src/your/new/file.ts"   # ← new entry
   )
   ```

3. Run `bash -n .claude/hooks/post-edit.sh` to verify syntax.

**Bracket-path quoting**: paths containing `[` or `]` (e.g. `src/pages/api/plans/[id].ts`) must appear as quoted strings in the array. The hook passes `"$FILE"` with double quotes in every command — this prevents shell glob expansion. Do not use unquoted interpolation.

**`--run` flag**: always include `--run` when calling `vitest related` from a hook. Without it, vitest enters watch mode and the hook never exits.

**`related` is a subcommand**: the correct form is `npx vitest related "$FILE" --run`, not `npx vitest --related "$FILE" --run`.

**Verification**: edit the file (or simulate with `printf '{"tool_input":{"file_path":"<path>"}}' | bash .claude/hooks/post-edit.sh`) and confirm vitest output appears alongside the lint result.

---

## 7. What We Deliberately Don't Test

Exclusions agreed during the Phase 2 interview (Q5). Future contributors
should respect these unless the underlying assumption changes.

- **UI look and feel** — visual correctness of Tailwind/React components is subjective, snapshot-fragile, and low blast-radius. Re-evaluate if a CSS regression causes a production incident. (Source: Phase 2 interview Q5.)
- **Configuration values** — env vars, wrangler config, ESLint config, Prettier config. These are validated at build time or by tool execution; testing the config itself adds noise with no signal. Re-evaluate if a misconfiguration causes a production outage. (Source: Phase 2 interview Q5.)
- **Deep infrastructure mocking** — do not replicate the Cloudflare Workers runtime, Supabase internals, or OpenRouter internals in test doubles. Use `@cloudflare/vitest-pool-workers` (real workerd) and a real Supabase test project instead. Re-evaluate if the test suite becomes flaky due to real-environment constraints. (Source: Phase 2 interview Q5; also enforces the cost × signal principle from §1.)

---

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-17
- Stack versions last verified: 2026-06-17
- AI-native tool references last verified: 2026-06-15 (none planned)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
