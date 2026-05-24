---
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
---

## Why this stack

10xTraining is a solo, after-hours web app targeting roughly 100 users with a 3-week MVP window and auth plus AI-driven plan generation as the two technology-forcing features. The recommended default for `(web-app, js)` is `10x-astro-starter` — Astro 6 + Supabase + Cloudflare Pages — which clears all four agent-friendly gates and covers both forcing features out of the box: Supabase handles auth (FR-001–003) and the database for saved training plans, while Cloudflare Pages delivers global edge deployment at zero ops cost. Plan generation (FR-006) will call an external LLM API — a network call rather than CPU work — which fits the Cloudflare Workers request model cleanly; the 30-second user-visible response NFR is achievable with streaming. TypeScript-first throughout keeps the codebase agent-readable. Scaffolding confidence is first-class: the CLI is registered and the scaffold is expected to run smoothly, with occasional manual steps possible.
