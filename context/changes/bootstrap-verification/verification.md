---
bootstrapped_at: 2026-05-24T22:30:01Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10xtraining
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xtraining
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

**Why this stack**

10xTraining is a solo, after-hours web app targeting roughly 100 users with a 3-week MVP window and auth plus AI-driven plan generation as the two technology-forcing features. The recommended default for `(web-app, js)` is `10x-astro-starter` — Astro 6 + Supabase + Cloudflare Pages — which clears all four agent-friendly gates and covers both forcing features out of the box: Supabase handles auth (FR-001–003) and the database for saved training plans, while Cloudflare Pages delivers global edge deployment at zero ops cost. Plan generation (FR-006) will call an external LLM API — a network call rather than CPU work — which fits the Cloudflare Workers request model cleanly; the 30-second user-visible response NFR is achievable with streaming. TypeScript-first throughout keeps the codebase agent-readable. Scaffolding confidence is first-class: the CLI is registered and the scaffold is expected to run smoothly, with occasional manual steps possible.

## Pre-scaffold verification

| Signal      | Value                                                   | Severity | Notes                                      |
| ----------- | ------------------------------------------------------- | -------- | ------------------------------------------ |
| npm package | not run                                                 | n/a      | cmd_template uses git clone; no npm package to check |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | 7 days ago; well within 3-month threshold  |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: cloned starter repo without keeping its git history (git-clone)
**Exit code**: 0
**Files moved**: 20 (`.github`, `.husky`, `.vscode`, `node_modules`, `public`, `src`, `supabase`, `.env.example`, `.gitignore`, `.nvmrc`, `.prettierrc.json`, `astro.config.mjs`, `CLAUDE.md.scaffold`, `components.json`, `eslint.config.js`, `package-lock.json`, `package.json`, `README.md`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md` → `CLAUDE.md.scaffold` (cwd CLAUDE.md preserved)
**.gitignore handling**: moved silently (no existing .gitignore in cwd)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0d/0d direct CRITICAL/HIGH of total 0/1; 2 direct MODERATE (`@astrojs/check`, `wrangler`) of 9 total MODERATE

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** `v5.6.3–5.8.0` — Advisory GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization" (CWE-770, CVSS 7.5 / AV:N/AC:L/PR:N/UI:N). Transitive dependency. Fix available (`npm audit fix`). Impact: denial-of-service via crafted sparse arrays during deserialization; relevant only if untrusted data is deserialized through this path.

#### MODERATE findings

1. **ws** `v8.0.0–8.20.0` — Advisory GHSA-58qx-3vcg-4xpx — "ws: Uninitialized memory disclosure" (CWE-908, CVSS 4.4). Transitive. Fix available. Affects `miniflare` and `@supabase/realtime-js` subtree (dev/edge tooling only).
2. **yaml** `v2.0.0–2.8.2` — Advisory GHSA-48c2-rrv3-qjmp — "yaml: Stack Overflow via deeply nested YAML collections" (CWE-674, CVSS 4.3). Transitive via `yaml-language-server` → `volar-service-yaml` → `@astrojs/language-server` → `@astrojs/check` (dev tooling only). Fix requires `@astrojs/check` downgrade to `0.9.2` (semver major).
3. **@astrojs/check** `>=0.9.3` — MODERATE (direct). Affected via `@astrojs/language-server`. Fix: downgrade to `0.9.2` (semver major break).
4. **@astrojs/language-server** — MODERATE (transitive). Via `volar-service-yaml`.
5. **volar-service-yaml** `<=0.0.70` — MODERATE (transitive). Via `yaml-language-server`.
6. **yaml-language-server** — MODERATE (transitive). Via `yaml`.
7. **wrangler** `3.108.0–4.93.0` — MODERATE (direct). Via `miniflare`.
8. **miniflare** — MODERATE (transitive). Via `ws`.
9. **@cloudflare/vite-plugin** — MODERATE (transitive). Via `miniflare`, `wrangler`, `ws`.

**Context**: all 10 findings are in dev tooling (`wrangler`, `@astrojs/check`, `miniflare`) or transitive runtime dependencies of Cloudflare's edge platform packages. None are in application-level code you write. Run `npm audit fix` to resolve the 7 auto-fixable findings; the remaining 3 (`@astrojs/check` chain) require a semver-major downgrade decision.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | true                |
| has_background_jobs     | false               |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` — the starter ships its own CLAUDE.md; diff it against yours to see if any Astro/Supabase/Cloudflare guidance is worth merging in.
- `npm audit fix` to address the 7 auto-fixable MODERATE findings.
- Address the `devalue` HIGH finding per your project's risk tolerance — it's a transitive dev-tooling dependency; `npm audit fix` should resolve it.
- Configure Supabase: create a project at supabase.com, copy your `SUPABASE_URL` and `SUPABASE_ANON_KEY` into `.env` (see `.env.example`).
