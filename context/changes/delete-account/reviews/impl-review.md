<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delete Account Implementation Plan

- **Plan**: context/changes/delete-account/plan.md
- **Scope**: All phases (1–5)
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical | 2 warnings | 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Unplanned Topbar hoisting on dashboard and plans pages

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/dashboard.astro, src/pages/plans/[id].astro
- **Detail**: Phase 5 plan listed only Topbar.astro and index.astro. During implementation, dashboard.astro and plans/[id].astro were also modified to hoist `<Topbar />` above the max-w container and remove dashboard's inline sign-out. Changes are correct and serve the plan's stated intent ("visible path to /account from any protected page") but are undocumented.
- **Fix**: Accept as implemented scope — changes are benign and directly serve the plan's goal. No code change needed.
- **Decision**: ACCEPTED

### F2 — No server-side error logging when deleteUser fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/delete-account.ts:16
- **Detail**: When `adminClient.auth.admin.deleteUser(userId)` returns an error, the handler returns 500 but logs nothing. On Cloudflare Workers, `console.error()` feeds the log tail — without it, debugging real failures requires guesswork.
- **Fix**: Added `console.error("deleteUser failed:", error)` before the early return.
- **Decision**: FIXED

### F3 — CSRF defence-in-depth on DELETE endpoint

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/delete-account.ts:4
- **Detail**: HTML forms can't fire DELETE so classic CSRF doesn't apply. However, a cross-origin `fetch()` with `method: "DELETE"` would succeed if the session cookie is SameSite=None (Supabase's default). This is higher-stakes than plan-deletion since it's irreversible. The existing `/api/plans/[id]` DELETE has the same posture — consistent gap across the API.
- **Fix**: Accept risk for now — consistent with existing API posture. Cross-cutting hardening (Origin check or switch to POST) is out of scope for this feature.
- **Decision**: SKIPPED

### F4 — Error responses missing Content-Type header

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/delete-account.ts:6, 13, 18
- **Detail**: The 401 and 500 error responses did not set `Content-Type: application/json`, while the 200 success response did. `DeleteAccountButton` calls `res.json()` on non-ok responses — works in practice but inconsistent.
- **Fix**: Added `headers: { "Content-Type": "application/json" }` to all three error Response constructors.
- **Decision**: FIXED

### F5 — Missing typed response interface in DeleteAccountButton

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/DeleteAccountButton.tsx:31
- **Detail**: `res.json()` is cast inline as `{ error?: string }`. `DeletePlanButton` (the reference component) defines a named `interface DeleteResponse` for the same purpose.
- **Fix**: Not applied — inline cast is clear enough for this context.
- **Decision**: SKIPPED
