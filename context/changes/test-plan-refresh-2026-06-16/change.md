---
change_id: test-plan-refresh-2026-06-16
title: Test plan refresh 2026 06 16
status: implementing
created: 2026-06-16
updated: 2026-06-17
archived_at: null
---

## Notes

**New Phase 4: Per-edit hooks**
Goal: Wire PostToolUse hook in .claude/settings.json — lint on every edit, vitest
related on risk-area file edits. Update §5 quality gates; add §6.5 cookbook pattern.
Risk covered: R7 — agent edits a risk-area file with no mid-session feedback;
regression surfaces at CI minutes later, not at edit time.
Risk response: After wiring, an edit to src/pages/api/plans/[id].ts or
src/middleware.ts triggers the hook and returns lint/test output in the same agent turn.
Must challenge: "CI is good enough" — per-edit is the only layer that feeds the agent
mid-session (CLAUDE.md Lesson 3).
Context /10x-research must ground: PostToolUse matcher syntax in .claude/settings.json,
whether vitest related works with the dual-pool setup (vitest-pool-workers + Node
integration pool), which files count as risk-area per test-plan.md.
Cheapest layer: Hook config + manual smoke (edit a file, confirm hook output appears
in context).
Anti-pattern: Running the full test suite on every edit — blocks the agent loop; must
scope to related tests only.

**New Phase 5: Delete-account error branches**
Goal: Hermetic tests for admin API throw and partial-failure paths in the delete-account
endpoint. Update §6.3 with error-branch sub-pattern.
Risk covered: R8 — delete-account endpoint went through a review-fix cycle (git 18b9a3e:
error logging + Content-Type headers); integration test covers only the happy path.
Risk response: When adminClient.auth.admin.deleteUser() throws, the endpoint returns a
structured JSON error — not 200, not HTML content-type.
Must challenge: "Happy-path integration test proves the endpoint works" — it does not
test error branches.
Context /10x-research must ground: delete-account endpoint error flow
(src/pages/api/auth/delete-account.ts), whether it catches admin API throws vs. error
objects, what HTTP status + Content-Type it returns on each failure mode.
Cheapest layer: Hermetic test — stub admin client to throw; no real Supabase needed.
Anti-pattern: Oracle problem — expected error body mirrors current implementation output
rather than HTTP spec + PRD intent.
