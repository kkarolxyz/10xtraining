import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { TrainingPlan } from "@/types/database";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";

describe.skipIf(!SUPABASE_SERVICE_ROLE_KEY)("R2 SSR — cross-user plan read blocked by RLS", () => {
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const suffix = Date.now();
  let userAId = "";
  let userBId = "";
  let planAId = "";
  let userBClient!: ReturnType<typeof createClient>;
  const password = "TestPassword123!";

  beforeAll(async () => {
    const stubPlan: TrainingPlan = {
      weeks: [
        {
          week: 1,
          focus: "test",
          days: [{ day: "Monday", session: { type: "rest", description: "test", duration_min: 0 } }],
        },
      ],
    };

    // Create User A and insert a plan for them
    const emailA = `test-r2-a-${suffix}@test.example`;
    const { data: dataA, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    if (errA || !dataA.user) throw new Error(`beforeAll: create User A failed — ${errA?.message}`);
    userAId = dataA.user.id;

    const { data: planData, error: planErr } = await adminClient
      .from("plans")
      .insert({ user_id: userAId, name: "R2 RLS test plan", goal: "speed", ride_stats: "3 rides", plan: stubPlan })
      .select("id")
      .single();
    if (planErr || !planData) throw new Error(`beforeAll: insert plan failed — ${planErr?.message}`);
    planAId = planData.id as string;

    // Create User B and sign in to obtain a real session token
    const emailB = `test-r2-b-${suffix}@test.example`;
    const { data: dataB, error: errB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    if (errB || !dataB.user) throw new Error(`beforeAll: create User B failed — ${errB?.message}`);
    userBId = dataB.user.id;

    const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email: emailB,
      password,
    });
    if (signInErr || !signInData.session) {
      throw new Error(`beforeAll: sign in as User B failed — ${signInErr?.message}`);
    }

    userBClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: `Bearer ${signInData.session.access_token}` } },
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    if (userAId) await adminClient.auth.admin.deleteUser(userAId).catch(() => {});
    if (userBId) await adminClient.auth.admin.deleteUser(userBId).catch(() => {});
  });

  it("User B cannot read User A's plan (RLS blocks cross-user access)", async () => {
    const { data, error } = await userBClient.from("plans").select("id").eq("id", planAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
