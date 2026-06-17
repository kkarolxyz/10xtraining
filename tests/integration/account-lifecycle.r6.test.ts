import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { TrainingPlan } from "@/types/database";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";

describe.skipIf(!SUPABASE_SERVICE_ROLE_KEY)("R6 — account deletion cascade", () => {
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  let testUserId = "";
  let testEmail = "";
  const testPassword = "TestPassword123!";

  beforeAll(async () => {
    testEmail = `test-r6-${Date.now()}@test.example`;

    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });

    if (createError) {
      throw new Error(`beforeAll: failed to create test user — ${createError.message}`);
    }

    testUserId = createData.user.id;

    const stubPlan: TrainingPlan = {
      weeks: [
        {
          week: 1,
          focus: "test",
          days: [{ day: "Monday", session: { type: "rest", description: "test", duration_min: 0 } }],
        },
      ],
    };

    const { error: planError } = await adminClient.from("plans").insert({
      user_id: testUserId,
      name: "R6 cascade test plan",
      goal: "speed",
      ride_stats: "3 rides per week",
      plan: stubPlan,
    });

    if (planError) {
      throw new Error(`beforeAll: failed to insert test plan — ${planError.message}`);
    }
  });

  afterAll(async () => {
    if (testUserId) {
      await adminClient.auth.admin.deleteUser(testUserId).catch((_e: unknown) => undefined);
    }
  });

  it("deletes all plan rows when auth.users row is deleted", async () => {
    const { error } = await adminClient.auth.admin.deleteUser(testUserId);
    expect(error).toBeNull();

    const { data, error: queryError } = await adminClient.from("plans").select("id").eq("user_id", testUserId);

    expect(queryError).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("rejects sign-in after account deletion", async () => {
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });
});
