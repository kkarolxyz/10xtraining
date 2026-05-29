# Delete Account Implementation Plan

## Overview

Allow authenticated users to permanently delete their account and all associated training plans from a dedicated `/account` settings page. Deletion is irreversible and GDPR-mandated (FR-012); the implementation uses Supabase's admin API (service role key) so the auth user record can be removed server-side, which cascades to the `plans` table via the existing FK constraint.

## Current State Analysis

- `plans` table already has `REFERENCES auth.users(id) ON DELETE CASCADE` (migration `20260528000000`) — no new migration needed; deleting the auth user automatically removes all plans
- `@supabase/supabase-js` is already a direct dependency (^2.99.1); admin client just needs the service role key
- No `/account` page or settings section exists; the only account action today is sign-out in the dashboard header
- `PROTECTED_ROUTES` in `src/middleware.ts` currently covers `/dashboard`, `/generate`, `/plans` — `/account` must be added
- The existing modal pattern (overlay + dialog, Escape key, click-outside to close) lives in `src/components/GeneratePlanButton.tsx` — the delete confirmation modal will follow the same shape
- `Banner.astro` already supports `variant="info"` — reused for the post-deletion landing page message
- All three existing env secrets use `envField.string({ context: "server", access: "secret", optional: true })` in `astro.config.mjs` — the new `SUPABASE_SERVICE_ROLE_KEY` follows the same declaration

## Desired End State

After this plan is complete:
- A logged-in user can navigate to `/account` via a Topbar link, trigger "Delete Account", confirm by typing DELETE, and have their account and all plans permanently removed
- After deletion, the browser lands on `/` with a one-time info banner confirming the deletion
- Attempting to access any protected route with the (now-invalid) session redirects to `/auth/signin`
- `SUPABASE_SERVICE_ROLE_KEY` is declared in `astro.config.mjs`, documented in `.env.example`, and the admin client is exported from `src/lib/supabase.ts`

### Key Discoveries:

- `src/lib/supabase.ts:5` — existing `createClient` uses `@supabase/ssr`; admin client uses `createClient` from `@supabase/supabase-js` directly (no naming conflict — import aliased)
- `src/middleware.ts:4` — `PROTECTED_ROUTES` array is the single place to add `/account`
- `src/components/GeneratePlanButton.tsx:48-85` — exact modal overlay structure to replicate for delete confirmation
- `src/components/DeletePlanButton.tsx:19-41` — fetch + loading state + inline error pattern to follow
- `astro.config.mjs:19-21` — `envField.string` declarations to mirror for the new secret
- `.env.example` lines 1-3 — template to extend with the new variable

## What We're NOT Doing

- No password re-entry confirmation — "type DELETE" provides sufficient protection for MVP
- No grace period or account recovery flow — deletion is immediate and permanent
- No admin dashboard for manual deletion — self-service only
- No email confirmation sent after deletion
- No changes to the `plans` table schema — cascade delete is already in place
- No new npm packages — `@supabase/supabase-js` is already a direct dependency

## Implementation Approach

Five sequential phases, each small and independently verifiable:
1. Wire the env variable and admin client (prerequisite for everything else)
2. Build the API endpoint (can be tested with curl once Phase 1 is done)
3. Build the React confirmation modal component
4. Create the account settings page that hosts the component
5. Connect navigation (Topbar link) and the landing page success banner

## Critical Implementation Details

- **Admin client vs SSR client**: `createAdminClient()` uses `createClient` from `@supabase/supabase-js` (bypasses RLS, can delete `auth.users`). The SSR client (`createClient` from `@supabase/ssr`) is still used for `signOut()` in the same endpoint to clear the session cookie — both clients are needed in the DELETE handler.
- **Cookie clearing order**: resolve `userId` from `context.locals.user.id` before calling `signOut()`, because `signOut()` invalidates the local session state. Delete the user with the admin client, then call SSR `signOut()` to set the clearing Set-Cookie headers on the response.
- **React Compiler compliance**: `DeleteAccountButton` must not violate `react-compiler/react-compiler: "error"`. Use standard `useState` / `useEffect` patterns exactly as in `GeneratePlanButton.tsx` — no manual `useMemo`/`useCallback` wrapping.

