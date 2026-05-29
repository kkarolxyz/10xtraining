# Auth, Generate, and Save Training Plan — Implementation Plan

## Overview

Build the S-01 north-star slice: three pages (`/generate` form, `/dashboard` as plan list, `/plans/[id]` detail), one API endpoint, and one React component. All auth infrastructure is already in place; this change wires the generate form, LLM call, DB save, and plan display together into a complete end-to-end user flow.

## Current State Analysis

- **Auth**: fully implemented (sign in/up/out pages + API routes). Sign-in currently redirects to `/` instead of `/dashboard`.
- **Dashboard**: placeholder page showing only user email + sign-out — no feature content.
- **Database**: `plans` table + RLS policies in place (F-01). Types `Plan`, `NewPlan`, `TrainingPlan`, `PlanGoal` exported from `src/types/database.ts`.
- **LLM**: `generatePlan(rideStats, goal): Promise<TrainingPlan>` in `src/lib/openrouter.ts` (F-02). Throws on sparse input, API failure, or invalid response.
- **Routes**: `PROTECTED_ROUTES = ["/dashboard"]` in `src/middleware.ts` — `/generate` and `/plans` not yet guarded.
- **No plan pages or API exist**: `/generate`, `/plans/[id]`, and `POST /api/plans/generate` all need to be created.

## Desired End State

After this change:
- Authenticated user visits `/dashboard` → sees their saved plans as cards, or an empty-state CTA.
- Clicks "Generate plan" → navigates to `/generate`.
- Pastes ride stats + selects goal → submits form.
- React form shows spinner and "Generating your plan…" while the LLM call runs.
- On success → redirected to `/plans/{id}` showing the full 4-week schedule.
- On error (sparse input, LLM failure) → inline error message; form stays populated.
- Sign-in redirects to `/dashboard` instead of `/`.
- `/generate` with missing `OPENROUTER_API_KEY`: submit button disabled, warning banner shown.

### Key Discoveries

- `SubmitButton` uses `useFormStatus()` — fires only on HTML form POST, not `fetch()`. Use `Button` from `@/components/ui/button` directly with local `isLoading` state.
- `FormField` wraps `<input>` only; the ride stats textarea must be built inline in `GeneratePlanForm.tsx`.
- Supabase client created per-request: `createClient(context.request.headers, context.cookies)` — same pattern as auth API routes.
- `context.locals.user` is set by middleware — no second `supabase.auth.getUser()` call needed in the API route.
- RLS on `plans` table enforces data isolation; SELECT on a non-owned plan returns 0 rows (not an error).
- `POST /api/plans/generate` returns JSON `{ planId }` — first non-redirect API route in the project.

## What We're NOT Doing

- No plan deletion (S-02)
- No regenerate-from-list flow (S-03)
- No account deletion (S-04)
- No landing page personalisation for logged-in users
- No plan editing or custom naming (FR-008, FR-010 demoted)
- No streaming LLM responses — single blocking fetch, 30 s NFR
- No retry logic on LLM failure — fail fast with inline error

## Implementation Approach

Three phases in dependency order. Phase 1 is pure infrastructure (can be committed independently). Phase 2 is the core feature. Phase 3 is the final user-facing output.

## Critical Implementation Details

**`SubmitButton` incompatible with fetch()**: that component reads `useFormStatus()`, which only activates on a native form POST. In `GeneratePlanForm.tsx`, use the base `Button` component with `disabled={isLoading}` driven by local state.

**API returns JSON, not a redirect**: `POST /api/plans/generate` returns `new Response(JSON.stringify({ planId }), { status: 200 })`. The React component reads the JSON and navigates via `window.location.href`. All existing API routes use `context.redirect()` — this is the first JSON response route in the project.

**User identity from middleware**: the API route reads `context.locals.user` (already populated by middleware before the handler runs). Still instantiates a Supabase client for the `plans` INSERT — just doesn't need to call `supabase.auth.getUser()`.

