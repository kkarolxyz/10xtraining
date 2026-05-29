import type { APIRoute } from "astro";
import { createAdminClient, createClient } from "@/lib/supabase";

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = context.locals.user.id;

  const adminClient = createAdminClient();
  if (!adminClient) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("deleteUser failed:", error);
    return new Response(JSON.stringify({ error: "Failed to delete account" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(context.request.headers, context.cookies);
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch {
    // signOut failure is non-fatal; middleware will invalidate the stale session
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
