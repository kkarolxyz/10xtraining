# LLM Provider Wiring — Plan Brief

> Full plan: `context/changes/llm-provider-wiring/plan.md`

## What & Why

Wire OpenRouter as the LLM provider and create a `generatePlan()` function that turns a cyclist's ride stats + goal into a structured 4-week training plan. This is foundation item F-02 — S-01 (the full user flow) cannot proceed until this function exists and returns a valid plan.

## Starting Point

No LLM SDK is installed. `astro.config.mjs` only knows about `SUPABASE_URL`/`SUPABASE_KEY`. The `plan` column in `src/types/database.ts` is typed as `Record<string, unknown>` — a placeholder waiting for the output shape to be decided. `src/lib/config-status.ts` has the pattern for surfacing missing env vars.

## Desired End State

A developer can `import { generatePlan } from "@/lib/openrouter"`, call it with ride stats and a goal, and get back a typed `TrainingPlan` with 4 weeks × 7 days. Sparse input is rejected before the API is called. A missing API key surfaces a warning at startup (not a cryptic runtime crash). `src/types/database.ts` types the plan shape concretely.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| LLM provider | OpenRouter | User's explicit choice; unlocks all models through one API key |
| Model | `google/gemini-2.5-flash-preview` | Fast, cheap, strong JSON output — well within the 30s NFR |
| SDK | `openai` npm package | OpenRouter is OpenAI-API-compatible; set `baseURL` to `https://openrouter.ai/api/v1` |
| Response mode | Non-streaming JSON | Simpler implementation; avoids streaming JSON parse complexity for an MVP scaffold |
| Plan JSON shape | `{ weeks: [{ week, focus, days: [{ day, session: { type, description, duration_min } }] }] }` | Queryable per-week and per-day; maps directly to UI rendering in S-01 |
| Input guard | < 2 non-empty lines → reject before API call | Matches US-01 acceptance criteria; avoids wasting an LLM call on empty input |
| JSON error handling | Throw error (HTTP 422 in S-01) | Fail fast; no retries in the scaffold |
| Schema validation | `weeks` array non-empty check | Catches the most common LLM failure without Zod complexity |
| Config check | Add to `configStatuses` | Follows existing Supabase pattern for startup visibility |

## Scope

**In scope:** `openai` SDK install, `OPENROUTER_API_KEY` env wiring, `configStatuses` registration, `TrainingPlan` type narrowing, `generatePlan()` function with prompt + validation

**Out of scope:** Streaming, retries, Zod validation, model configurability via env var, rate limiting, unit tests

## Architecture / Approach

Phase 1 sets up infrastructure only (SDK, env, config check) — no AI code, project builds cleanly. Phase 2 adds the AI module and narrows types. S-01 imports `generatePlan()` directly from `@/lib/openrouter` with no additional setup.

```
[User input] → generatePlan(rideStats, goal)
  → input guard (< 2 lines → throw)
  → OpenAI SDK (baseURL: openrouter.ai)
    → google/gemini-2.5-flash-preview
  → JSON.parse() → weeks array check → TrainingPlan
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Dependencies + Environment | SDK installed, env var wired, startup warning active | Build must pass with OPENROUTER_API_KEY optional — mark it `optional: true` in schema |
| 2. Types + AI Client Module | `generatePlan()` function + narrowed `TrainingPlan` types | Prompt must instruct model to return bare JSON (no markdown fences) or `JSON.parse()` fails |

**Prerequisites:** An OpenRouter account and API key (obtain at openrouter.ai/keys); add it to `.dev.vars` and `.env` locally  
**Estimated effort:** ~1 session, 2 phases

## Open Risks & Assumptions

- `google/gemini-2.5-flash-preview` is a preview model — may change or be deprecated; swap the model constant if needed before S-01
- The 30s NFR assumes the model responds within ~10-15s for a 4-week plan; verify during manual testing
- Plan quality (coherence, appropriate load progression) is not validated programmatically — it's a manual check during the scaffold phase

## Success Criteria (Summary)

- `generatePlan()` returns a `TrainingPlan` with 4 weeks × 7 days for valid input within 30 seconds
- Empty or single-ride input is rejected before the API is called
- `npm run build` passes with the new types and env var in place
