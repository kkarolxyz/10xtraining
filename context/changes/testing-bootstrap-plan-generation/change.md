---
change_id: testing-bootstrap-plan-generation
title: Bootstrap vitest with Cloudflare Workers pool and integration tests for plan generation
status: implementing
created: 2026-06-15
updated: 2026-06-16
archived_at: null
---

## Notes

Rollout Phase 1 of context/foundation/test-plan.md. Risks covered: R1 (LLM malformed/missing-field response crashes or persists invalid plan), R4 (empty/sparse input accepted → meaningless plan, no error shown). Test types: integration tests against API endpoints with mocked LLM. Risk response intent: R1 — prove that when the LLM returns bad JSON or omits required fields the endpoint returns an error and zero plans are persisted; R4 — prove that posting empty stats or a single-ride entry to the generation endpoint returns a 4xx with user-readable guidance; server-side validation must be verified independently of any client-side guard.
