# Delete Plan — Plan Brief

> Full plan: `context/changes/delete-plan/plan.md`

## What & Why

Lets users delete a saved training plan from their account. Implements S-02 / FR-011 — the first list-management action after the north-star slice (S-01) proved the core generate-and-save flow works. Keeps the plan list clean and gives users basic control over their data.

## Starting Point

S-01 is complete: `dashboard.astro` renders plans as full-`<a>` cards, `plans/[id].astro` shows the detail, and `generate.ts` establishes the API pattern (auth guard → Supabase client → operation → JSON). A `plans_delete_own` RLS policy already exists in the migration (`USING (auth.uid() = user_id)`). No delete endpoint or UI affordance exists yet.

## Desired End State

A "Delete" button appears on each dashboard card and on the plan detail header. Clicking it on the dashboard removes the card from the page instantly (no reload). Clicking it on the detail page redirects to `/dashboard`. Deletion is permanent with no confirmation step in MVP.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Button placement | Dashboard cards + plan detail page | User should be able to delete from wherever they are, not only from the list |
| Delete mechanism | `fetch()` + React island | Instant card removal without reload; consistent with `GeneratePlanForm` pattern already in the project |
| Error handling | Inline error below card/button | No toast library in the project; mirrors how `GeneratePlanForm` surfaces errors |
| Ownership double-check | RLS + `.eq("user_id", user.id)` | Defense in depth — roadmap S-02 risk note explicitly calls this out |

## Scope

**In scope:**
- `DELETE /api/plans/[id]` endpoint
- `DeletePlanButton` React component (shared between dashboard and detail page)
- Dashboard card restructure (full-`<a>` → `<div>` + inner `<a>`) to allow valid button nesting
- Delete button on plan detail page header

**Out of scope:**
- Confirmation dialog (MVP decision)
- Soft-delete / undo
- Bulk delete
- Account deletion (S-04)

## Architecture / Approach

One new API route at `src/pages/api/plans/[id].ts` exports only `DELETE: APIRoute`, following the exact pattern of `generate.ts`. One new React component `src/components/DeletePlanButton.tsx` is mounted as a client island (`client:load`) in two places. DOM removal after dashboard delete uses `ref.current?.closest('[data-plan-id]')?.remove()` — requires the outer card div to carry `data-plan-id={plan.id}`, added as part of the card restructure.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DELETE API Endpoint | Working `DELETE /api/plans/{id}` with auth + ownership guard | Astro dynamic route naming (`[id].ts`) differs from existing flat routes — ensure exports are correct |
| 2. DeletePlanButton + Dashboard | Shared component + restructured cards with instant delete | Card restructure (full-`<a>` → `<div>`) must not break existing navigation UX or hover styles |
| 3. Plan Detail Delete Button | Delete affordance on `/plans/{id}` with post-delete redirect | None — reuses component from Phase 2 with a single new prop |

**Prerequisites:** S-01 complete (auth, dashboard, plans table, generate flow all working)
**Estimated effort:** ~1 session across 3 phases

## Open Risks & Assumptions

- The card hover effect currently applies to the full `<a>` — after restructuring, hover applies only to the inner link area. This is an intentional UX tradeoff (delete row should not appear "hovered" as if it navigates).
- If `closest('[data-plan-id]')` traversal fails (component rendered outside a card), DOM removal silently no-ops; the user would need to reload to see the deletion. This can't happen in the current page structure but is worth knowing.

## Success Criteria (Summary)

- Clicking "Delete" on a dashboard card removes it immediately; refreshing confirms it's gone
- Clicking "Delete" on a plan detail page redirects to `/dashboard` with the plan absent
- Attempting to delete another user's plan ID via curl or devtools returns no rows deleted (RLS + app-layer guard)
