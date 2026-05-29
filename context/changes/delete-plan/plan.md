# Delete Plan — Implementation Plan

## Overview

Add the ability to delete a saved training plan. The delete button appears on both the dashboard plan list and the plan detail page. Deletion is immediate and irreversible (no confirmation dialog in MVP). Implements S-02 / FR-011.

## Current State Analysis

- `dashboard.astro` fetches and renders plans as full `<a>` wrapper cards — each card is a single clickable element navigating to `/plans/{id}`.
- `plans/[id].astro` shows the full plan; has a back link but no destructive actions.
- `src/pages/api/plans/generate.ts` establishes the API pattern: auth guard → Supabase client check → operation → JSON response.
- RLS policy `plans_delete_own` already exists in the migration: `USING (auth.uid() = user_id)` — DB-level ownership is enforced automatically on every DELETE.
- No delete endpoint exists; no `DeletePlanButton` component exists.
- `Button` component at `src/components/ui/button.tsx` has `variant="destructive"` ready to use.

## Desired End State

- User clicks "Delete" on a dashboard card → card disappears from the page immediately (no reload), or an inline error appears below the card if the call fails.
- User clicks "Delete" on the plan detail page → redirected to `/dashboard` and the plan is gone from the list.
- A `DELETE /api/plans/{id}` endpoint rejects unauthenticated requests (401) and only deletes plans owned by the current user (double check: RLS + `.eq("user_id", user.id)`).

### Key Discoveries

- `dashboard.astro:56` — current card is `<a href="/plans/{id}">` wrapping all content. Adding a `<button>` inside `<a>` is invalid HTML; the card structure must be restructured.
- `generate.ts:7,27-40` — canonical API pattern: `!context.locals.user` → 401; `createClient` null check → 500; Supabase call with error branch → 500; success → 200 JSON.
- `supabase/migrations/…_create_plans_table.sql` — `plans_delete_own` policy exists; `.eq("user_id", user.id)` is redundant with RLS but adds defense in depth (roadmap S-02 risk note explicitly flags this).
- `GeneratePlanForm.tsx` — precedent for `useState`+`fetch` pattern in React islands with inline error display.

## What We're NOT Doing

- No confirmation dialog (roadmap: "brak okna potwierdzenia w MVP")
- No soft-delete or undo
- No bulk delete
- No account deletion (S-04, separate change)

## Implementation Approach

Three phases in dependency order. Phase 1 delivers the API endpoint independently. Phase 2 adds the shared React component and wires it into the dashboard. Phase 3 places the same component on the plan detail page.

## Critical Implementation Details

**Card HTML restructure is required**: the current plan card in `dashboard.astro` is an `<a>` element wrapping all content. A `<button>` cannot be a valid descendant of `<a>`. The outer `<a>` must become a `<div data-plan-id={plan.id}>` with a separate inner `<a>` for navigation and a bottom row for the delete button.

**DOM removal uses `closest()`**: `DeletePlanButton` holds a `ref` on its own container `<div>`. After a successful delete (no `redirectAfterDelete` prop), it calls `ref.current?.closest('[data-plan-id]')?.remove()` to traverse up and remove the card from the DOM. This only works if the outer card div carries the `data-plan-id` attribute — set in Phase 2's dashboard change.

---

## Phase 1: DELETE API Endpoint

### Overview

Create the server-side endpoint that accepts `DELETE /api/plans/{id}`, verifies ownership, and deletes the plan row. No UI changes.

### Changes Required

#### 1. Create delete API route

**File**: `src/pages/api/plans/[id].ts`

**Intent**: Handle authenticated DELETE requests for a single plan. The dynamic `[id]` segment maps to `context.params.id`. Reject unauthenticated requests; enforce ownership at both RLS and application layer before deleting.

**Contract**:
- Export `DELETE: APIRoute` only (no GET, POST, etc.).
- Auth guard: `!context.locals.user` → `new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 })`.
- `const { id } = context.params`.
- Supabase client: `createClient(context.request.headers, context.cookies)`. Null check → `new Response(JSON.stringify({ error: "Database not configured" }), { status: 500 })`.
- Delete call: `supabase.from("plans").delete().eq("id", id).eq("user_id", context.locals.user.id)`. The second `.eq` is the app-layer ownership check (RLS is the DB-layer check).
- On Supabase error → `new Response(JSON.stringify({ error: "Failed to delete plan" }), { status: 500 })`.
- On success → `new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } })`.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no errors
- `npm run build` passes

#### Manual Verification

- Endpoint exists and the build includes the new route (verified by build passing)

**Implementation Note**: Full API behavior is verified in Phase 2 via the UI. After lint and build pass, proceed to Phase 2.

---

## Phase 2: DeletePlanButton Component + Dashboard Integration

### Overview

Create the shared `DeletePlanButton` React component and wire it into the dashboard. The dashboard card structure is restructured from a full-`<a>` wrapper to a `<div>` with a separate inner link and a delete row at the bottom.

### Changes Required

#### 1. Create DeletePlanButton component

**File**: `src/components/DeletePlanButton.tsx`

**Intent**: Self-contained React island that sends `DELETE /api/plans/{planId}`, then either removes the card from the DOM (dashboard) or navigates away (detail page), and shows an inline error if the call fails.

