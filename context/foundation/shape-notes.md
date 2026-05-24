---
project: "10xTraining"
context_type: greenfield
created: 2026-05-24
updated: 2026-05-24
<!-- finalized -->
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 11
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction — the process of creating a quality plan is too tedious to do regularly"
    - topic: "product insight"
      decision: "the cyclist's own past ride data is the best input; generic plans ignore actual baseline fitness"
    - topic: "primary persona scope"
      decision: "amateur cyclists across many contexts — hobbyist niche; not working with a professional coach"
    - topic: "auth model"
      decision: "login — email + password or OAuth; user accounts store plans server-side"
    - topic: "role model"
      decision: "flat — single user type; each user sees only their own plans; no admin/coach roles in MVP"
  quality_check_status: accepted
---

## Vision & Problem Statement

Manually creating a high-quality weekly cycling training plan is time-consuming — amateur cyclists who want to improve their speed or distance either skip structured training altogether or spend significant effort doing it by hand. Both outcomes discourage consistent progress.

The insight: a cyclist's own past ride data (average speed, ride time, elevation) is the most accurate baseline for a personalized training prescription. Generic training templates ignore this data; no accessible tool currently turns raw paste-in ride stats into a goal-specific weekly plan.

## User & Persona

**Primary persona**: An amateur cyclist riding regularly for fitness and personal improvement. They track their rides (time, speed, elevation) but do not have a personal coach. They want to improve — either get faster or ride longer — but lack the coaching knowledge to translate their past performance into a structured training program. They're motivated to train; the barrier is the planning step, not willpower.

## Access Control

Multi-user web app. Users authenticate with email + password or OAuth. Flat role model: every registered user is equal — they see and manage only their own training plans. No admin, coach, or guest roles in MVP. Unauthenticated users cannot access any plan data.

## Success Criteria

### Primary
- A cyclist pastes their last month's ride stats (avg speed, time, elevation as text), picks a goal (speed or distance), receives a structured weekly training plan, and saves it to their account.
- Measured by: 75% of generated plans are saved by the user.

### Secondary
- Retained engagement: 60% of registered users generate more than 1 plan, signaling the first plan was useful enough to return.

### Guardrails
- Generated plans must be structurally coherent: no duplicate sessions in the same week, at least one rest day per week, visible load progression across weeks.
- Manual plan creation is NOT in v1 scope — adding it must not be a reason to delay shipping the generated plan path.

## Functional Requirements

### Authentication
- FR-001: User can register with email + password. Priority: must-have
  > Socrates: Counter-argument considered: "building own auth is undifferentiated and introduces security risk." Resolution: FRs stand as written; the implementation choice (own auth vs. third-party provider) is a downstream stack decision, not an FR concern.
- FR-002: User can log in to their account. Priority: must-have
  > Socrates: See FR-001 note — same resolution applies.
- FR-003: User can log out. Priority: must-have
  > Socrates: See FR-001 note — same resolution applies.

### Plan generation
- FR-004: User can paste last month's ride stats (average speed, ride time, elevation — plain text) as the input for plan generation. Priority: must-have
  > Socrates: Counter-argument considered: "plain text is brittle; users will paste inconsistently." Resolution: kept; plain text paste is the deliberate MVP trade-off to avoid third-party integrations while proving core value. Input validation (sparse/empty input) is captured in US-01 acceptance criteria.
- FR-005: User can select a training goal (speed improvement or distance improvement) before generating. Priority: must-have
  > Socrates: Counter-argument considered: "could a user have both goals at once?" Resolution: kept as hard binary — speed and distance require different training prescriptions; combining them would produce an incoherent plan.
- FR-006: User can generate a weekly training plan based on their pasted stats and chosen goal. Priority: must-have
  > Socrates: Counter-argument considered: "a bad plan is worse than no plan — users could overtrain." Resolution: kept; plan quality is the core guardrail (structural coherence check in Success Criteria). The quality gate is addressed by output structure constraints, not by removing the FR.

