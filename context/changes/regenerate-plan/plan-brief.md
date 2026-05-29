# Regenerate Plan — Plan Brief

> Full plan: `context/changes/regenerate-plan/plan.md`

## What & Why

Logged-in users need to generate additional training plans without re-doing onboarding. The dashboard already links to `/generate`, but navigates away from the page. This slice wires the existing `GeneratePlanForm` component into a modal overlay on the dashboard, keeping the plan list in context while the user generates. A "Generate new plan" link on the plan detail page closes the remaining UX gap.

## Starting Point

`GeneratePlanForm`, the generate API (`/api/plans/generate`), and the `/generate` page are all fully built from S-01. The dashboard has `<a href="/generate">` anchors for both the empty and non-empty states (`dashboard.astro:41,50`). The plan detail page has no generate entry point.

## Desired End State

A logged-in user clicks "+ Generate plan" on the dashboard and a modal opens in-place — no navigation away, plan list visible behind the overlay. After submitting, they land on the new plan detail page. A "Generate new plan →" link on the plan detail page offers a direct path to `/generate` as an alternative. Both entry points work; no pre-fill; form state resets on modal close.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Form placement on dashboard | Inline modal overlay | User chose modal over navigation; avoids the roadmap-flagged risk of mixing form + list state without a clear boundary | Plan |
| Pre-fill ride stats | No pre-fill (blank form) | MVP scope; stale stats could produce misleading plans | Plan |
| Plan detail entry point | Link to `/generate` page | Simple anchor, consistent with secondary entry point; no need for modal complexity on detail page | Plan |
| `/generate` page fate | Keep it | Secondary entry point, no reason to remove; plan detail links there | Plan |
| Modal implementation | Plain React overlay div | No Radix Dialog in stack; Tailwind fixed overlay matches existing pattern | Plan |

## Scope

**In scope:**
- `GeneratePlanButton` React component: trigger button + modal overlay wrapping `GeneratePlanForm`
- `dashboard.astro`: replace both `/generate` anchor links with the island; add `OPENROUTER_API_KEY` check
- `plans/[id].astro`: add "Generate new plan →" link in the header row

**Out of scope:**
- Removing or modifying `/generate` page
- Pre-filling ride stats from previous plan
- Post-generation CTA on plan detail ("generate another")
- Animation/transition for modal open/close

## Architecture / Approach

`GeneratePlanButton` is a self-contained React island (`client:load`). It renders a styled button; on click it sets `isOpen = true` and mounts a `fixed inset-0` overlay with the `GeneratePlanForm` component nested inside a centered card. ESC, backdrop click, and × button all set `isOpen = false`, which unmounts the form (resetting its state). The `OPENROUTER_API_KEY` check moves into `dashboard.astro`'s frontmatter (same pattern as `generate.astro`) and the `disabled` flag threads down via props.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. GeneratePlanButton + dashboard wiring | Modal trigger on dashboard replaces both `/generate` anchor links; generate flow works in-place | ESC/backdrop close handlers need cleanup to avoid memory leaks |
| 2. Plan detail entry point | "Generate new plan →" link on `/plans/[id]` header | Trivial; low risk |

**Prerequisites:** S-01 (generate API + form), S-02 (dashboard structure with plan list) — both done.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- `OPENROUTER_API_KEY` is available via `astro:env/server` in `dashboard.astro` frontmatter (same as `generate.astro` — assumed to work identically).
- The `bg-[#0a0a1a]` hex used for the modal card background matches the `bg-cosmic` visual; if `bg-cosmic` resolves to a different value, adjust the card color to match.

## Success Criteria (Summary)

- Logged-in user on dashboard opens generate modal, fills form, lands on new plan detail — without any page navigation during form filling
- Empty-state and non-empty-state dashboard both show working modal triggers
- Plan detail page shows a "Generate new plan →" link that navigates to `/generate`
