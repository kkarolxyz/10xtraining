# LLM Provider Wiring Implementation Plan

## Overview

Wire OpenRouter as the LLM provider, install the OpenAI-compatible SDK, register the API key in the env schema, and create `src/lib/openrouter.ts` — a `generatePlan()` function that calls the model with a structured prompt and returns a validated `TrainingPlan`. This is foundation item F-02; S-01 imports `generatePlan()` directly.

## Current State Analysis

No LLM SDK is installed (`package.json` has no `openai`, `@anthropic-ai/sdk`, or similar). The env schema in `astro.config.mjs` defines only `SUPABASE_URL` and `SUPABASE_KEY` as `envField.string({ context: "server", access: "secret", optional: true })`. The `src/lib/config-status.ts` pattern checks for configured services and surfaces warnings in the UI. The `plan` column in `src/types/database.ts` is currently typed as `Record<string, unknown>` pending this change.

## Desired End State

After this change:
- `openai` npm package is installed (OpenRouter uses the OpenAI-compatible API)
- `OPENROUTER_API_KEY` is registered in `astro.config.mjs` env schema, in `.env.example`, and in `configStatuses`
- `src/lib/openrouter.ts` exports `generatePlan(rideStats: string, goal: PlanGoal): Promise<TrainingPlan>`
  - Rejects sparse input (empty or fewer than 2 non-empty lines) before calling the API
  - Calls `google/gemini-2.5-flash-preview` via OpenRouter with a structured system prompt
  - Returns a validated `TrainingPlan` (`weeks` array non-empty check)
  - Throws a descriptive error on parse failure or invalid structure (HTTP 422 in S-01)
- `src/types/database.ts` narrows the `plan` field from `Record<string, unknown>` to `TrainingPlan`
- S-01 can `import { generatePlan } from "@/lib/openrouter"` and call it with no additional setup

### Key Discoveries

- `astro:env/server` pattern is established: import the new key from `"astro:env/server"` after adding it to `astro.config.mjs` — same as `SUPABASE_URL`/`SUPABASE_KEY`
- OpenAI SDK v4 supports Cloudflare Workers (uses Web Fetch API, edge-compatible)
- `.env` and `.dev.vars` are gitignored; only `.env.example` is committed — the plan adds the key to `.env.example` only
- `configStatuses` in `src/lib/config-status.ts:11` is the existing startup-check array; extend it with one new entry

## What We're NOT Doing

- No streaming — non-streaming JSON response, single API call
- No retries on LLM failure — fail fast with a thrown error; S-01 handles the HTTP response
- No Zod schema validation — structural check only (`weeks` array non-empty); full validation belongs in S-01
- No model configurability via env var — model string hardcoded as a constant; easy to change in S-01
- No unit tests for the prompt — manual verification of the generated plan is sufficient for a scaffold
- No rate limiting or cost controls — out of scope for F-02

## Implementation Approach

Phase 1 sets up the infrastructure (SDK, env, config check) so the project builds cleanly with the new key. Phase 2 adds the AI module and narrows the types. This order means Phase 1 can be committed without any LLM code; Phase 2 is the actual scaffold.

## Critical Implementation Details

The OpenAI SDK must be pointed at OpenRouter by passing `baseURL: "https://openrouter.ai/api/v1"` to the `OpenAI` constructor — without this, it calls OpenAI's servers instead. The `apiKey` field takes the `OPENROUTER_API_KEY` value. No other SDK config is needed for a basic call.

