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

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