---

## Phase 1: Environment & Admin Client Setup

### Overview

Declare `SUPABASE_SERVICE_ROLE_KEY` in the Astro env schema and the env template files, then export a typed `createAdminClient()` helper from the existing Supabase lib.

### Changes Required:

#### 1. Astro env schema

**File**: `astro.config.mjs`

**Intent**: Declare the new server secret so it is type-safe and build-validated alongside the existing Supabase secrets.

**Contract**: Add one `envField.string` entry inside `env.schema` keyed `SUPABASE_SERVICE_ROLE_KEY` with `{ context: "server", access: "secret", optional: true }` — matching the existing `SUPABASE_URL` and `SUPABASE_KEY` declarations.

#### 2. Env template

**File**: `.env.example`

**Intent**: Document the new variable so any developer setting up the project knows to populate it.

**Contract**: Append `SUPABASE_SERVICE_ROLE_KEY=###` as a fourth line (after `OPENROUTER_API_KEY`). No other changes.

#### 3. Admin client helper

**File**: `src/lib/supabase.ts`

**Intent**: Export a factory for a Supabase admin client that can delete auth users (bypasses RLS). Colocated with the existing SSR client factory.

**Contract**: Import `createClient as createSupabaseClient` from `@supabase/supabase-js` and import `SUPABASE_SERVICE_ROLE_KEY` from `astro:env/server`. Export a new function `createAdminClient()` that returns `createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` or `null` if either env var is absent — matching the null-guard pattern of the existing `createClient`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes — no TypeScript errors on the new `createAdminClient` export or the new env import
- `npm run build` passes — build validates that `SUPABASE_SERVICE_ROLE_KEY` is declared and typed correctly in the env schema

#### Manual Verification:

- `.env.example` contains `SUPABASE_SERVICE_ROLE_KEY=###`
- Local `.env` and `.dev.vars` have been updated with the real service role key from the Supabase project dashboard (Settings → API → service_role key)
- `createAdminClient` is importable without TypeScript errors

**Implementation Note**: After Phase 1 automated verification passes, update `.env` and `.dev.vars` with the actual service role key before continuing to Phase 2 — the endpoint won't function without it.

---

## Phase 2: Delete-Account API Endpoint

### Overview

Implement `DELETE /api/auth/delete-account` — the single server action that removes the auth user (cascading to plans) and clears the session cookie.

### Changes Required:

#### 1. Delete-account endpoint

**File**: `src/pages/api/auth/delete-account.ts`

**Intent**: Server-side handler that authenticates the caller, permanently deletes their Supabase auth user record (which cascades to `plans`), clears the session cookie, and returns a JSON success response.

**Contract**: Export a `DELETE` named export typed as `APIRoute`. Handler steps in order:
1. Auth guard — if `!context.locals.user`, return 401 `{ error: "Not authenticated" }`
2. Capture `userId = context.locals.user.id`
3. Create admin client via `createAdminClient()`; if null, return 500 `{ error: "Service unavailable" }`
4. Call `adminClient.auth.admin.deleteUser(userId)`; on error return 500 `{ error: "Failed to delete account" }`
5. Create SSR client via `createClient(context.request.headers, context.cookies)` and call `.auth.signOut()` wrapped in a try-catch that swallows errors — if signOut() throws, the 200 response must still be returned; the middleware will invalidate the stale session on the next request
6. Return 200 `{ success: true }` with `Content-Type: application/json`

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes — no TypeScript errors in the new endpoint
- `npm run build` passes

#### Manual Verification:

- `curl -X DELETE http://localhost:4321/api/auth/delete-account` without a session returns 401
- Calling the endpoint with a valid session (via browser DevTools or a test account) deletes the user from Supabase → Auth → Users dashboard and removes their plans

**Implementation Note**: Test with a throwaway account to avoid destroying your primary test account. After manual confirmation, proceed to Phase 3.

---

## Phase 3: DeleteAccountButton Component

### Overview

React island that triggers the "type DELETE to confirm" modal and calls the API endpoint on confirmation.