The prompt must instruct the model to return **only valid JSON** with no markdown fences or explanation. Models tend to wrap JSON in ```json blocks without this instruction, which breaks `JSON.parse()`.

---

## Phase 1: Dependencies + Environment Setup

### Overview

Install the OpenAI SDK, register `OPENROUTER_API_KEY` in the Astro env schema and `.env.example`, and add it to `configStatuses` so a missing key is surfaced as a startup warning — matching the existing Supabase pattern.

### Changes Required

#### 1. Install OpenAI SDK

**File**: `package.json` (via `npm install openai`)

**Intent**: Add the `openai` npm package. OpenRouter exposes an OpenAI-compatible REST API, so the OpenAI SDK works as the client with `baseURL` overridden — no separate OpenRouter SDK needed.

**Contract**: `openai` appears in `dependencies`. No other packages needed.

#### 2. Register env variable in Astro schema

**File**: `astro.config.mjs`

**Intent**: Declare `OPENROUTER_API_KEY` as a server-only secret so it's available via `import { OPENROUTER_API_KEY } from "astro:env/server"` and excluded from client bundles.

**Contract**: Add one field inside the existing `env.schema` object, matching the `SUPABASE_URL` pattern exactly:

```js
OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
```

#### 3. Document in .env.example

**File**: `.env.example`

**Intent**: Add the placeholder so developers know the key is required, matching the existing two-line format.

**Contract**: Append `OPENROUTER_API_KEY=###` as a third line. File stays as a committed reference template.

#### 4. Register in configStatuses

**File**: `src/lib/config-status.ts`

**Intent**: Add an `OPENROUTER_API_KEY` entry to the `configStatuses` array so the UI can surface a "not configured" warning when the key is absent — same behaviour as the Supabase entry at line 12.

**Contract**: Import `OPENROUTER_API_KEY` alongside the existing Supabase imports; add one object to the `configStatuses` array with `name: "OpenRouter"`, `configured: Boolean(OPENROUTER_API_KEY)`, and a Polish-language `message` matching the existing style.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no TypeScript errors
- `npm run build` passes (OPENROUTER_API_KEY registered as optional, so build succeeds without it)

#### Manual Verification

- When `OPENROUTER_API_KEY` is absent from `.dev.vars`, the dev server (or any page that renders config warnings) shows an "OpenRouter nie jest skonfigurowany" warning
- `.env.example` contains `OPENROUTER_API_KEY=###` on its own line

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: TypeScript Types + AI Client Module

### Overview

Narrow the `plan` field in `src/types/database.ts` to the agreed `TrainingPlan` shape, then create `src/lib/openrouter.ts` with the `generatePlan()` function that wires together the input guard, prompt, API call, and response validation.

### Changes Required

#### 1. Narrow TrainingPlan types

**File**: `src/types/database.ts`

**Intent**: Replace the placeholder `Record<string, unknown>` type for the `plan` field with a concrete `TrainingPlan` interface so S-01 gets type-safe access to weeks, days, and sessions. Export the new interfaces so S-01 can reference them independently.

**Contract**: Add four new exported interfaces before the existing `PlanGoal` type — `TrainingSession`, `TrainingDay`, `TrainingWeek`, `TrainingPlan` — matching the agreed JSON structure. Update `Plan.plan` from `Record<string, unknown>` to `TrainingPlan`.

```typescript
export interface TrainingSession {
  type: string;
  description: string;
  duration_min: number;
}

export interface TrainingDay {
  day: string;
  session: TrainingSession;
}

export interface TrainingWeek {
  week: number;
  focus: string;
  days: TrainingDay[];
}

export interface TrainingPlan {
  weeks: TrainingWeek[];
}
```

#### 2. Create AI client module

**File**: `src/lib/openrouter.ts`

**Intent**: Encapsulate the entire LLM interaction — input validation, API call, and response validation — in a single `generatePlan()` function that S-01 can call without knowing any OpenRouter details.

**Contract**: Export one function `generatePlan(rideStats: string, goal: PlanGoal): Promise<TrainingPlan>`. Throws `Error` with a descriptive message on sparse input, API failure, JSON parse error, or missing `weeks` array. The model is hardcoded as the constant `MODEL = "google/gemini-2.5-flash"`. The system prompt must include an explicit instruction to return only valid JSON (no markdown) and a one-shot JSON example showing the exact structure. Input sparseness is checked by counting non-empty lines in `rideStats`; fewer than 2 → throw before the API call.

System prompt template (the non-obvious part — the exact wording is what the implementer needs):

