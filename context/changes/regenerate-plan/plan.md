# Regenerate Plan — Implementation Plan

## Overview

Add an inline modal on the dashboard so logged-in users can start a new plan generation without navigating to `/generate`. Also add a "Generate new plan" shortcut on the plan detail page. The core generate API and form are fully built; this slice wires them into the dashboard's primary UX.

## Current State Analysis

The plan generation infrastructure from S-01 is complete:

- `src/pages/api/plans/generate.ts` — POST endpoint; validates auth, calls OpenRouter, inserts into Supabase, returns `{ planId }`.
- `src/components/GeneratePlanForm.tsx` — standalone React component; self-contained state, posts to the API, redirects to `/plans/{id}` on success.
- `src/pages/generate.astro` — separate page at `/generate`; checks `OPENROUTER_API_KEY`, wraps `GeneratePlanForm`.
- `src/pages/dashboard.astro` — plan list; both the empty-state (`line 41`) and non-empty-state (`line 50`) already carry `<a href="/generate">` links.
- `src/pages/plans/[id].astro` — plan detail; only has "← Back to Dashboard" (`line 34`), no generate shortcut.
- `src/middleware.ts` — `/generate` and `/dashboard` and `/plans` are all protected.

**Gap:** the two `/generate` anchor links on the dashboard navigate away from the page; the roadmap outcome asks for the form to be accessible directly from the dashboard. The plan detail page has no path to generation.

## Desired End State

A logged-in user on the dashboard can open a modal (click "+ Generate plan") to generate a new plan without leaving the dashboard. The plan list is visible behind the modal overlay; after a successful generation the user lands on the new plan's detail page. An identical modal trigger exists in the empty state. A "Generate new plan" link on the plan detail page gives users a direct path to generation from there too. The separate `/generate` page remains functional as a secondary entry point.

### Key Discoveries:

- `GeneratePlanForm` (`src/components/GeneratePlanForm.tsx:41`) redirects via `window.location.href` on success — modal does not need to handle post-generation navigation.
- `generate.astro:7` does the `OPENROUTER_API_KEY` check server-side; the dashboard will need the same check to pass a `disabled` flag to the modal component.
- `dashboard.astro` currently has two visually distinct button styles for generate: empty-state (`px-6 py-3`) and non-empty-state (`self-start px-5 py-2.5`). The new `GeneratePlanButton` will accept an optional `label` prop and preserve those styles via `className` prop.
- No Radix Dialog is in the stack — modal implementation uses a plain React overlay (`fixed inset-0`) which aligns with existing patterns.

## What We're NOT Doing

- Not removing the `/generate` page — it stays as a valid secondary entry point.
- Not pre-filling ride stats from the user's most recent plan.
- Not embedding the form below the plan list (would violate the "good state separation" constraint from the roadmap).
- Not adding a confirmation step or animation to the modal open/close.

## Implementation Approach

Create a single `GeneratePlanButton` React component that owns the trigger button and the modal overlay. The component wraps the existing `GeneratePlanForm` unchanged. The dashboard replaces both `/generate` anchors with this component. The plan detail page gets a simple anchor link to `/generate` (no modal — the user navigates away, same as before S-03).

## Critical Implementation Details

- **ESC to close**: use `useEffect` to add a `keydown` listener; close on `key === "Escape"`. Remove the listener in the cleanup function to avoid leaks.
- **Form state reset on close**: the modal conditionally renders `{isOpen && <GeneratePlanForm ... />}` — unmounting the form on close clears its state without manual reset logic.
- **Backdrop click**: the outer overlay div handles `onClick={close}`; the inner card div calls `e.stopPropagation()` to prevent bubbling.
- **`OPENROUTER_API_KEY` on dashboard**: import from `astro:env/server` in the frontmatter of `dashboard.astro` (same pattern as `generate.astro:5`). Pass `disabled={!OPENROUTER_API_KEY}` to both `GeneratePlanButton` islands.

---

## Phase 1: GeneratePlanButton component + dashboard wiring

### Overview

Create the `GeneratePlanButton` React island and replace both `/generate` anchor links on the dashboard with it. The component renders a trigger button that opens a modal overlay containing `GeneratePlanForm`.

### Changes Required:

#### 1. New component: GeneratePlanButton

**File**: `src/components/GeneratePlanButton.tsx`

**Intent**: Self-contained React island that renders a styled trigger button plus a modal overlay. Encapsulates all open/close state so the Astro dashboard page needs no client-side state of its own.

**Contract**: 
```ts
interface Props {
  label?: string;     // button text; defaults to "Generate plan"
  disabled?: boolean; // passed through to GeneratePlanForm
  className?: string; // applied to the trigger button for per-site styling
}
```

The overlay is `fixed inset-0 z-50 flex items-center justify-center bg-black/60`; the card is `relative rounded-2xl border border-white/10 bg-[#0a0a1a] max-w-xl w-full mx-4 p-8`. A close button (`×`) sits in the card's top-right corner. ESC and backdrop click also close. The form is only mounted when `isOpen === true`.

#### 2. Update dashboard.astro — imports and key check

**File**: `src/pages/dashboard.astro`