### Changes Required:

#### 1. DeleteAccountButton component

**File**: `src/components/DeleteAccountButton.tsx`

**Intent**: Interactive React component providing the full confirmation flow: open modal → type DELETE → confirm → API call → navigate to `/?deleted=1` on success or show inline error on failure.

**Contract**:
- No props required (account deletion is always for the currently logged-in user)
- State: `isOpen: boolean`, `confirmText: string`, `isDeleting: boolean`, `error: string | null`
- Modal overlay structure mirrors `GeneratePlanButton.tsx:48-85` exactly (same className strings for `fixed inset-0 z-50`, same `e.stopPropagation()` on the dialog, same Escape key `useEffect`)
- Inside the dialog: a warning paragraph, a `<label>` + `<input>` where the user types DELETE, the confirm `<Button variant="destructive">` disabled when `confirmText.trim() !== "DELETE" || isDeleting`, a cancel `<Button variant="outline">` that closes the modal
- On confirm: fetch `DELETE /api/auth/delete-account`; on success `window.location.href = "/?deleted=1"`; on failure set `error` and leave modal open
- Error display: `<p className="mt-2 text-sm text-red-300">{error}</p>` below the confirm button — same pattern as `DeletePlanButton.tsx:49`
- Trigger button: `<Button variant="destructive">Delete Account</Button>` (no size prop — full-width feel for a settings page)

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes — no TypeScript errors on `src/components/DeleteAccountButton.tsx`
- `npm run build` passes

#### Manual Verification:

- Component behaviour (modal open/close, disabled state, API call, navigation) is verified through Phase 4 manual testing steps — the component cannot be exercised in isolation without the account page.

---

## Phase 4: Account Settings Page

### Overview

A new protected page at `/account` that displays the user's email and a danger zone card hosting the DeleteAccountButton.

### Changes Required:

#### 1. Protected route registration

**File**: `src/middleware.ts`

**Intent**: Make `/account` require authentication, consistent with all other app pages.

**Contract**: Add `"/account"` to the `PROTECTED_ROUTES` array at line 4. No other changes to the middleware.

#### 2. Account settings page

**File**: `src/pages/account.astro`

**Intent**: Dedicated settings page accessible to logged-in users, matching the visual style of `dashboard.astro` (cosmic background, Topbar, centred content card).

**Contract**:
- Frontmatter: import `Layout`, `Topbar`, `DeleteAccountButton` (with `client:only="react"`)
- Read `user` from `Astro.locals.user`
- Page structure mirrors `dashboard.astro` outer shell: `bg-cosmic` root div with cosmic orb decorations, `relative z-10 p-4 sm:p-8` inner div, `Topbar` at the top
- Content: a centred `max-w-2xl` container with two sections:
  - **Account info card**: `rounded-xl border border-white/10 bg-white/5 p-6` card showing "Account" heading and user email
  - **Danger zone card**: same card style but with `border-red-500/30` border, heading "Danger zone", a one-line warning about permanent deletion, then `<DeleteAccountButton client:only="react" />`
- `<Layout title="Account Settings">` wrapper

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes — no TypeScript or Astro errors on the new page
- `npm run build` passes

#### Manual Verification:

- Navigating to `/account` while logged out redirects to `/auth/signin`
- Navigating to `/account` while logged in renders the page with the user's email and the Delete Account button
- The cosmic background and Topbar render correctly (matches dashboard visual style)

---

## Phase 5: Navigation & Landing Page Banner

### Overview

Connect the account page into the UI: add an "Account" link in Topbar for logged-in users, and show a one-time success banner on the landing page after deletion.

### Changes Required:

#### 1. Topbar navigation link

**File**: `src/components/Topbar.astro`

**Intent**: Give logged-in users a visible path to `/account` from any protected page.

**Contract**: Inside the `user ? (...)` branch (currently lines 9-20), add an `<a href="/account">Account</a>` link in the `flex items-center gap-3` div, between the existing "Dashboard" link and the sign-out form. Use the same className as the Dashboard link: `"text-purple-300 transition-colors hover:text-purple-100 hover:underline"`.

#### 2. Landing page deletion banner

