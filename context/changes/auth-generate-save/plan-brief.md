# Auth, Generate, and Save Training Plan — Plan Brief

> Full plan: `context/changes/auth-generate-save/plan.md`

## What & Why

S-01 is the north-star slice: the shortest end-to-end path that proves the core product works. Both infrastructure prerequisites are complete (F-01: `plans` DB table + RLS; F-02: `generatePlan()` LLM client). This change builds everything on top: the three user-facing pages, the generate API endpoint, and the React form component that ties them together.

## Starting Point

Auth (sign in/up/out) is fully implemented with Supabase. The dashboard is a placeholder showing only the user's email. No plan-related pages, components, or API routes exist yet.

## Desired End State

A logged-in user can paste ride stats, pick a goal (speed or distance), wait ~10 seconds, and see a personalised 4-week training schedule saved to their account. The dashboard lists all their saved plans; each card links to the full plan detail. The entire flow is protected by the existing middleware.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Page structure | Separate `/generate` + `/dashboard` (list) + `/plans/[id]` (detail) | Clean separation of concerns; each route has one job | Plan |
| Save timing | Generate + save atomically in one API call | Fewer steps, no client state to hold between generate and save | Plan |
| Post-generate destination | Redirect to `/plans/{id}` | Plan gets full-page real estate immediately after generation | Plan |
| Loading UX | React component with fetch() + local `isLoading` state | Multi-second LLM call needs visible feedback; plain form POST shows nothing | Plan |
| Error surface | Inline error, form stays populated | User doesn't lose their pasted ride stats on retry | Plan |
| Input validation | Client-side + server-side | Instant feedback without a network round-trip for obvious errors | Plan |
| Missing API key | Disable submit + banner on `/generate` | Clear signal for the developer; user can't hit a broken endpoint | Plan |
| Sign-in redirect | `/dashboard` (was `/`) | Users enter the feature immediately after login | Plan |
| Plan naming | "Speed plan — May 2026" (goal + month-year) | Human-readable, no extra query needed, matches PRD backlog example | Plan |
| Unknown plan ID | Silent redirect to `/dashboard` | No information leak about whether an ID belongs to another user | Plan |
| Route protection | Add `/generate` and `/plans` to `PROTECTED_ROUTES` | Consistent with existing middleware pattern; one-place change | Plan |

## Scope

**In scope:**
- `/generate` page with `GeneratePlanForm.tsx` (React, fetch-based)
- `POST /api/plans/generate` — generate + save atomically, return `{ planId }`
- `/dashboard` rebuilt as plan list with empty state
- `/plans/[id]` — full 4-week schedule display with colour-coded session badges
- Sign-in redirect fix (`/` → `/dashboard`)
- Middleware route guards for `/generate` and `/plans`

**Out of scope:**
- Plan deletion (S-02), regenerate-from-list (S-03), account deletion (S-04)
- Landing page personalisation for logged-in users
- Plan editing or custom naming
- Streaming LLM responses or retry logic

## Architecture / Approach

Three Astro pages communicate through a single JSON API route. The `GeneratePlanForm.tsx` React component handles all client-side state (loading, error, validation) and calls `POST /api/plans/generate` via `fetch()`. The API route reads the authenticated user from `context.locals.user` (set by middleware), calls `generatePlan()` from `src/lib/openrouter.ts`, builds the plan name, and INSERTs via the Supabase client. On success it returns `{ planId }`; the component navigates to `/plans/{planId}`. RLS on the `plans` table enforces data isolation at the DB level — the application layer trusts it for access control.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Auth Wiring + Protected Routes | Middleware guards, sign-in redirect, stub pages — infrastructure only | Low; no new UI |
| 2. Dashboard + Generate Form + API | Core feature: list page, React form, API endpoint | LLM latency UX; first JSON-returning API route |
| 3. Plan Detail Page | Full 4-week schedule display; post-generate landing page | Layout complexity for 28 sessions |

**Prerequisites:** F-01 (`plans` table) and F-02 (`generatePlan()`) — both complete and committed.  
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- Cloudflare Workers has a 30 s CPU time limit on the free plan; the Gemini call must complete within that window — no explicit timeout added, relying on the LLM's natural response time.
- Two plans generated in the same month get identical auto-names — acceptable for MVP; user can delete and regenerate (S-02 adds deletion).
- `SubmitButton` (uses `useFormStatus`) is deliberately bypassed in favour of `Button` + local state; this is intentional and documented in Critical Implementation Details.

## Success Criteria (Summary)

- Authenticated user can generate a plan end-to-end: paste stats → loading → saved → full schedule visible
- Dashboard lists saved plans; clicking a card opens the detail page
- Sparse input and LLM errors surface as inline messages without losing the user's pasted data
