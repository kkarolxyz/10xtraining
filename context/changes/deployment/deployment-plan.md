# Cloudflare Deployment Plan — 10xTraining

## Context

The 10xTraining app (Astro 6 SSR + React 19 + Supabase auth) needs its first production deployment to Cloudflare.

**Deployment model:** Cloudflare Workers via `wrangler deploy` — GitHub Actions runs lint + build + deploy on every push to `master`. No Cloudflare dashboard Git integration needed.

**Why Workers, not Pages:** `@astrojs/cloudflare` v13 dropped Cloudflare Pages support. The adapter now targets Workers exclusively. Build output is `dist/server/entry.mjs` (worker) + `dist/client/` (static assets via Workers Assets binding), not `dist/_worker.js`.

**Environment:** Production only.

**Architecture note:** `npm run build` generates `dist/server/wrangler.json` (derived from `wrangler.jsonc`) with `"no_bundle": true` and correct relative paths (`main: "entry.mjs"`, `assets.directory: "../client"`). Deploy uses this generated config: `wrangler deploy --config dist/server/wrangler.json`. The root `wrangler.jsonc` is used for local `wrangler dev` only.

**SESSION KV:** The adapter auto-enables Astro sessions backed by a Cloudflare KV namespace bound as `SESSION`. This binding is required even if the app never calls `Astro.session` — the generated config always includes it. A KV namespace must be created and its ID added to `wrangler.jsonc` before the first deploy.

---

## Decisions

| Decision | Value |
|---|---|
| Worker name | `10xtraining` |
| Production URL | `https://10xtraining.k-kalist928.workers.dev` |
| OpenRouter key | Deferred — add when AI feature is built |
| Deploy trigger | GitHub Actions — `wrangler deploy` on push to `master` |
| Preview deploys | None (production only) |
| Supabase vars | `--var` flags at deploy time (not `wrangler secret put` — see Phase 5) |
| SESSION KV namespace | Created in Phase 4 (`a51fc8a99e704debba9a14962f8d7310`) |

---

## Prerequisites

Complete these before Phase 1. Each is a hard dependency.

---

### Prereq A — Node.js v22

> Node v24 is installed locally — build passes, but Cloudflare's build environment targets v22 and CI uses v22. Keep local Node at v22 if divergence causes issues.

- [ ] Verify CI config uses `node-version: 22` (already set in `.github/workflows/ci.yml`)
- [ ] Local dev: `node --version` → if not v22, use `nvm use` (`.nvmrc` pins `22.14.0`)

---

### Prereq B — Install project dependencies

Wrangler is already a dev dependency — no global install needed.

- [ ] `npm ci` — installs all deps including `wrangler@^4.90.0`
- [ ] Verify Wrangler: `npx wrangler --version` → should print `4.x.x`

---

### Prereq C — Supabase cloud project

> The `supabase/config.toml` has no SQL migrations (`schema_paths = []`). Database schema is managed through the Supabase dashboard. No `supabase db push` needed.

