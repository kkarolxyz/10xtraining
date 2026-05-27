# Plans DB Schema — Plan Brief

> Full plan: `context/changes/plans-db-schema/plan.md`

## What & Why

Create the `plans` table and RLS policies in Supabase so the application has a place to store and retrieve training plans. This is foundation item F-01 — S-01 (the core user flow: generate and save a plan) cannot proceed until this table exists.

## Starting Point

Supabase client and auth are fully wired (`src/lib/supabase.ts`, `src/pages/api/auth/`). The `supabase/migrations/` directory does not exist; `config.toml` has `schema_paths = []`. No plan-related table, RLS policies, or TypeScript types exist yet.

## Desired End State

A migration file applies cleanly, creating a `plans` table with 7 columns and 3 RLS policies (SELECT / INSERT / DELETE) scoped to the authenticated user. A TypeScript `Plan` interface in `src/types/database.ts` makes every Supabase plan query in S-01 type-safe. Each user sees only their own plans; deleting an auth account cascades to all associated plans automatically.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Plan content format | JSONB column | Structured access to weekly sessions benefits S-03 regeneration and future display logic | Plan |
| Input data retention | Store `ride_stats TEXT` + `goal TEXT` with each plan | Enables S-03 to pre-fill the form without re-asking the user for their ride stats | Plan |
| Auto-name strategy | Application layer sets name before INSERT | Easier to test and change without requiring a DB migration | Plan |
| UPDATE policy | Omitted | Plan editing is out of scope in MVP (FR-010 demoted to nice-to-have) | Plan |
| Cascade on user delete | `ON DELETE CASCADE` on `user_id` | S-04 requires plans to be deleted when the account is deleted (FR-012) | Plan |
| `config.toml` | Leave untouched | `schema_paths` is for declarative schema files; `migrations/` is picked up automatically by the CLI | Plan |
| TypeScript types | Hand-written `Plan` interface | `supabase gen types` requires a running instance; a manual interface is sufficient for S-01 | Plan |

## Scope

**In scope:** `plans` table DDL, RLS policies (SELECT / INSERT / DELETE), TypeScript `Plan` / `NewPlan` / `PlanGoal` types in `src/types/database.ts`

**Out of scope:** `user_id` index, UPDATE RLS policy, `supabase gen types` output, any API route or UI code

## Architecture / Approach

Single SQL migration file covers table creation and all RLS in one transaction. TypeScript types are hand-written to match the migration exactly — no code-generation tooling required. `plan` JSONB column is typed as `Record<string, unknown>` and will be narrowed to a specific interface once the LLM output shape is known in F-02/S-01.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Supabase Migration | `plans` table + RLS applied to the DB | Migration filename must follow Supabase's `YYYYMMDDHHMMSS_*.sql` convention or the CLI will reject it |
| 2. TypeScript Types | `Plan`, `NewPlan`, `PlanGoal` in `src/types/database.ts` | Type shape must be kept in sync with the migration manually until `supabase gen types` is wired up |

**Prerequisites:** Supabase project credentials (`SUPABASE_URL`, `SUPABASE_KEY`) must be set; Supabase CLI must be available to push the migration  
**Estimated effort:** ~1 short session, 2 phases

## Open Risks & Assumptions

- If `supabase link` hasn't been run against the target project, `supabase db push` will fail — this is a setup issue, not a code issue
- The `plan` JSONB column shape will need to be narrowed to a specific interface once F-02 (LLM wiring) establishes the output structure

## Success Criteria (Summary)

- `supabase db push` applies without errors and the `plans` table is visible in the Supabase dashboard with all 7 columns
- Authenticated user can INSERT / SELECT / DELETE their own plans; RLS blocks cross-user reads
- `npm run build` passes with the new type definitions in place