**File**: `src/pages/index.astro`

**Intent**: Show a one-time confirmation message to a user who just deleted their account, using the existing `Banner` component.

**Contract**: In the frontmatter, import `Banner` from `@/components/Banner.astro` and read `const deleted = Astro.url.searchParams.get("deleted") === "1"`. In the template, render `{deleted && <Banner variant="info">Your account has been successfully deleted.</Banner>}` between `<Layout>` and `<Welcome />`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes on both modified files
- `npm run build` passes

#### Manual Verification:

- Logged-in user sees "Account" link in Topbar on `/dashboard`, `/account`, and `/plans/[id]`
- Clicking "Account" navigates to `/account`
- Visiting `/?deleted=1` shows the info banner; visiting `/` without the param does not

**Implementation Note**: After Phase 5, run the full end-to-end happy path described in the Testing Strategy before marking this change done.

---

## Testing Strategy

### Manual Testing Steps:

1. Create a throwaway test account via `/auth/signup`
2. Generate and save at least one training plan
3. Navigate to `/account` via the Topbar "Account" link — verify the page renders with the test email
4. Click "Delete Account" — verify the confirmation modal opens
5. Try clicking "Confirm" with an empty input — verify the button is disabled
6. Type "DELET" (incomplete) — verify button remains disabled
7. Type "DELETE" — verify button becomes active
8. Click "Confirm" — verify:
   - Button shows loading state
   - Browser navigates to `/`
   - Info banner appears on the landing page
9. Attempt to sign in with the deleted account credentials — verify sign-in fails
10. Open Supabase Studio → Auth → Users — verify the account is gone
11. Check the `plans` table — verify no rows remain for that user_id

---

## References

- PRD: `context/foundation/prd.md` — FR-012 (account deletion, must-have)
- Roadmap: `context/foundation/roadmap.md` — S-04 delete-account
- Modal pattern: `src/components/GeneratePlanButton.tsx:48-85`
- Fetch + error pattern: `src/components/DeletePlanButton.tsx:19-41`
- Env schema: `astro.config.mjs:17-23`
- Cascade migration: `supabase/migrations/20260528000000_create_plans_table.sql:3`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Environment & Admin Client Setup

#### Automated

- [x] 1.1 `npm run lint` passes with new env import and `createAdminClient` export
- [x] 1.2 `npm run build` passes with `SUPABASE_SERVICE_ROLE_KEY` declared in env schema

#### Manual

- [ ] 1.3 `.env.example` contains `SUPABASE_SERVICE_ROLE_KEY=###`
- [ ] 1.4 Local `.env` and `.dev.vars` updated with real service role key

### Phase 2: Delete-Account API Endpoint

#### Automated

- [ ] 2.1 `npm run lint` passes on `src/pages/api/auth/delete-account.ts`
- [ ] 2.2 `npm run build` passes

#### Manual

- [ ] 2.3 Unauthenticated DELETE returns 401
- [ ] 2.4 Authenticated DELETE removes user from Supabase Auth and cascades to plans

### Phase 3: DeleteAccountButton Component

#### Automated

- [ ] 3.1 `npm run lint` passes on `src/components/DeleteAccountButton.tsx`
- [ ] 3.2 `npm run build` passes

### Phase 4: Account Settings Page

#### Automated

- [ ] 4.1 `npm run lint` passes on `src/pages/account.astro` and updated `src/middleware.ts`
- [ ] 4.2 `npm run build` passes

#### Manual

- [ ] 4.3 `/account` without session redirects to `/auth/signin`
- [ ] 4.4 `/account` with valid session renders with user email and Delete Account button

### Phase 5: Navigation & Landing Page Banner

#### Automated

- [ ] 5.1 `npm run lint` passes on updated `src/components/Topbar.astro` and `src/pages/index.astro`
- [ ] 5.2 `npm run build` passes

#### Manual

- [ ] 5.3 Topbar shows "Account" link for logged-in users
- [ ] 5.4 `/?deleted=1` shows info banner; `/` without param does not
- [ ] 5.5 Full end-to-end happy path verified (create account → generate plan → delete account → confirm gone from Supabase)
