import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { generatePlan } from "@/lib/openrouter";
import type { PlanGoal } from "@/types/database";

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
  }

  const { id } = context.params;
  const body = (await context.request.json()) as { rideStats: string; goal: string };
  const { rideStats, goal } = body;

  let planData;
  try {
    planData = await generatePlan(rideStats, goal as PlanGoal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong — please try again";
    const safeMsg = msg.startsWith("Failed to parse")
      ? "The AI returned an unexpected response — please try again"
      : msg;
    return new Response(JSON.stringify({ error: safeMsg }), { status: 422 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Database not configured" }), { status: 500 });
  }

  const name = `${goal === "speed" ? "Speed" : "Distance"} plan — ${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}`;

  const { error } = await supabase
    .from("plans")
    .update({ plan: planData, ride_stats: rideStats, goal, name })
    .eq("id", id)
    .eq("user_id", context.locals.user.id);

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to save plan" }), { status: 500 });
  }

  return new Response(JSON.stringify({ planId: id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
  }

  const { id } = context.params;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Database not configured" }), { status: 500 });
  }

  const { error } = await supabase.from("plans").delete().eq("id", id).eq("user_id", context.locals.user.id);

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to delete plan" }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
