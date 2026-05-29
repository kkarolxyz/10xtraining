# Delete Account — Plan Brief

> Full plan: `context/changes/delete-account/plan.md`

## What & Why

Add self-service, permanent account deletion (FR-012) so users can remove their account and all training plans in one action. This is a GDPR right-to-erasure requirement and a basic trust signal — the PRD explicitly kept it as must-have after considering a support-driven alternative.

## Starting Point

No account management page or delete-account API exists today. The only account-level action available is sign-out. The `plans` table already has `ON DELETE CASCADE` wired to `auth.users`, so the database cleanup is free — the work is entirely in the API, UI, and navigation layers.

## Desired End State

A logged-in user navigates to `/account` via a Topbar link, clicks "Delete Account", types DELETE in a confirmation modal, and their account plus all plans are permanently removed. The browser lands on `/` with a one-time info banner. Any subsequent attempt to use the deleted session is rejected and redirects to sign-in.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| UI entry point | New `/account` settings page | Clean separation; room to extend; mirrors user expectations for account management | Plan |
| Confirmation mechanism | Modal + type "DELETE" to confirm | Highest friction against accidents without requiring password re-entry complexity | Plan |
| Admin API approach | Service role key + `createAdminClient()` | Idiomatic Supabase pattern; `@supabase/supabase-js` already a direct dependency | Plan |
| Post-deletion destination | `/` with `?deleted=1` banner | Reuses existing `Banner` component; no new page needed | Plan |
| Error surfacing | Inline error in modal (modal stays open) | Consistent with `DeletePlanButton` and `GeneratePlanForm` patterns | Plan |
| Env schema | Declared via `envField.string` in `astro.config.mjs` | Matches existing `SUPABASE_URL` / `SUPABASE_KEY` pattern; build-time validation | Plan |
| Topbar navigation | "Account" link next to Dashboard + Sign out | Zero new components; Topbar already serves every protected page | Plan |

## Scope

**In scope:**
- `SUPABASE_SERVICE_ROLE_KEY` env var + admin Supabase client helper
- `DELETE /api/auth/delete-account` endpoint
- `DeleteAccountButton` React component (modal + confirm input + fetch)
- `/account` Astro page (protected route, danger zone)
- Topbar "Account" link for authenticated users
- Landing page `?deleted=1` success banner

**Out of scope:**
- Password re-entry confirmation
- Grace period or account recovery
- Email notification after deletion
- Any new npm packages
- Changes to the `plans` schema (cascade already in place)

## Architecture / Approach

The endpoint receives a DELETE request from an authenticated session, resolves `userId` from `context.locals.user`, deletes the auth user via the Supabase admin client (which cascades to `plans`), then calls SSR `signOut()` to clear cookies. The React component owns all confirmation UX; the Astro page is a thin shell. Five phases are sequential because each layer depends on the one below.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Env & admin client | `SUPABASE_SERVICE_ROLE_KEY` wired; `createAdminClient()` exported | Dev must populate `.dev.vars` manually with real key |
| 2. Delete-account endpoint | `DELETE /api/auth/delete-account` functional | Admin client returns null if key missing → 500 |
| 3. DeleteAccountButton | Confirmation modal + fetch + error display | React Compiler compliance (follow existing patterns exactly) |
| 4. Account settings page | `/account` route, protected, renders button | Visual consistency with dashboard cosmic style |
| 5. Nav & landing banner | Topbar link + `?deleted=1` banner | Minor — both are small edits to existing components |

**Prerequisites:** Service role key must be available from Supabase dashboard (Settings → API → service_role) before Phase 1 can be fully verified.  
**Estimated effort:** ~1 session across 5 phases.

## Open Risks & Assumptions

- The `optional: true` on `SUPABASE_SERVICE_ROLE_KEY` means a missing key silently returns `null` from `createAdminClient()` — the endpoint handles this with a 500, but the developer must ensure the key is set before testing Phase 2+
- Supabase local dev (`supabase start`) exposes the service_role key in the local dashboard at `http://localhost:54323` — no external dependency for local testing

## Success Criteria (Summary)

- A user can delete their own account via the UI and land on the landing page with a success banner
- The deleted account's plans are gone from the `plans` table (cascade verified in Supabase Studio)
- Attempting to sign in with the deleted credentials is rejected