```
You are a cycling training coach. Your task is to generate a personalised 4-week training plan.

Cyclist's ride data from the past month:
${rideStats}

Training goal: ${goal === "speed" ? "Speed improvement (faster average speed)" : "Distance improvement (longer rides)"}

Rules:
- Return ONLY valid JSON. No markdown code fences, no explanation, no extra text.
- Exactly 4 weeks. Each week has exactly 7 days: Monday through Sunday.
- At least 1 full rest day (duration_min: 0, type: "rest") per week.
- Progressive load increase across the 4 weeks.
- Speed goal: emphasise interval and threshold sessions.
- Distance goal: emphasise long endurance rides and graduated weekly volume.
- Session types: "rest" | "interval" | "endurance" | "threshold" | "recovery" | "strength".

Required JSON structure:
{
  "weeks": [
    {
      "week": 1,
      "focus": "Base building",
      "days": [
        { "day": "Monday", "session": { "type": "rest", "description": "Full rest day", "duration_min": 0 } },
        { "day": "Tuesday", "session": { "type": "interval", "description": "6x3 min @ 105% FTP with 3 min recovery", "duration_min": 60 } }
      ]
    }
  ]
}
```

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no TypeScript errors
- `npm run build` passes

#### Manual Verification

- Call `generatePlan()` with a realistic ride-stats string (3+ rides, avg speed / time / elevation data) and `goal: "speed"` → returns a `TrainingPlan` with exactly 4 weeks, each with 7 days, at least 1 rest day per week
- Call with `goal: "distance"` → plan sessions emphasise endurance; different character from the speed plan
- Call with an empty string → throws before hitting the API (input guard fires)
- Call with a single-line ride entry → throws before hitting the API
- Remove `OPENROUTER_API_KEY` from env, call `generatePlan()` → fails gracefully with a descriptive error (not a cryptic SDK crash)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to commit.

---

## Testing Strategy

### Manual Testing Steps

1. Add your `OPENROUTER_API_KEY` to `.dev.vars` and `.env`
2. Start the dev server: `npm run dev`
3. In a test script or browser console (or a temporary API route), import and call `generatePlan()` with sample data:
   - Sample speed input: `"Ride 1: 45 min, 28 km/h avg, 320m elevation\nRide 2: 1h 20min, 26 km/h avg, 150m elevation\nRide 3: 2h 05min, 24 km/h avg, 600m elevation\nRide 4: 30 min, 30 km/h avg, 80m elevation"`
4. Verify the returned JSON has 4 weeks × 7 days; confirm at least one rest day per week
5. Repeat with `goal: "distance"` — verify different session types dominate
6. Test the input guard: empty string and single-line string both throw without an API call

## References

- Roadmap F-02: `context/foundation/roadmap.md`
- PRD ref: FR-006
- Supabase client pattern: `src/lib/supabase.ts`
- Config-status pattern: `src/lib/config-status.ts`
- Existing types: `src/types/database.ts`
- Astro env schema: `astro.config.mjs`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dependencies + Environment Setup

#### Automated

- [x] 1.1 `npm run lint` passes — a921a21
- [x] 1.2 `npm run build` passes — a921a21

#### Manual

- [x] 1.3 Missing OPENROUTER_API_KEY surfaces a startup warning in the UI — a921a21
- [x] 1.4 `.env.example` contains `OPENROUTER_API_KEY=###` — a921a21

### Phase 2: TypeScript Types + AI Client Module

#### Automated

- [x] 2.1 `npm run lint` passes with no TypeScript errors — 0d02cb6
- [x] 2.2 `npm run build` passes — 0d02cb6

#### Manual

- [x] 2.3 `generatePlan()` with valid input returns TrainingPlan with 4 weeks × 7 days — 0d02cb6
- [x] 2.4 Speed and distance goals produce visibly different session profiles — 0d02cb6
- [x] 2.5 Empty string input throws before API call (input guard fires) — 0d02cb6
- [x] 2.6 Single-line input throws before API call — 0d02cb6
- [x] 2.7 Missing API key fails gracefully with descriptive error — 0d02cb6