**Plan name computed server-side**: `${goal === "speed" ? "Speed" : "Distance"} plan — ${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}` — evaluated at INSERT time in the API route.

---

## Phase 1: Auth Wiring + Protected Routes

### Overview

Add `/generate` and `/plans` to `PROTECTED_ROUTES`, fix sign-in redirect to `/dashboard`, and create minimal stub pages for the two new routes so the build passes and the middleware protection can be verified before any UI is built.

### Changes Required

#### 1. Extend PROTECTED_ROUTES

**File**: `src/middleware.ts`

**Intent**: Guard `/generate` and `/plans` so unauthenticated visitors are redirected to `/auth/signin`, consistent with how `/dashboard` is protected.

**Contract**: Add `"/generate"` and `"/plans"` to the `PROTECTED_ROUTES` array. The existing `startsWith` check in the middleware means `/plans/any-id` is covered by the `"/plans"` entry.

#### 2. Fix sign-in redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: After successful sign-in, land the user on `/dashboard` so they enter the feature immediately.

**Contract**: Change the success-path `context.redirect("/")` to `context.redirect("/dashboard")`.

#### 3. Create stub /generate page

**File**: `src/pages/generate.astro`

**Intent**: Establish the route so middleware protection and build pass before the form component is built in Phase 2.

**Contract**: Minimal Astro page — imports `Layout`, renders `title="Generate Plan"` with a cosmic-style card placeholder. No form logic.

#### 4. Create stub /plans/[id] page

**File**: `src/pages/plans/[id].astro`

**Intent**: Establish the dynamic route so the Phase 2 API can redirect to `/plans/{id}` without a build error.

**Contract**: Minimal Astro page — reads `Astro.params.id`, renders it as placeholder text inside `Layout title="Plan"`. No DB query.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no errors
- `npm run build` passes

#### Manual Verification

- Signing in redirects to `/dashboard` (not `/`)
- Visiting `/generate` while logged out redirects to `/auth/signin`
- Visiting `/plans/any-uuid` while logged out redirects to `/auth/signin`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Dashboard + Generate Form + API

### Overview

Rebuild `/dashboard` as the saved-plans list. Create `GeneratePlanForm.tsx` (fetch-based React component with loading + inline-error state). Create `POST /api/plans/generate`. Replace the `/generate` stub with the wired-up form page.

### Changes Required

#### 1. Rebuild dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the placeholder with a functional plan-list page: fetch the user's plans from Supabase, render each as a linked card, show an empty-state CTA when the list is empty, and keep the sign-out button.

**Contract**:
- Server-side: `createClient(Astro.request.headers, Astro.cookies)` → `supabase.from("plans").select("*").order("created_at", { ascending: false })`.
- Each plan renders as an `<a href="/plans/{plan.id}">` card showing: `plan.name` (bold), a goal badge ("Speed" styled blue / "Distance" styled green), and `plan.created_at` formatted as a short date.
- Empty state (zero plans): message "No plans yet" + `<a href="/generate">` button.
- Sign-out form (`POST /api/auth/signout`) in a top navigation area.
- Maintain cosmic background (`bg-cosmic`) and glass-card styling consistent with existing pages.

#### 2. Create GeneratePlanForm component

**File**: `src/components/GeneratePlanForm.tsx`

**Intent**: Self-contained React component managing the full generate-plan interaction: ride stats input, goal selection, client validation, loading state during the fetch, and inline error display.

