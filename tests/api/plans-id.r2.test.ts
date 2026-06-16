import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// Hoist mock state so vi.mock factory functions can close over it.
//
// `chain` is a fluent Supabase query-builder mock: every builder method returns
// the chain itself (via mockReturnThis), making `.from().delete().eq().eq()` work
// at runtime. The chain is also thenable so `await chain` resolves to
// { error: null } without hanging. See plan §"Critical Implementation Details".
const mockState = vi.hoisted(() => {
  const eqSpy = vi.fn().mockReturnThis();

  const chain = {
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    eq: eqSpy,
    // `then` must NOT use mockReturnThis — it must actually resolve so `await chain` terminates.
    then(resolve: (v: { error: null; data: null }) => void, reject: (e: unknown) => void) {
      return Promise.resolve({ error: null, data: null }).then(resolve, reject);
    },
  };

  return {
    eqSpy,
    chain,
    generatePlan: vi.fn(),
    createClient: vi.fn(),
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: mockState.createClient,
}));

vi.mock("@/lib/openrouter", () => ({
  generatePlan: mockState.generatePlan,
}));

import { DELETE, POST } from "@/pages/api/plans/[id]";
import type { TrainingPlan } from "@/types/database";

const STUB_PLAN: TrainingPlan = {
  weeks: [
    {
      week: 1,
      focus: "Base building",
      days: [
        { day: "Monday", session: { type: "rest", description: "Rest day", duration_min: 0 } },
        { day: "Tuesday", session: { type: "interval", description: "6×3 min at threshold", duration_min: 60 } },
        { day: "Wednesday", session: { type: "endurance", description: "Aerobic base", duration_min: 90 } },
        { day: "Thursday", session: { type: "threshold", description: "Tempo effort", duration_min: 60 } },
        { day: "Friday", session: { type: "recovery", description: "Easy spin", duration_min: 30 } },
        { day: "Saturday", session: { type: "endurance", description: "Long ride", duration_min: 120 } },
        { day: "Sunday", session: { type: "rest", description: "Full rest", duration_min: 0 } },
      ],
    },
  ],
};

// Minimal context objects. Irrelevant fields (cookies, etc.) are passed to the
// mocked createClient which ignores them. Cast at call sites to avoid any.
function makeDeleteCtx(userId: string | null, planId: string) {
  return {
    locals: { user: userId ? { id: userId } : null },
    params: { id: planId },
    request: new Request(`http://localhost/api/plans/${planId}`),
    cookies: {},
  };
}

function makePostCtx(userId: string | null, planId: string) {
  return {
    locals: { user: userId ? { id: userId } : null },
    params: { id: planId },
    request: new Request(`http://localhost/api/plans/${planId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideStats: "ride1\nride2\nride3", goal: "speed" }),
    }),
    cookies: {},
  };
}

beforeEach(() => {
  mockState.eqSpy.mockClear();
  mockState.generatePlan.mockReset();
  mockState.createClient.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-a" } } }) },
    from: vi.fn(() => mockState.chain),
  });
});

describe("R2 — DELETE /api/plans/[id]", () => {
  it("returns 401 when user is not authenticated", async () => {
    const response = await DELETE(makeDeleteCtx(null, "plan-b") as unknown as APIContext);
    expect(response.status).toBe(401);
    // Supabase must never be called when the auth guard fires.
    expect(mockState.eqSpy).not.toHaveBeenCalled();
  });

  it("includes .eq('user_id', authenticated user id) in the delete query", async () => {
    const response = await DELETE(makeDeleteCtx("user-a", "plan-b") as unknown as APIContext);
    expect(response.status).toBe(200);
    // Oracle: PRD NFR "data isolation is absolute" — the endpoint must filter on
    // the authenticated user's ID so User A cannot delete User B's plan even
    // with a valid session and a known plan ID. Removing this filter would leave
    // the RLS policy as the sole barrier.
    expect(mockState.eqSpy).toHaveBeenCalledWith("user_id", "user-a");
  });
});

describe("R2 — POST /api/plans/[id] (update)", () => {
  it("returns 401 when user is not authenticated", async () => {
    const response = await POST(makePostCtx(null, "plan-b") as unknown as APIContext);
    expect(response.status).toBe(401);
    expect(mockState.eqSpy).not.toHaveBeenCalled();
  });

  it("includes .eq('user_id', authenticated user id) in the update query", async () => {
    mockState.generatePlan.mockResolvedValue(STUB_PLAN);
    const response = await POST(makePostCtx("user-a", "plan-b") as unknown as APIContext);
    expect(response.status).toBe(200);
    // Oracle: same as DELETE — authenticated user ID must scope the update so
    // cross-user overwrites are blocked at the endpoint layer, independent of
    // the RLS update policy in supabase/migrations/20260529000000_plans_update_policy.sql.
    expect(mockState.eqSpy).toHaveBeenCalledWith("user_id", "user-a");
  });
});