### Plan management
- FR-007: User can save a generated plan to their account. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.
- FR-008: User can give a saved plan a custom name. Priority: nice-to-have
  > Socrates: Counter-argument accepted: "auto-naming (e.g. 'Speed plan — May 2026') is good enough for MVP; custom naming adds form friction." Demoted to nice-to-have. Auto-generated name based on goal + date is sufficient for MVP.
- FR-009: User can view their list of saved plans. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.
- FR-010: User can edit a saved plan. Priority: nice-to-have
  > Socrates: Counter-argument accepted: "edit is scope creep — if the generated plan needs changing, regenerate instead." Demoted to nice-to-have. Delete + regenerate covers the primary use case in MVP.
- FR-011: User can delete a saved plan. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.

## User Stories

### US-01: Cyclist generates and saves a training plan

- **Given** a logged-in user with no prior plans
- **When** they paste their last month's ride stats, select "speed improvement" as their goal, and trigger plan generation
- **Then** they see a structured weekly training plan with sessions per day for each week, clearly labelled as a speed improvement plan, and can save it to their account with a custom name

#### Acceptance Criteria
- The plan displays individual sessions for each day of each week (not a summary description)
- The plan header or label clearly shows which goal it was generated for (speed or distance)
- If the pasted stats are too sparse (e.g. empty input or a single ride), the user sees an error or guidance — no silent junk output
- After saving, the plan appears in the user's plan list with the custom name they entered (or an auto-generated name if custom naming is not in v1)

## Business Logic

Given a cyclist's last month of ride data and a training goal, the app prescribes a 4-week weekly session structure that progressively builds the specific fitness component — speed or endurance — that the goal requires.

The rule consumes three user-facing inputs: average speed, total ride time, and total elevation across the past month's rides (pasted as plain text), plus the cyclist's chosen goal (speed improvement or distance improvement). The output is a 4-week plan: one week per block, each week broken into per-day training sessions, with visible load progression across the four weeks. The cyclist encounters the plan immediately after submitting their stats and goal — they review it in full before deciding whether to save it.

The plan structure differs meaningfully by goal: a speed-improvement plan concentrates interval-type sessions and recovery work; a distance-improvement plan concentrates endurance-type sessions and graduated volume increases. The app does not produce a single generic plan for both goals — goal selection is a hard input that changes the prescription.

## Non-Functional Requirements

- A cyclist's generated plan is visible within 30 seconds of submitting their stats and goal (user-perceived response time).
- The product is usable on the latest two major versions of the four mainstream desktop browsers (Chrome, Firefox, Safari, Edge).
- A user's ride stats and training plans are never visible to or retrievable by any other user — data isolation is absolute.

## Non-Goals

- **No third-party integrations (Strava, Garmin, etc.)**: ride stats are entered by pasting plain text; no OAuth flows or API syncing with external training platforms in v1.
- **No multiple import formats (PDF, DOCX, CSV, GPX)**: plain text paste is the only input mechanism; file parsing is out of scope.
- **No plan sharing between users**: plans are private to the creating user; no public plans, sharing links, or coach-to-athlete workflows.
- **No manual plan creation**: v1 generates plans from stats + goal only; user-authored plans from scratch are deferred to v2.
- **No mobile apps**: web only in v1; native iOS or Android apps are out of scope.
- **No route-specific training**: goals are generic (speed improvement or distance improvement); integrations with route-planning apps or preparation for specific trails/routes are out of scope.
- **No plan editing**: delete the plan and regenerate with adjusted input is the v1 workflow; a full session editor is deferred.

<!-- PRD frontmatter scaffold (for /10x-prd) -->
<!-- product_type: web-app -->
<!-- target_scale: { users: medium, qps: low, data_volume: small } -->
<!-- timeline_budget: { mvp_weeks: 3, hard_deadline: null, after_hours_only: true } -->

## Quality cross-check

Run: 2026-05-24. Result: all elements present.

- Access Control: present
- Business Logic (one-sentence rule): present
- Project artifacts: present
- Timeline-cost acknowledged: present (mvp_weeks: 3, ≤ 3)
- Non-Goals: present (7 entries)
- Preserved behavior: n/a (greenfield)