**Contract**:
- Props: `interface Props { planId: string; redirectAfterDelete?: string }`.
- State: `isDeleting: boolean`, `error: string | null`.
- Holds a `ref` on its own outer `<div>`.
- On click: set `isDeleting=true`, clear `error`, then `fetch(\`/api/plans/${planId}\`, { method: "DELETE" })`.
- 2xx response with no `redirectAfterDelete`: call `ref.current?.closest('[data-plan-id]')?.remove()`.
- 2xx response with `redirectAfterDelete` set: `window.location.href = redirectAfterDelete`.
- Non-2xx response: parse JSON, `setError(data.error ?? "Failed to delete plan — please try again")`.
- Network/parse error (catch): `setError("Failed to delete plan — please try again")`.
- Always `setIsDeleting(false)` on failure paths.
- Button label: `isDeleting ? "Deleting…" : "Delete"`. Disabled when `isDeleting`.
- Uses `Button` from `@/components/ui/button` with `variant="destructive"` and `size="sm"`.
- Error displayed as `<p>` with red text style below the button (same pattern as `ServerError.tsx`).

#### 2. Restructure dashboard plan cards

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the full-`<a>` card wrapper with a `<div>` that separates the navigation link from the delete action, and mount `DeletePlanButton` in a bottom row of each card.

**Contract**:
- Outer element: `<div data-plan-id={plan.id}>` with the existing glass-card classes (`rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl`).
- Inner navigation: `<a href={/plans/${plan.id}>` wrapping only the plan name, goal badge, and date — carries the `transition-colors hover:bg-white/10` hover style so the clickable area remains visually responsive.
- Below the inner `<a>`: a bottom row (`border-t border-white/5 px-6 py-3`) containing `<DeletePlanButton planId={plan.id} client:load />`.
- Import `DeletePlanButton` at the top of the frontmatter.
- The hover effect now applies to the inner `<a>` only, not the full card — this is intentional to avoid hover on the delete row.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- Dashboard cards display correctly: plan name, goal badge, date visible with a "Delete" button row below each card
- Clicking the card title/content area navigates to `/plans/{id}` as before
- Clicking "Delete" on a card: button shows "Deleting…", then the card is removed from the page without a reload
- Clicking "Delete" on the same card twice (race condition): second click is blocked while `isDeleting` is true (button disabled)
- If the API call fails (network off or forced server error): inline error appears below the button; card remains visible; button re-enables
- Empty-state dashboard (no plans): unchanged layout

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Delete Button on Plan Detail Page

### Overview

Add `DeletePlanButton` to the plan detail page header so users can delete a plan while viewing it. On success, the user is redirected to `/dashboard`.

### Changes Required

#### 1. Add delete button to plan detail page

**File**: `src/pages/plans/[id].astro`

**Intent**: Let users delete the currently-viewed plan without navigating back to the dashboard first.

**Contract**:
- Import `DeletePlanButton` in frontmatter.
- Mount `<DeletePlanButton planId={plan.id} redirectAfterDelete="/dashboard" client:load />` in the header block, alongside the existing "← Back to Dashboard" link and plan title row (`plans/[id].astro:31-45`). Place it on the right side of the header flex row.
- No structural changes to the week/day content below.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- Plan detail page header shows a "Delete" button alongside the back link
- Clicking "Delete" shows "Deleting…", then redirects to `/dashboard`
- Deleted plan no longer appears in the dashboard list
- Navigating directly to `/plans/{deleted-id}` redirects to `/dashboard` (existing RLS + null check behavior from S-01)
- If the delete call fails: inline error appears near the button; user remains on the detail page

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before committing.

---

## Testing Strategy

### Manual Testing Steps

1. Generate and save two plans (Plan A and Plan B)
2. On `/dashboard`, click "Delete" on Plan A → card disappears; Plan B remains
3. Refresh `/dashboard` → Plan A is gone, Plan B still listed
4. Click Plan B → navigate to `/plans/{id}`
5. Click "Delete" on the detail page → redirected to `/dashboard`; Plan B is gone; empty state shown
6. Attempt to navigate to deleted plan's URL directly → redirected to `/dashboard`
7. Force a network error (DevTools offline) and click "Delete" → inline error appears; card/page remains

## References

- Roadmap S-02: `context/foundation/roadmap.md`
- PRD ref: FR-011
- API pattern source: `src/pages/api/plans/generate.ts`
- Supabase client pattern: `src/lib/supabase.ts`
- RLS policy: `supabase/migrations/20260528000000_create_plans_table.sql`
- Button component: `src/components/ui/button.tsx`
- GeneratePlanForm (fetch pattern precedent): `src/components/GeneratePlanForm.tsx`
- Plan types: `src/types/database.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DELETE API Endpoint

#### Automated

- [x] 1.1 `npm run lint` passes
- [x] 1.2 `npm run build` passes

#### Manual

- [x] 1.3 Endpoint exists and build includes the new route

### Phase 2: DeletePlanButton Component + Dashboard Integration

#### Automated

- [ ] 2.1 `npm run lint` passes
- [ ] 2.2 `npm run build` passes

#### Manual

- [ ] 2.3 Dashboard cards display correctly with "Delete" button row below each card
- [ ] 2.4 Card title/content area navigates to `/plans/{id}` as before
- [ ] 2.5 Clicking "Delete" removes the card from the page without a reload
- [ ] 2.6 Second click while deleting is blocked (button disabled)
- [ ] 2.7 API failure shows inline error; card remains; button re-enables
- [ ] 2.8 Empty-state dashboard layout unchanged

### Phase 3: Delete Button on Plan Detail Page

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 `npm run build` passes

#### Manual

- [ ] 3.3 Plan detail header shows "Delete" button
- [ ] 3.4 Clicking "Delete" redirects to `/dashboard` after deletion
- [ ] 3.5 Deleted plan no longer appears in the dashboard list
- [ ] 3.6 Navigating to deleted plan URL redirects to `/dashboard`
- [ ] 3.7 API failure shows inline error; user stays on detail page
