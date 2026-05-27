# Plans DB Schema Implementation Plan

## Overview

Create the Supabase migration that defines the `plans` table and RLS policies, plus a TypeScript `Plan` interface. This is foundation item F-01 — no application code can save or read plans until this lands.

## Current State Analysis

The Supabase client is wired (`src/lib/supabase.ts`) and auth endpoints exist (`src/pages/api/auth/`), but the `supabase/migrations/` directory does not exist. `supabase/config.toml` has `schema_paths = []` and no migration files are present. There is no `plans` table, no RLS, and no TypeScript types for plan data.

## Desired End State

After this change:
- `supabase/migrations/20260528000000_create_plans_table.sql` exists and contains valid SQL
- Applying the migration creates a `plans` table with 7 columns: `id`, `user_id`, `name`, `goal`, `ride_stats`, `plan`, `created_at`
- RLS is enabled; SELECT / INSERT / DELETE policies are each scoped to `auth.uid() = user_id`
- `src/types/database.ts` exports `Plan`, `PlanGoal`, and `NewPlan` types
- S-01 can import `Plan` and call `supabase.from('plans').select()` / `.insert()` / `.delete()` with correct TypeScript types

### Key Discoveries

- `supabase/migrations/` does not exist — must be created as a new directory
- `config.toml` `schema_paths = []`: leave untouched; the Supabase CLI reads `migrations/` automatically without this field
- No `src/types/` directory exists; this change introduces it
- RLS uses `auth.uid()` — the standard Supabase function that returns the JWT subject UUID
- No UPDATE policy: plan editing is out of scope (FR-010 demoted to nice-to-have in PRD)
- `ON DELETE CASCADE` on `user_id` covers S-04: deleting the auth account auto-deletes plans at DB level

## What We're NOT Doing

- No `user_id` index — data volume is "small" per PRD; add if query profiling warrants it later
- No UPDATE RLS policy — plan editing is deferred (FR-010)
- No `updated_at` column — no edits, no need
- No changes to `config.toml` — `schema_paths` is for declarative schema files, not the migrations directory
- No `supabase gen types typescript` output — requires a running local/remote Supabase instance; a hand-written interface is sufficient for S-01

## Implementation Approach

Single migration file covers the full table DDL and all RLS policies in one transaction. TypeScript types are written by hand to match the migration exactly — no code generation tooling needed.

---

## Phase 1: Supabase Migration

### Overview

Create the `supabase/migrations/` directory and write the migration SQL that creates the `plans` table with RLS policies.

### Changes Required

#### 1. Migration file

**File**: `supabase/migrations/20260528000000_create_plans_table.sql`

**Intent**: Define the `plans` table and all RLS policies in one migration so the database is immediately ready for S-01 to write INSERT / SELECT / DELETE queries against it.

**Contract**: Standard Supabase migration — no `IF NOT EXISTS` guard needed (migrations run once). RLS policies use `auth.uid()`. No UPDATE policy. `ON DELETE CASCADE` on `user_id` satisfies S-04's requirement that deleting an account removes all associated plans. The INSERT policy enforces but does not auto-populate `user_id` — the API layer must include `user_id` set to the authenticated user's ID in every insert payload.

```sql
CREATE TABLE plans (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  goal        TEXT         NOT NULL CHECK (goal IN ('speed', 'distance')),
  ride_stats  TEXT         NOT NULL,
  plan        JSONB        NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans_select_own"
  ON plans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "plans_insert_own"
  ON plans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "plans_delete_own"
  ON plans FOR DELETE
  USING (auth.uid() = user_id);
```

### Success Criteria

#### Automated Verification

- Migration file exists at `supabase/migrations/20260528000000_create_plans_table.sql`

#### Manual Verification

- Migration applies without errors (remote: `supabase db push` after `supabase link`; local: `supabase start` auto-applies migrations on startup)
- Table `plans` is visible in Supabase dashboard with all 7 columns
- Authenticated user can INSERT a plan row and SELECT it back
- SELECT as a different authenticated user returns 0 rows (RLS blocks cross-user access)
- DELETE by the row's owner removes it; DELETE attempt by a different user affects 0 rows

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: TypeScript Types

### Overview

Add `src/types/database.ts` with types derived directly from the migration schema so S-01 has import-ready, type-safe interfaces for all Supabase plan queries.

### Changes Required

#### 1. Type definitions file

**File**: `src/types/database.ts`

**Intent**: Provide a typed `Plan` interface and helpers so S-01 can write `supabase.from('plans').insert(plan as NewPlan)` and get full TypeScript coverage without running `supabase gen types`.

**Contract**: Export three items — `PlanGoal` (string literal union `'speed' | 'distance'`), `Plan` (full row shape with all 7 fields matching the migration exactly), `NewPlan` (insert shape — omits `id` and `created_at` which the DB provides). The `plan` JSONB field is typed as `Record<string, unknown>` for now; it will be narrowed to a specific interface once the LLM output shape is settled in F-02/S-01.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no TypeScript errors
- `npm run build` passes (requires `SUPABASE_URL` and `SUPABASE_KEY` set in env)

#### Manual Verification

- Importing `Plan` and `NewPlan` from `@/types/database` in a scratch `.ts` file resolves without errors

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Manual Testing Steps

1. Apply migration to the Supabase project via `supabase db push` — no errors
2. Sign in as User A; insert a plan row via Supabase client; select all plans — see exactly 1 row
3. Sign in as User B; select all plans — see 0 rows (RLS working)
4. As User A, delete the plan row — row disappears
5. Delete User A's auth account — confirm plans are cascade-deleted (check via Supabase dashboard or query as service role)

## References

- Roadmap F-01: `context/foundation/roadmap.md`
- PRD refs: FR-007, FR-009, FR-011, FR-012
- Supabase client: `src/lib/supabase.ts`
- Supabase config: `supabase/config.toml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Supabase Migration

#### Automated

- [x] 1.1 Migration file exists at `supabase/migrations/20260528000000_create_plans_table.sql` — 2297a10

#### Manual

- [x] 1.2 Migration applies without errors (remote: supabase db push; local: supabase start) — 2297a10
- [x] 1.3 Authenticated user can INSERT/SELECT their own plans — 2297a10
- [x] 1.4 Different authenticated user sees 0 rows (RLS verified) — 2297a10
- [x] 1.5 DELETE by owner removes row; cross-user DELETE affects 0 rows — 2297a10

### Phase 2: TypeScript Types

#### Automated

- [x] 2.1 `npm run lint` passes with no TypeScript errors — b5a1f2e
- [x] 2.2 `npm run build` passes — b5a1f2e

#### Manual

- [x] 2.3 `Plan` and `NewPlan` imports from `@/types/database` resolve without errors — b5a1f2e
