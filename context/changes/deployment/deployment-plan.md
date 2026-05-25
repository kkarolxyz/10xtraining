# Cloudflare Deployment Plan — 10xTraining

## Context

The 10xTraining app (Astro 6 SSR + React 19 + Supabase auth) needs its first production deployment to Cloudflare. The project is already scaffolded with `@astrojs/cloudflare` v13 adapter.

**Deployment model:** Cloudflare Pages Git integration — GitHub repo is connected directly in the Cloudflare dashboard; every push to `master` triggers a build + deploy on Cloudflare's infrastructure automatically. No GitHub Actions deploy step needed (existing CI only lint + build for validation).

**Environment:** Production only (no preview deployments).

**Architecture note:** The `@astrojs/cloudflare` adapter outputs `dist/_worker.js` (SSR) + static assets. Cloudflare Pages detects `_worker.js` automatically and deploys it as a Pages Function. The `wrangler.jsonc` with `assets` binding is used for local `wrangler dev` only — the Pages build pipeline ignores it.

---

## Decisions

| Decision | Value |
|---|---|
| Worker/project name | `10xtraining` |
| OpenRouter key | Deferred — add when AI feature is built |
| Deploy trigger | Cloudflare Pages Git integration (push to `master`) |
| Preview deploys | Disabled (production only) |
| Secrets storage | Cloudflare Pages dashboard → Environment Variables |

---

## Prerequisites

Complete these before Phase 1. Each is a hard dependency — skipping any causes silent failures later.

---

### Prereq A — Node.js v22