**Contract**:
- Props: `interface Props { disabled?: boolean }`. When `disabled=true`, the submit button and inputs are inert (for missing API key).
- State: `rideStats: string`, `goal: "speed" | "distance" | ""`, `isLoading: boolean`, `error: string | null`.
- Client-side guard (fires on submit before fetch): `rideStats.trim()` empty → `setError("Paste your ride stats (at least 2 rides)")`. `goal` empty → `setError("Select a training goal")`. Both abort the fetch.
- On submit (guards pass): `fetch("/api/plans/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rideStats, goal }) })`.
- 2xx response: `window.location.href = \`/plans/${data.planId}\``.
- Non-2xx response: `setError(data.error ?? "Something went wrong — please try again")`.
- Network or JSON parse error: wrap entire fetch block in `try/catch` — on any thrown exception call `setError("Something went wrong — please try again")` and `setIsLoading(false)`.
- Loading state: `isLoading=true` → textarea + radios `disabled`, submit shows spinner + "Generating your plan…".
- Uses `Button` from `@/components/ui/button` (not `SubmitButton`) with `disabled={isLoading || disabled}`.
- Ride stats field: inline `<textarea>` (not `FormField`) — rows=6, placeholder listing sample format.
- Goal field: two radio inputs (speed / distance) styled as toggle cards.
- Error displayed below submit button using the same red text style as `ServerError`.

#### 3. Wire form into /generate page

**File**: `src/pages/generate.astro`

**Intent**: Replace the stub with the real generate page: check env, pass `disabled` prop when key is absent, show a warning banner if so.

**Contract**:
- Import `OPENROUTER_API_KEY` from `"astro:env/server"`. `const keyMissing = !OPENROUTER_API_KEY`.
- If `keyMissing`: render `<Banner variant="error">` with "Plan generation is not configured — add OPENROUTER_API_KEY to your environment."
- Render `<GeneratePlanForm disabled={keyMissing} client:load />` inside the page.

#### 4. Create generate API route

**File**: `src/pages/api/plans/generate.ts`

**Intent**: Accept a JSON POST, call `generatePlan()`, save the plan to Supabase, and return the new plan's ID for the client to redirect to.

**Contract**:
- Export `POST: APIRoute` only.
- Parse body: `const { rideStats, goal } = await context.request.json()`.
- Guard: `!context.locals.user` → `new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 })`.
- Call `generatePlan(rideStats, goal as PlanGoal)`. Wrap in `try/catch`: on Error, sanitise the message before returning — if `e.message` starts with `"Failed to parse"` substitute `"The AI returned an unexpected response — please try again"` (raw LLM output is not user-friendly); otherwise forward `e.message` as-is. Return `new Response(JSON.stringify({ error: sanitisedMessage }), { status: 422 })`.
- Build name: `${goal === "speed" ? "Speed" : "Distance"} plan — ${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}`.
- `createClient(context.request.headers, context.cookies)` → `supabase.from("plans").insert({ user_id: context.locals.user.id, name, goal, ride_stats: rideStats, plan: planData }).select("id").single()`.
- DB error → `new Response(JSON.stringify({ error: "Failed to save plan" }), { status: 500 })`.
- Success → `new Response(JSON.stringify({ planId: data.id }), { status: 200, headers: { "Content-Type": "application/json" } })`.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- `/dashboard` shows empty state with "Generate plan" CTA when no plans saved
- `/generate` renders the form correctly
- Submitting empty ride stats shows inline error without an API call
- Submitting valid stats + goal: loading spinner visible, then redirected to `/plans/{id}` (stub shows the id)
- Plan card appears in `/dashboard` list after generation
- Removing `OPENROUTER_API_KEY` from `.dev.vars` and restarting dev server: submit button disabled, banner visible

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Plan Detail Page

### Overview

Replace the `/plans/[id]` stub with a full plan-detail page that fetches the plan by ID (RLS enforced), silently redirects to `/dashboard` if not found, and renders the complete 4-week training schedule.

### Changes Required

#### 1. Build plan detail page

**File**: `src/pages/plans/[id].astro`

**Intent**: Show the complete training plan. Silently redirect to `/dashboard` if the plan doesn't exist or belongs to another user.

