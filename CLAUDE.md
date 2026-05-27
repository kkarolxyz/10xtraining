# CLAUDE.md

## Code style

- `@/*` path alias resolves to `src/*` — use it for all project imports (see `@tsconfig.json`)
- `react-compiler/react-compiler: "error"` — React Compiler rules are **mandatory**; violations fail lint, not optional
- `astro/no-set-html-directive: "error"` — never use `set:html` in `.astro` files (XSS risk)
- Prefer `class:list` directive over ternary string concatenation for conditional Astro classes
- Pre-commit hook (lint-staged) auto-fixes `.ts`/`.tsx`/`.astro` with ESLint and formats `.json`/`.css`/`.md` with Prettier on every commit

## Supabase

`SUPABASE_URL` and `SUPABASE_KEY` are configured as **server-only** secrets in `@astro.config.mjs` — never exposed to the browser. Supabase client is initialized at `@src/lib/supabase.ts`.

## Local setup

Copy `.env.example` to **both** `.env` and `.dev.vars` before running locally — two files are required. Both must contain `SUPABASE_URL` and `SUPABASE_KEY`. Missing either causes silent failures.

## Commands

- `npm run dev` — Start dev server using the Cloudflare `workerd` runtime (not Node); behaviour may differ from standard Astro dev
- `npm run lint` / `npm run lint:fix` — ESLint with full TypeScript type-checking (`projectService: true`)
- `npm run format` — Prettier across `.astro`, `.ts`, `.tsx`, `.json`, `.css`, `.md`
- `npm run build` — Production build; requires `SUPABASE_URL` and `SUPABASE_KEY` to be set

## Project

AI-powered cycling training plan generator for amateur cyclists. Stack: Astro 6 + React 19, Supabase (auth + DB), Cloudflare Workers/Pages (SSR). Solo MVP on a 3-week timeline.

## Route protection

Protected routes are listed in the `PROTECTED_ROUTES` array in `@src/middleware.ts`. Add a route there to require authentication; the middleware handles redirects.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `npm run lint` then `npm run build` on push/PR to `master`. Requires `SUPABASE_URL` and `SUPABASE_KEY` set as repository secrets in GitHub.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
