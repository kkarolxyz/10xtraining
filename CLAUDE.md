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

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