**Contract**:
- `const { id } = Astro.params`.
- `createClient(Astro.request.headers, Astro.cookies)` → `supabase.from("plans").select("*").eq("id", id).single()`.
- `!data` or Supabase error → `return Astro.redirect("/dashboard")`.
- Page header: `plan.name` as `<h1>`, goal badge (Speed = blue, Distance = green), `plan.created_at` formatted as a readable date.
- Week layout: one card per `TrainingWeek` (4 total) with `week.focus` as the card title and `"Week {week.week}"` label.
- Day rows inside each week card: day name, session type badge (rest=gray, interval=red, threshold=orange, endurance=green, recovery=teal, strength=purple), `session.duration_min` (shown as "Rest" when 0), `session.description`.
- Back link: `← Back to Dashboard` → `/dashboard`.
- Maintain cosmic background and glass-card styling.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- After generating a plan, `/plans/{id}` shows 4 week cards, each with 7 day rows
- Session type badges are color-coded correctly
- Accessing `/plans/00000000-0000-0000-0000-000000000000` redirects to `/dashboard`
- Plan name, goal badge, and creation date display correctly
- "← Back to Dashboard" link navigates to `/dashboard`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before committing.

---

## Testing Strategy

### Manual Testing Steps

1. Sign up a fresh account → verify sign-in redirects to `/dashboard`
2. Dashboard shows empty state with "Generate plan" CTA
3. Click CTA → `/generate` renders with textarea, goal selection, and submit button
4. Submit with empty stats → inline error appears, no network request made
5. Submit valid stats + goal → loading state visible for several seconds → redirect to `/plans/{id}`
6. Plan detail shows 4 week cards × 7 day rows, session badges color-coded
7. Navigate back → `/dashboard` shows one plan card with correct name, badge, date
8. Click card → returns to same plan detail
9. Remove `OPENROUTER_API_KEY`, restart dev server → `/generate` button disabled with banner

## References

- Roadmap S-01: `context/foundation/roadmap.md`
- PRD refs: US-01, FR-001 through FR-007, FR-009
- Supabase client pattern: `src/lib/supabase.ts`
- Auth API route pattern: `src/pages/api/auth/signin.ts`
- Button + FormField components: `src/components/auth/`, `src/components/ui/`
- Existing types: `src/types/database.ts`
- AI client: `src/lib/openrouter.ts`
- Config status + Banner: `src/lib/config-status.ts`, `src/components/Banner.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth Wiring + Protected Routes

#### Automated

- [x] 1.1 `npm run lint` passes — ce2db32
- [x] 1.2 `npm run build` passes — ce2db32

#### Manual

- [x] 1.3 Sign-in redirects to `/dashboard` — ce2db32
- [x] 1.4 `/generate` unauthenticated → redirects to `/auth/signin` — ce2db32
- [x] 1.5 `/plans/any-uuid` unauthenticated → redirects to `/auth/signin` — ce2db32

### Phase 2: Dashboard + Generate Form + API

#### Automated

- [x] 2.1 `npm run lint` passes — c168674
- [x] 2.2 `npm run build` passes — c168674

#### Manual

- [x] 2.3 Dashboard shows empty state with "Generate plan" CTA — c168674
- [x] 2.4 Empty stats input shows inline error without API call — c168674
- [x] 2.5 Valid submit: loading state visible, redirects to `/plans/{id}` — c168674
- [x] 2.6 Plan appears in dashboard list after generation — c168674
- [x] 2.7 Missing `OPENROUTER_API_KEY` disables submit with banner — c168674

### Phase 3: Plan Detail Page

#### Automated

- [x] 3.1 `npm run lint` passes
- [x] 3.2 `npm run build` passes

#### Manual

- [x] 3.3 Plan detail shows 4 week cards × 7 day rows each
- [x] 3.4 Session type badges are color-coded correctly
- [x] 3.5 `/plans/nonexistent-id` redirects to `/dashboard`
- [x] 3.6 Plan name, goal badge, and creation date display correctly
- [x] 3.7 "← Back to Dashboard" link navigates to `/dashboard`