- [ ] **[MANUAL]** Create a Supabase account at [supabase.com](https://supabase.com) (free tier covers MVP)
- [ ] **[MANUAL]** Create a new project:
  - Name: `10xtraining`
  - Region: **Frankfurt (`eu-central-1`)** — closest to Poland, reduces cross-region latency
  - Set a strong database password and save it
- [ ] **[MANUAL]** Get credentials from **Settings → API**:
  - `SUPABASE_URL` — the Project URL (`https://<ref>.supabase.co`)
  - `SUPABASE_KEY` — the **anon/public** key
- [ ] **[MANUAL]** Configure Auth redirect URLs — **Authentication → URL Configuration**:
  - **Site URL** → `https://10xtraining.k-kalist928.workers.dev`
  - **Redirect URLs** → add `https://10xtraining.k-kalist928.workers.dev/**`
- [ ] **[OPTIONAL]** Enable email confirmations — **Authentication → Providers → Email → Confirm email**:
  - The app has a `/auth/confirm-email` route for this flow

---

### Prereq D — Local secrets files

Two separate files are required — missing either causes silent failures (documented in CLAUDE.md).

- [ ] Copy `.env.example` to `.env` and fill in both values:
  ```
  SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_KEY=<anon-key>
  ```
- [ ] Copy `.env.example` to `.dev.vars` and fill in the same values
  - `.env` → used by `npm run build`
  - `.dev.vars` → used by `npx wrangler dev` (Cloudflare runtime)
  - Both must be kept in sync; neither is committed to git

---

## Phase 1 — Local pre-flight ✅

> Build and lint are confirmed clean.

- [x] `.env` and `.dev.vars` exist with `SUPABASE_URL` + `SUPABASE_KEY`
- [x] `npm run lint` — passes (CRLF issues auto-fixed via `lint:fix`)
- [x] `npm run build` — generates `dist/server/` and `dist/client/`
- [x] `dist/server/entry.mjs` exists (worker entry point)
- [x] `dist/server/wrangler.json` exists (generated deploy config)
- [ ] Check bundle size: `dist/server/entry.mjs` + chunks must be under 10 MB compressed (Workers free tier limit)
- [ ] `npm run dev` — smoke test: `/dashboard` (unauthenticated) redirects to `/auth/signin`

---

## Phase 2 — Cloudflare authentication `[MANUAL]`

- [ ] **[MANUAL]** `npx wrangler login` — browser OAuth, stores credentials locally
- [ ] `npx wrangler whoami` — confirms account email and prints **Account ID** (save it)

---

## Phase 3 — wrangler.jsonc name ✅

- [x] `wrangler.jsonc`: `"name"` is `"10xtraining"`

---

## Phase 4 — Create SESSION KV namespace and configure wrangler.jsonc `[MANUAL + CODE]`

> The adapter requires a KV namespace bound as `SESSION`. Create it, add the ID to `wrangler.jsonc`, then rebuild so the generated deploy config includes the ID.

- [ ] Create the KV namespace:
  ```bash
  npx wrangler kv namespace create SESSION
  ```
  Output includes `id = "..."` — save this value.

- [ ] **[MANUAL]** Edit `wrangler.jsonc` — add the `kv_namespaces` block with the ID from the previous step:
  ```jsonc
  "kv_namespaces": [
    { "binding": "SESSION", "id": "<paste-id-here>" }
  ],
  ```

- [ ] Rebuild so the generated deploy config picks up the KV ID:
  ```bash
  npm run build
  ```

- [ ] Verify the ID is now in the generated config:
  ```bash
  node -e "const d=require('./dist/server/wrangler.json'); console.log(d.kv_namespaces)"
  ```
  Must print `[ { binding: 'SESSION', id: '<your-id>' } ]` — not an empty id.

---

## Phase 5 — Set production vars ✅

> **Discovery during deploy:** `wrangler secret put` stores encrypted secrets that do NOT surface through `import { env } from "cloudflare:workers"` in a `no_bundle` ESM Worker — the Astro env module reads `undefined` for them. Both `SUPABASE_URL` and `SUPABASE_KEY` are Supabase *anon/public* keys (designed to be client-visible), so plaintext `vars` are the correct mechanism. Pass them via `--var` at deploy time so they appear in the Worker's env binding.

- [x] Confirmed: `wrangler secret put` does not work with this adapter/bundle configuration
- [x] Confirmed: `--var` flag in `wrangler deploy` correctly exposes values via `cloudflare:workers` env
- [x] `SUPABASE_URL` and `SUPABASE_KEY` deployed as `vars` via `--var` flags
- [x] Supabase connectivity confirmed live

**How to deploy with vars (local):**
```bash
set -a && source .env && set +a
npm run deploy -- --var "SUPABASE_URL:${SUPABASE_URL}" --var "SUPABASE_KEY:${SUPABASE_KEY}"
```

**How CI deploys (Phase 7):** ci.yml passes `--var` flags using GitHub Secrets — already wired in `.github/workflows/ci.yml`.

---

## Phase 6 — First deploy ✅

- [x] Deploy to production:
  ```bash
  npm run deploy
  ```
  This runs `wrangler deploy --config dist/server/wrangler.json`.

- [x] Note the output URL — `https://10xtraining.k-kalist928.workers.dev` (Version ID: dad5688e-4a98-4b4d-9eae-9267c88eab8d)
- [x] Bundle: 1910 KiB / gzip: 390 KiB — well under the 10 MB limit
- [ ] Test route protection (unauthenticated): `GET /dashboard` → must redirect to `/auth/signin`
- [ ] Test auth flow: sign up → sign in → `/dashboard` renders correctly
- [ ] Tail live logs:
  ```bash
  npx wrangler tail 10xtraining
  ```

### ⚠️ Edge case: SSR middleware bug `[object Object]`

**Risk:** `infrastructure.md` documents Astro issue #14511 — `compatibility_date >= 2025-09-15` can make SSR middleware return `[object Object]` instead of a redirect. Current `wrangler.jsonc` has `"2026-05-08"` (post-bug date).

**Trigger:** `/dashboard` (unauthenticated) returns `[object Object]` in the browser.

**Fallback if triggered:**
1. In `wrangler.jsonc`, change `"compatibility_date"` to `"2025-08-01"`
2. Rebuild and redeploy: `npm run build && npm run deploy`
3. Re-test middleware redirect ✓
4. Monitor [astro#14511](https://github.com/withastro/astro/issues/14511) for upstream fix

---

## Phase 7 — Wire up GitHub Actions for CI + auto-deploy `[MANUAL + CODE]`

> After this phase, every push to `master` automatically lints, builds, and deploys to `https://10xtraining.workers.dev`.

### Step 1 — Create a scoped Cloudflare API token `[MANUAL]`

- [ ] **[MANUAL]** Cloudflare dashboard → **My Profile → API Tokens → Create Token**
- [ ] Use the **"Edit Cloudflare Workers"** template
- [ ] Scope it to **Account: your account**, **Zone Resources: All zones** (or restrict to none if no custom domain)
- [ ] Save the token value — shown only once

### Step 2 — Add secrets to GitHub `[MANUAL]`

- [ ] **[MANUAL]** GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
  - `SUPABASE_URL` = same value as wrangler secret
  - `SUPABASE_KEY` = same value as wrangler secret
  - `CLOUDFLARE_API_TOKEN` = token from Step 1
  - `CLOUDFLARE_ACCOUNT_ID` = Account ID from `npx wrangler whoami`

### Step 3 — Update CI workflow

The `.github/workflows/ci.yml` already runs lint + build. Add a deploy job that runs after CI passes on `master`:

- [ ] Update `.github/workflows/ci.yml` — see the deploy job already added to the file

### Step 4 — Verify

- [ ] Push a test commit to `master` and confirm GitHub Actions runs both jobs (ci + deploy)
- [ ] Confirm the Worker URL is live after the deploy job completes

---

## Phase 8 — Ongoing operations

### Auto-deploy flow (after setup)

1. Push to `master`
2. GitHub Actions `ci` job: lint + build (validation)
3. GitHub Actions `deploy` job (runs after `ci`): `wrangler deploy --config dist/server/wrangler.json`
4. Changes are live at `https://10xtraining.workers.dev` within ~30 seconds of the deploy job

### Rollback

```bash
# List recent deployments
npx wrangler deployments list --name 10xtraining

# Roll back to the previous deployment
npx wrangler rollback --name 10xtraining

# Roll back to a specific deployment ID
npx wrangler rollback <deployment-id> --name 10xtraining
```

> DB changes are NOT reverted automatically — coordinate Supabase rollbacks separately.

### Log tailing

```bash
npx wrangler tail 10xtraining
# Filter to errors only:
npx wrangler tail 10xtraining --format pretty --status error
```

### Adding a new secret

```bash
npx wrangler secret put SECRET_NAME
# Then add to GitHub repo secrets for CI builds
```

---

## Additional edge cases

### `.dev.vars` vs production secrets divergence

**Risk:** Three separate secret stores: `.dev.vars` (local), GitHub Secrets (CI build), `wrangler secret put` (Workers production). Any mismatch produces auth failures that look like code bugs.

**Check after setup:** Cold test in an incognito window after first deploy. If Supabase auth fails silently → production secrets set via `wrangler secret put` are missing or misnamed (`wrangler secret list` to verify).

### KV namespace ID missing from generated config

**Risk:** If `wrangler.jsonc` doesn't have the SESSION KV `id`, the generated `dist/server/wrangler.json` won't have it either, and `wrangler deploy` will fail with a binding error.

**Check:** After Phase 4 rebuild, always verify the ID is present before deploying:
```bash
node -e "const d=require('./dist/server/wrangler.json'); console.log(d.kv_namespaces)"
```

### Node.js version mismatch

**Risk:** Local Node v24 vs CI/Cloudflare build expectation of v22. Build currently passes on v24, but any new dependency that requires v22-specific behavior would diverge silently.

**Mitigation:** CI pinned to Node 22 in `.github/workflows/ci.yml`. Keep `.nvmrc` at `22.14.0`.

### Bundle size wall

**Risk:** Workers free tier limit is 10 MB compressed for the worker script (`entry.mjs` + chunks in `dist/server/`). The error surfaces during deploy, not during `npm run build`.

**Check:** After first deploy, inspect the `wrangler deploy` output for the bundle size. If > 8 MB, plan for Workers Paid ($5/month) before adding the next heavy dependency.

### Supabase cross-region latency

**Risk:** Workers execute at the CDN edge nearest the user; Supabase lives in a fixed AWS region (Frankfurt). Sequential auth + data calls stack to 1.2–1.4 s before any LLM call.

**MVP posture:** Accept the latency. Measure real round-trip via `wrangler tail` on day one. Use `Promise.all` to parallelize independent Supabase calls when performance complaints surface.

---

## Files modified

| File | Phase | Change |
|---|---|---|
| `wrangler.jsonc` | Phase 3 ✅ | `"name"` → `"10xtraining"` |
| `wrangler.jsonc` | Phase 4 ✅ | Add `"kv_namespaces"` with SESSION namespace ID (`a51fc8a99e704debba9a14962f8d7310`) |
| `package.json` | Phase 6 ✅ | Add `"deploy"` script: `wrangler deploy --config dist/server/wrangler.json` |
| `.github/workflows/ci.yml` | Phase 7 ✅ | Add `deploy` job (runs after `ci` on push to `master`) |

---

## Out of scope

- Custom domain setup (`workers.dev` subdomain sufficient for MVP)
- `OPENROUTER_API_KEY` (deferred until AI feature is built)
- SESSION KV preview namespace (only production `id` wired for MVP)
- Workers Paid upgrade (monitor bundle size first)
- Supabase schema migrations (managed separately)
