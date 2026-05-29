import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

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