**Intent**: Add the server-side `OPENROUTER_API_KEY` check (mirrors `generate.astro`) and import `GeneratePlanButton` so both islands can receive the `disabled` flag.

**Contract**: Add to frontmatter:
```ts
import { GeneratePlanButton } from "@/components/GeneratePlanButton";
import { OPENROUTER_API_KEY } from "astro:env/server";
const keyMissing = !OPENROUTER_API_KEY;
```

#### 3. Update dashboard.astro — empty state

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the anchor link (`line 41-46`) with `GeneratePlanButton` so the generate flow opens as a modal instead of navigating to `/generate`.

**Contract**: Replace the `<a href="/generate" ...>Generate plan</a>` with:
```astro
<GeneratePlanButton disabled={keyMissing} client:load />
```

The `GeneratePlanButton` default label ("Generate plan") matches the current link text.

#### 4. Update dashboard.astro — non-empty state

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the anchor link (`line 50-55`) in the non-empty plans section with `GeneratePlanButton`.

**Contract**: Replace the `<a href="/generate" class="self-start ...">+ Generate plan</a>` with:
```astro
<GeneratePlanButton label="+ Generate plan" disabled={keyMissing} className="self-start" client:load />
```

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Dashboard with existing plans: clicking "+ Generate plan" opens a modal overlay; the plan list is visible behind the overlay
- Dashboard empty state: clicking "Generate plan" opens the same modal
- ESC key closes the modal
- Clicking the backdrop (outside the card) closes the modal
- Clicking the × button in the card corner closes the modal
- Submitting a valid form inside the modal generates a plan and redirects to `/plans/{id}`
- After redirect, the new plan appears in the dashboard list on return
- Form state resets when modal is reopened after a previous close
- When `OPENROUTER_API_KEY` is missing: modal opens, form inputs are disabled, generate button is disabled
- No regressions: plan cards still link to detail page, delete still works, sign-out still works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: "Generate new plan" entry point on plan detail page

### Overview

Add a "Generate new plan" link in the plan detail page header so users who are viewing a saved plan can jump directly to generation without going back to the dashboard first.

### Changes Required:

#### 1. Update plan detail page header

**File**: `src/pages/plans/[id].astro`

**Intent**: Add a secondary CTA beside the existing "← Back to Dashboard" link (`line 34`) so users have a clear path to generation from the plan detail view.

**Contract**: In the flex row at `line 33-36`, add a link to `/generate` alongside the back link:
```astro
<a href="/generate" class="text-sm text-blue-100/60 hover:text-white">Generate new plan →</a>
```

The link style mirrors the "← Back to Dashboard" style on the same line for visual consistency.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Plan detail page shows "Generate new plan →" link in the header row
- Clicking it navigates to `/generate` (the form loads with empty fields)
- "← Back to Dashboard" still works and links to `/dashboard`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Testing Strategy

### Manual Testing Steps:

1. Log in → arrive at dashboard (with existing plans) → click "+ Generate plan" → modal opens over plan list
2. Press ESC → modal closes, plan list still visible and intact
3. Click "+ Generate plan" → click backdrop → modal closes
4. Click "+ Generate plan" → fill form → submit → loading spinner appears → redirect to new plan detail page
5. From plan detail → click "Generate new plan →" → lands on `/generate` with empty form
6. Log in with no plans → click "Generate plan" (empty state) → modal opens and works

### Manual Testing — Edge Cases:

- Open modal, partially fill form, close → reopen → form is empty (state reset)
- Generation error (bad ride stats format) → error shown inside modal; modal stays open
- Build and test with `OPENROUTER_API_KEY` unset → modal opens, form disabled

## References

- Roadmap: `context/foundation/roadmap.md` — S-03, FR-006
- Existing form component: `src/components/GeneratePlanForm.tsx`
- Existing generate page (secondary entry point): `src/pages/generate.astro`
- Similar island pattern: `src/components/DeletePlanButton.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: GeneratePlanButton component + dashboard wiring

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — b7e7d86
- [x] 1.2 Build succeeds: `npm run build` — b7e7d86

#### Manual

- [x] 1.3 Dashboard with existing plans: clicking "+ Generate plan" opens modal overlay — b7e7d86
- [x] 1.4 Dashboard empty state: clicking "Generate plan" opens modal — b7e7d86
- [x] 1.5 ESC key closes the modal — b7e7d86
- [x] 1.6 Backdrop click closes the modal — b7e7d86
- [x] 1.7 × button closes the modal — b7e7d86
- [x] 1.8 Valid form submission generates plan and redirects to /plans/{id} — b7e7d86
- [x] 1.9 Form state resets when modal is reopened — b7e7d86
- [ ] 1.10 Missing API key: modal opens, form disabled
- [x] 1.11 No regressions in plan list, delete, and sign-out — b7e7d86

### Phase 2: "Generate new plan" entry point on plan detail page

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — b7e7d86
- [x] 2.2 Build succeeds: `npm run build` — b7e7d86

#### Manual

- [x] 2.3 Plan detail page shows "Generate new plan →" link in header row
- [x] 2.4 Clicking it navigates to /generate with empty form
- [x] 2.5 "← Back to Dashboard" still works
