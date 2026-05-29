<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Auth, Generate, and Save Training Plan

- **Plan**: `context/changes/auth-generate-save/plan.md`
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: REVISE → SOUND (all findings fixed during triage)
- **Findings**: 1 critical | 1 warning | 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

8/8 paths ✓, 5/5 symbols ✓, brief↔plan ✓

Paths verified: `src/middleware.ts`, `src/pages/api/auth/signin.ts`, `src/lib/openrouter.ts`, `src/types/database.ts`, `src/lib/supabase.ts`, `src/components/Banner.astro`, `src/lib/config-status.ts`, `src/components/ui/button.tsx`. `src/pages/generate.astro` and `src/pages/plans/` confirmed not yet existing (correct — net-new files).

## Findings

### F1 — Phase 3 Progress missing "Back to Dashboard" criterion

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Progress block
- **Detail**: Phase 3 Manual Verification lists 5 criteria but Progress only has 3.3–3.6 (4 items). The "← Back to Dashboard" criterion had no matching `- [ ] 3.7` entry. `/10x-implement` would fail to validate this phase.
- **Fix**: Added `- [ ] 3.7 "← Back to Dashboard" link navigates to /dashboard` to Phase 3 Progress.
- **Decision**: FIXED

### F2 — fetch() rejections leave the form stuck in loading state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — GeneratePlanForm contract
- **Detail**: Component contract handled 2xx and non-2xx HTTP responses but not `fetch()` rejection (network drop) or `response.json()` throwing (e.g. Cloudflare 524 returning HTML). An unhandled rejection would leave `isLoading=true` forever with no error shown.
- **Fix**: Added try/catch wrapper note to GeneratePlanForm contract — catch any thrown exception, call `setError("Something went wrong — please try again")` + `setIsLoading(false)`.
- **Decision**: FIXED

### F3 — API route forwards raw LLM output as inline user error

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — generate API route catch block
- **Detail**: `generatePlan()` throws `"Failed to parse training plan JSON: [up to 200 chars of raw LLM content]"` when the model returns non-JSON. Plan forwarded `e.message` verbatim. Not an XSS risk (React text escaping) but presents garbled model output to users.
- **Fix**: Added sanitisation note to API catch block — errors starting with `"Failed to parse"` are replaced with a generic user-friendly message; sparse-input and API-key errors are forwarded as-is.
- **Decision**: FIXED