- [ ] Verify Node version: `node --version` → must be `v22.x.x`
- [ ] If using nvm: `nvm use` (`.nvmrc` pins `22.14.0` and is already in the repo)
- [ ] If Node 22 is not installed: `nvm install 22` or download from [nodejs.org](https://nodejs.org)

---

### Prereq B — Install project dependencies

Wrangler is already a dev dependency — no global install needed.

- [ ] `npm ci` — installs all deps including `wrangler@^4.90.0`
- [ ] Verify Wrangler: `npx wrangler --version` → should print a version number

---

### Prereq C — Supabase cloud project

> The `supabase/config.toml` has no SQL migrations (`schema_paths = []`). The database schema is managed through the Supabase dashboard. No `supabase db push` step is needed for this deploy.

- [ ] **[MANUAL]** Create a Supabase account at [supabase.com](https://supabase.com) (free tier covers MVP)
- [ ] **[MANUAL]** Create a new project:
  - Choose a name (e.g., `10xtraining`)
  - Choose a region close to your primary users — Poland → **Frankfurt (`eu-central-1`)** reduces cross-region latency (see infrastructure.md latency risk)
  - Set a strong database password and save it somewhere safe
- [ ] **[MANUAL]** Get credentials from **Settings → API**:
  - `SUPABASE_URL` — the Project URL (`https://<ref>.supabase.co`)
  - `SUPABASE_KEY` — the **anon/public** key (safe for server-side SSR use)
- [ ] **[MANUAL]** Configure Auth redirect URLs — **Authentication → URL Configuration**:
  - **Site URL** → `https://10xtraining.pages.dev`
  - **Redirect URLs** → add `https://10xtraining.pages.dev/**`
  - Without this, email confirmation links and post-auth redirects will be blocked by Supabase
- [ ] **[OPTIONAL]** Enable email confirmations — **Authentication → Providers → Email → Confirm email**:
  - The app has a `/auth/confirm-email` route for this flow
  - Local `config.toml` has it disabled (`enable_confirmations = false`) for dev convenience
  - Recommended: enable for production to verify user email ownership

---

### Prereq D — Local secrets files

Two separate files are required — missing either causes silent failures (documented in CLAUDE.md).

- [ ] Copy `.env.example` to `.env` and fill in both values:
  ```
  SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_KEY=<anon-public-key>
  ```
- [ ] Copy `.env.example` to `.dev.vars` and fill in the same values
  - `.env` → used by `npm run build`
  - `.dev.vars` → used by `npx wrangler dev` (Cloudflare runtime)
  - Both must be kept in sync; neither is committed to git (already in `.gitignore`)

---

## Phase 1 — Local pre-flight

> Confirm the build is clean before touching Cloudflare.

- [ ] Confirm both `.env` and `.dev.vars` exist with `SUPABASE_URL` + `SUPABASE_KEY`
- [ ] `npm run lint` — must pass
- [ ] `npm run build` — generates `dist/`; requires secrets in env
- [ ] Confirm `dist/_worker.js` exists after build (Pages detects this automatically)
- [ ] Check bundle size: `dist/_worker.js` must be under 10 MB compressed (free tier limit)
- [ ] `npm run dev` — smoke test: `/dashboard` (unauthenticated) redirects to `/auth/signin`

---

## Phase 2 — Cloudflare authentication `[MANUAL]`

- [ ] **[MANUAL]** `npx wrangler login` — browser OAuth, stores credentials locally
- [ ] `npx wrangler whoami` — confirms account email and prints **Account ID** (save it)

---

## Phase 3 — Rename wrangler.jsonc before first deploy ✅

> The `name` field is used for local `wrangler dev`. Renamed for consistency with the project name everywhere.

- [x] `wrangler.jsonc`: `"name"` changed from `"10x-astro-starter"` → `"10xtraining"`

---

## Phase 4 — Create Cloudflare Pages project `[MANUAL]`

> Create the Pages project in the Cloudflare dashboard and connect it to GitHub.

- [ ] **[MANUAL]** Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Pages → Connect to Git
- [ ] Select the GitHub account and repo for this project
- [ ] Set branch to deploy: `master`
- [ ] Set **Build command:** `npm run build`
- [ ] Set **Build output directory:** `dist`
- [ ] Set **Root directory:** `/` (default — leave empty)
- [ ] Expand **Environment variables** section and add (for Production):
  - `SUPABASE_URL` = your Supabase project URL
  - `SUPABASE_KEY` = your Supabase anon/service key
- [ ] Set **Node.js version** to `22` (under Environment Variables, add `NODE_VERSION = 22`)
  - The project has `.nvmrc` pinning v22.14.0; Cloudflare Pages reads this automatically if present — verify after first build
- [ ] Click **Save and Deploy** — this triggers the first build

---

## Phase 5 — Disable preview deployments `[MANUAL]`

> Production-only: prevent branches from generating public preview URLs.

- [ ] **[MANUAL]** In the Pages project → Settings → Builds & deployments → Preview deployments
- [ ] Set to **None** (disables all preview builds)

---

## Phase 6 — Verify first deploy

- [ ] Monitor the build log in the Cloudflare dashboard — watch for build errors
- [ ] Note the production URL: `https://10xtraining.pages.dev` (or custom domain)
- [ ] Test route protection (unauthenticated): `GET /dashboard` → must redirect to `/auth/signin`
- [ ] Test auth flow: sign up → sign in → `/dashboard` renders correctly
- [ ] Tail live logs: `npx wrangler pages deployment tail --project-name 10xtraining`

### ⚠️ Edge case: SSR middleware bug `[object Object]`

**Risk:** `infrastructure.md` documents Astro issue #14511 — `compatibility_date >= 2025-09-15` can make SSR middleware return `[object Object]` instead of a redirect. Current `wrangler.jsonc` has `"2026-05-08"` (post-bug date). Cloudflare Pages uses its own internal compatibility date, which may differ.

**Trigger:** `/dashboard` (unauthenticated) returns `[object Object]` in the browser.

**Fallback if triggered:**
1. In the Pages dashboard → Settings → Functions → Compatibility date — set to `2025-08-01`
2. Redeploy (push an empty commit or use "Retry deployment" button)
3. Re-test middleware redirect ✓
4. Monitor [astro#14511](https://github.com/withastro/astro/issues/14511) for upstream fix

---

## Phase 7 — Wire up GitHub Actions for CI builds `[MANUAL]`

> The existing CI pipeline (`ci.yml`) runs `npm run build` which needs `SUPABASE_URL` and `SUPABASE_KEY`. These must be set as GitHub repo secrets so lint+build validation works on PRs.

- [ ] **[MANUAL]** GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
  - `SUPABASE_URL` = same value as Cloudflare Pages
  - `SUPABASE_KEY` = same value as Cloudflare Pages
- [ ] Push a test commit and verify GitHub Actions CI passes (lint + build, no deploy)

*Note: No Cloudflare API token is needed in GitHub — Cloudflare Pages handles deployment independently.*

---

## Phase 8 — Ongoing operations

### Auto-deploy flow (after setup)
1. Push to `master` → GitHub Actions runs lint + build (validation only)
2. Simultaneously, Cloudflare Pages detects the push, runs `npm run build`, deploys `dist/`
3. Two independent pipelines — CI validation and Cloudflare deploy run in parallel

### Rollback
```bash
# List recent deployments
npx wrangler pages deployment list --project-name 10xtraining
# Roll back to a specific deployment
# → Dashboard: Workers & Pages → 10xtraining → Deployments → "Rollback to this deployment"
```
> DB migrations are NOT reverted automatically — coordinate Supabase rollbacks separately.

### Log tailing
```bash
npx wrangler pages deployment tail --project-name 10xtraining
# Or filter errors only via dashboard → Functions → Real-time logs
```

---

## Additional edge cases

### `.dev.vars` vs production secrets divergence

**Risk:** Three separate secret stores: `.dev.vars` (local), GitHub Secrets (CI build), Cloudflare Pages dashboard (production). Any mismatch produces auth failures that look like code bugs.

**Check after setup:** Cold test in an incognito window after first deploy. If Supabase auth fails silently → production secrets in Pages dashboard are missing or misnamed.

### Node.js version mismatch in Cloudflare build

**Risk:** Cloudflare Pages default Node version may differ from the project's v22.14.0 (in `.nvmrc`).

**Mitigation:** Set `NODE_VERSION = 22` as an environment variable in Pages build settings (Phase 4). Cloudflare Pages reads `.nvmrc` automatically as a fallback — confirm in the first build log that Node 22 is used.

### Bundle size wall

**Risk:** Free tier limit is 10 MB compressed for the `_worker.js` bundle. The error only surfaces during deploy, not during `npm run build`.

**Check:** After first deploy, inspect the Pages build log for the bundle size output. If > 8 MB, plan for Workers Paid ($5/month) before adding the next heavy dependency (e.g., Markdown renderer).

### Supabase cross-region latency

**Risk:** Pages executes at the CDN edge nearest the user; Supabase lives in a fixed AWS region. Sequential auth + data calls stack to 1.2–1.4 s before any LLM call.

**MVP posture:** Accept the latency. Measure real round-trip via Pages real-time logs on day one. Use `Promise.all` to parallelize independent Supabase calls when performance complaints surface.

---

## Files modified

| File | Phase | Change |
|---|---|---|
| `wrangler.jsonc` | Phase 3 ✅ | `"name"` → `"10xtraining"` |

*All other changes are dashboard configuration — no code changes required.*

---

## Out of scope

- Custom domain setup (`.pages.dev` subdomain sufficient for MVP)
- `OPENROUTER_API_KEY` (deferred until AI feature is built)
- Cloudflare Access / Zero Trust (no preview URLs to gate)
- Supabase schema migrations (managed separately)
- Workers Paid upgrade (monitor bundle size first)
