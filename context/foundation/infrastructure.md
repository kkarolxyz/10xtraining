---
project: 10xTraining
researched_at: 2026-05-25
recommended_platform: Cloudflare Workers + Pages
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare workerd (@astrojs/cloudflare v13+)
  database: Supabase (external, auth + PostgreSQL)
  ai: OpenRouter (external LLM API)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

The stack was scaffolded with `@astrojs/cloudflare` v13 and the `workerd` runtime as hard targets — Cloudflare is the only platform that runs this adapter without a migration. Combined with a perfect score across all five agent-friendly criteria, existing team familiarity, a free tier that covers the ~100-user MVP scale with headroom (100k requests/day free), and a first-party Claude Code MCP integration, Cloudflare is the clear recommendation. The three known risks — the active SSR middleware bug (#14511), Supabase cross-region latency, and the `compatibility_date` runtime dial — are documented in the risk register with concrete mitigations and do not block MVP launch.

---

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | Pass | Pass | Pass | Pass | Pass | **5 / 5** |
| **Vercel** | Pass | Pass | Pass | Pass | Pass | **5 / 5** |
| **Netlify** | Partial | Pass | Pass | Pass | Pass | **4.5 / 5** |
| **Railway** | Pass | Partial | Pass | Pass | Partial | **4 / 5** |
| **Render** | Partial | Partial | Pass | Pass | Partial | **3.5 / 5** |
| **Fly.io** | Partial | Partial | Fail | Pass | Partial | **3 / 5** |

**Scoring notes per platform:**

**Cloudflare Workers + Pages (5/5):** Wrangler CLI covers every routine operation non-interactively (`wrangler deploy`, `wrangler tail`, `wrangler rollback [version-id]`, `wrangler versions list`). Fully serverless — no VM, no Dockerfile. Agent-readable docs are best in class: `developers.cloudflare.com/llms.txt`, `llms-full.txt`, per-product scoped variants, markdown per page via `/index.md` suffix, and the full doc set on GitHub. Wrangler emits predictable exit codes with `--json` output and no interactive prompts. First-party MCP: Code Mode exposes 2,500+ Cloudflare API endpoints; domain-specific servers for Pages, Observability, DNS Analytics, Workers Bindings.

**Vercel (5/5):** `vercel` CLI with `vercel logs`, `vercel rollback`, `vercel bisect` — all GA and scriptable. Fully managed serverless via Fluid Compute (300s timeout on Hobby, 30s LLM calls fully supported). Docs are best-in-class alongside Cloudflare: `vercel.com/llms.txt`, `vercel.com/docs/llms-full.txt`, Agent Readability Specification. GA MCP server at `mcp.vercel.com` with Claude Code as a named supported client. *Gaps vs. Cloudflare:* requires adapter switch from `@astrojs/cloudflare` to `@astrojs/vercel`; Hobby ToS bars commercial use (Pro = $20/month); active middleware 404 bug (#14423) could silently break route protection; active Astro 6 esbuild script chunk bug (#16258).

**Netlify (4.5/5):** `netlify deploy` (CLI), `netlify logs` (GA May 2026), `netlify/netlify-mcp` (GA Feb 2025). Free tier sufficient (300 credits/month). 60s hard function timeout covers 30s LLM calls. *Gaps:* no CLI rollback — UI only (Partial on CLI-first); `netlify dev` ECONNRESET active bug (#7387); `@astrojs/netlify` 6.4→6.5 breaking change on Edge Functions — must use standard Functions for SSR; requires adapter switch.

**Railway (4/5):** Strong CLI (`railway up`, `railway logs`, `railway variables set`, CI mode). `railway.com/llms.txt` GA. Railpack auto-detects Node.js, no Dockerfile required. *Gaps:* containers are persistent (not serverless), so billing is by uptime not per-request (~$5–10/month on Hobby); rollback is one step back only, no arbitrary historical target; `@railway/mcp-server` is explicitly "Preview / work in progress"; requires adapter switch to `@astrojs/node`.

**Render (3.5/5):** `render deploys create --wait` CLI, `render.com/llms.txt` and `llms-full.txt`. MCP server GA (Aug 2025). *Gaps:* no CLI rollback (Dashboard/REST API only); free tier spins down after 15 min → 30–60s cold starts that breach the 30s response NFR; MCP server cannot trigger deploys; single-region with no CDN for SSR responses; requires adapter switch.

**Fly.io (3/5):** `flyctl` covers deploy, logs, secrets, auto-stop machines. Rollback exists but requires manual image lookup (`fly releases --image` then `fly deploy --image <tag>`). *Critical gap:* no `llms.txt`, HTML-only docs with no bulk LLM-optimized endpoint — Fail on agent-readable docs. `fly mcp server` is explicitly "experimental." No free tier (removed 2024). Requires adapter switch and Dockerfile ownership.

---

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Zero migration cost (existing adapter and dev toolchain), perfect criterion score, team familiarity, generous free tier that covers MVP scale, and Cloudflare's first-party Claude Code MCP integration makes the agent workflow frictionless. The active SSR middleware bug (#14511) is the most significant risk, mitigated by pinning `compatibility_date` to a pre-2025-09-15 value while the upstream fix lands, and by thorough middleware testing on a branch preview before production deploy.

#### 2. Vercel

Tied on scoring criteria and offers the strongest MCP integration of any platform (named Claude Code support in official docs). Loses the tie-breaker to Cloudflare on three counts: adapter migration required, Hobby ToS commercial restriction forces $20/month Pro for any monetized product, and the middleware 404 bug (#14423) is a critical open issue that directly impacts the route-protection pattern this app depends on. Best alternative if the Cloudflare SSR middleware bug proves unworkable.

#### 3. Netlify

Strong across all criteria with the only gap being the absence of a CLI rollback command. Free tier is sufficient. The `netlify/netlify-mcp` server is GA and Claude Code-capable. Falls behind Vercel primarily because of the active Edge Functions breakage in `@astrojs/netlify` 6.5.x (requiring explicit downgrade to standard Functions) and the `netlify dev` ECONNRESET bug that complicates local integration testing.

---

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **Supabase cross-region latency trap.** Workers execute at the edge nearest the user, but Supabase lives in a fixed AWS region. A user in Poland hits a Frankfurt edge, then waits 280–350 ms round-trip to Supabase us-east-1 on every auth check and data fetch. The 30-second NFR survives, but sequential Supabase calls (auth → user data → plan list) stack up to 1.2–1.4 seconds of overhead before the LLM call even starts. This is invisible in local development where Supabase runs on localhost.

2. **Active SSR middleware bug in production.** Issue #14511 — with `compatibility_date >= 2025-09-15`, the `nodejs_compat` polyfill can make SSR routes with middleware return `[object Object]` instead of a valid response. The `src/middleware.ts` route-protection pattern is exactly this code path. The workaround (downgrade `compatibility_date`) conflicts with fetch API behavior needed for OpenRouter calls — there is no clean version of `compatibility_date` that avoids both bugs simultaneously without careful testing.

3. **CPU-time billing, not wall-clock time.** The free tier caps at 10 ms CPU time per request invocation. OpenRouter calls are network I/O (exempt), but Supabase response parsing, session validation, and React SSR consume CPU. Heavy plan-render pages may silently hit the limit. Moving to the $5/month Workers Paid plan (30M CPU-ms/month) is probable and is an unplanned cost.

4. **Workers bundle size limit surfaces at deploy, not development.** The compressed SSR bundle must stay under 10 MB (free) / 15 MB (paid). Astro 6 + React 19 + Supabase client + OpenRouter SDK can approach this ceiling. The error message at deploy time is not obvious, and there is no pre-deploy bundle-size check in the build pipeline.

5. **Preview URLs are publicly accessible by default.** Cloudflare Pages preview deployments (triggered on every branch push) are world-readable with no authentication. For an app that handles user credentials and training plans, preview environments expose the app to anyone with the URL unless Cloudflare Access is explicitly configured — an additional setup step that is easy to skip.

### Pre-Mortem — How This Could Fail

The team deployed 10xTraining on Cloudflare Workers + Pages in May 2026. By October the decision had become a daily tax.

The first crisis arrived two weeks after launch: three users reported seeing each other's plan lists. The SSR middleware bug (#14511) was the culprit — with `compatibility_date` set to a post-September-2025 value, the route-protection middleware was intermittently returning `[object Object]` instead of the expected redirect. The team downgraded `compatibility_date` to fix it, which broke the `fetch()` call to OpenRouter because the newer API wasn't available on the older date. Two days of debugging a non-deterministic production failure that only appeared in the Workers runtime, not locally.

The second crisis was the Supabase round-trip cost. The plan generation page made four sequential Supabase calls before even touching OpenRouter. Each call was 300–350 ms (Frankfurt edge → Supabase us-east-1). Total overhead before the LLM call: 1.2–1.4 seconds. Total plan generation time: 10–14 seconds. Users in the onboarding survey cited "it feels slow" as the top complaint. The team had not measured this during the MVP sprint because `wrangler dev` ran against a local Supabase Docker instance with sub-millisecond round-trips.

The third crisis was the bundle size wall. Adding a Markdown renderer for displaying generated plans pushed the SSR bundle to 11.8 MB — over the free-tier 10 MB limit. Upgrading to Workers Paid ($5/month) was unbudgeted. Logpush to R2 to make production debugging practical added another $3/month. The platform they believed would be free through launch cost $8–22/month with minor features added.

The root assumption that failed: "this is Cloudflare, we know it." The team had experience with static deployments and simple Workers scripts. Astro SSR on Workers in 2026, with an evolving `workerd` runtime and active adapter compatibility bugs, was a meaningfully different operational surface.

### Unknown Unknowns

- **`wrangler dev` environment variable injection differs from production.** Locally, secrets come from `.dev.vars`. In production, they come from `wrangler secret put` or the Pages dashboard. Any CI pipeline step that doesn't have both files populated will silently fail to inject secrets, producing auth errors that look like code bugs.
- **`compatibility_date` is a global runtime version dial, not a feature flag.** Setting it to a recent date accepts all Cloudflare behavior changes bundled into that date — including breaking ones. There is no per-feature opt-in. Debugging requires reading Cloudflare changelog entries that don't map 1-to-1 to Astro GitHub issues.
- **Supabase Realtime is structurally incompatible with Workers.** Any future feature needing live plan updates (WebSocket subscriptions) cannot run inside a Worker — persistent TCP is unsupported. This constraint is invisible at MVP and becomes a wall at the first "live update" feature request.
- **The Cloudflare MCP server's broad scope requires explicit token scoping.** The default OAuth flow in the Claude Code MCP integration grants access beyond Pages: DNS records, Workers on unrelated projects, potentially billing. The token must be explicitly scoped to Pages for this project only. Missing this step means the agent operates with wider platform access than needed.
- **Workers script size is checked at deploy, not at build.** `npm run build` succeeds even when the output would exceed the 10 MB compressed limit. The failure only surfaces during `wrangler deploy` or `wrangler pages deploy`, which can block a time-sensitive deploy.

---

## Operational Story

- **Preview deploys:** Every push to a non-production branch generates a `https://<hash>.10xtraining.pages.dev` preview URL. Preview URLs are publicly accessible by default — configure Cloudflare Access (free via Zero Trust) to gate preview URLs behind an email allowlist before handling real user data in any preview environment.
- **Secrets:** Runtime secrets (`SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`) are stored in the Cloudflare Pages dashboard under Settings → Environment Variables, or set via `wrangler secret put KEY`. They are never in the repository. Local dev reads from `.dev.vars` (see CLAUDE.md). Rotation: update in the dashboard, then re-deploy (`wrangler pages deploy`) — the new value is live immediately on the next request; no restart needed.
- **Rollback:** `wrangler rollback [version-id]` (Workers) or select "Rollback deployment" in the Pages dashboard for Pages Functions. Rollback is instant (promotes a prior immutable deployment artifact). DB migrations applied since the rolled-back version are NOT reverted automatically — coordinate Supabase migrations separately before issuing a rollback.
- **Approval:** The agent may run `wrangler pages deploy` (production deploys), `wrangler tail` (log tailing), `wrangler secret put` (secret updates), and `wrangler versions list` unattended. Human-only actions: deleting a project, rotating the Cloudflare API token, modifying DNS records, billing changes. Any destructive action against a production resource requires a manual click in the Cloudflare dashboard.
- **Logs:** `wrangler tail` streams real-time Worker invocation logs to the terminal. For Pages: `wrangler pages deployment tail`. Filter by status code: `wrangler tail --status error`. Persistent log storage requires Logpush (R2 or third-party sink, ~$0.50/GB/month); without Logpush, logs are only available for the current live session.

---

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| SSR middleware bug #14511: route-protection middleware returns `[object Object]` with `compatibility_date >= 2025-09-15` | Research finding + Devil's advocate | H | H | Pin `compatibility_date` in `wrangler.jsonc` to a pre-2025-09-15 value; validate middleware on a branch preview before production deploy; monitor issue #14511 for upstream patch. |
| Supabase cross-region latency stacks to 1.2–1.4 s before LLM call | Devil's advocate + Pre-mortem | H | M | Pick Supabase project region closest to the primary user base; parallelize independent Supabase calls where possible (Promise.all); measure actual round-trip in production on day one. |
| Workers bundle size limit (10 MB free / 15 MB paid) hit at deploy time | Devil's advocate + Unknown unknowns | M | M | Add `wrangler deploy --dry-run` to CI to catch oversized bundles before the deploy step; monitor bundle size as dependencies grow; plan for $5/month Workers Paid upgrade. |
| `compatibility_date` rollup breaks fetch API or SSR behavior silently | Unknown unknowns | M | H | Pin `compatibility_date` conservatively; read Cloudflare changelog before bumping; test on a preview branch before merging to production. |
| Preview URLs publicly accessible — exposes auth-required app paths | Devil's advocate | M | M | Enable Cloudflare Access (Zero Trust, free tier) to gate preview URLs behind an email allowlist before any real user data flows through preview environments. |
| CPU-time billing on free tier (10 ms/request) hit by plan-render pages | Devil's advocate | L | M | Profile CPU-heavy routes (Supabase parsing, React SSR) early; upgrade to Workers Paid ($5/month) before launch if any route exceeds 10 ms CPU. |
| Wrangler `.dev.vars` / production secrets diverge in CI | Unknown unknowns | M | M | Document both `.env` and `.dev.vars` requirements in onboarding; add a CI pre-flight that validates required env vars are set before build. |
| MCP token over-scoped if OAuth default is used | Unknown unknowns | M | H | Scope the Cloudflare API token to Pages only (single project); never use the master API key for agent workflows. |
| Supabase Realtime incompatible with Workers (future extensibility wall) | Unknown unknowns | L | L | Acceptable for MVP (no Realtime in scope); document the constraint so v2 planning accounts for it. |

---

## Getting Started

The stack is already configured for Cloudflare Pages. These steps cover the first production deploy:

1. **Install and authenticate Wrangler** (already a dev dependency in this project):
   ```bash
   npx wrangler login
   ```
   This opens a browser OAuth flow and stores credentials in `~/.wrangler/config/default.toml`. Use `--api-token` for CI (scoped to Pages, not master key).

2. **Create the Pages project** (first time only):
   ```bash
   npx wrangler pages project create 10xtraining
   ```
   Set production branch to `main` when prompted.

3. **Set production secrets** via the Cloudflare dashboard (Settings → Environment Variables) or CLI:
   ```bash
   npx wrangler pages secret put SUPABASE_URL
   npx wrangler pages secret put SUPABASE_KEY
   npx wrangler pages secret put OPENROUTER_API_KEY
   ```
   Set these for both the `production` and `preview` environments.

4. **Build and deploy to production:**
   ```bash
   npm run build
   npx wrangler pages deploy dist/ --project-name 10xtraining --branch main
   ```

5. **Verify the deploy and tail live logs:**
   ```bash
   npx wrangler pages deployment list --project-name 10xtraining
   npx wrangler pages deployment tail --project-name 10xtraining
   ```

6. **Connect GitHub for automatic deploys** (recommended): In the Cloudflare dashboard → Pages → your project → Settings → Builds & deployments → connect GitHub repo. From this point, merges to `main` trigger production deploys automatically; pushes to feature branches generate preview URLs.

---

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions for lint/build is already configured in `.github/workflows/ci.yml`)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare D1 vs. Supabase migration path at scale
