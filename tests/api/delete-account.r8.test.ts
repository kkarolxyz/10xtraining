import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// Hoist spy state so vi.mock factory can close over it without hoisting issues.
const mockState = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  signOut: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: mockState.createAdminClient,
  createClient: mockState.createClient,
}));

import { DELETE } from "@/pages/api/auth/delete-account";

function makeCtx(userId: string | null) {
  return {
    locals: { user: userId ? { id: userId } : null },
    request: new Request("http://localhost/api/auth/delete-account", { method: "DELETE" }),
    cookies: {},
  };
}

beforeEach(() => {
  mockState.deleteUser.mockReset();
  mockState.signOut.mockReset();
  mockState.createAdminClient.mockReset();
  mockState.createClient.mockReset();

  // Happy-path defaults — each test overrides only what it needs.
  mockState.deleteUser.mockResolvedValue({ error: null });
  mockState.signOut.mockResolvedValue({ error: null });
  mockState.createAdminClient.mockReturnValue({
    auth: { admin: { deleteUser: mockState.deleteUser } },
  });
  mockState.createClient.mockReturnValue({
    auth: { signOut: mockState.signOut },
  });
});

describe("R8 — DELETE /api/auth/delete-account", () => {
  it("P1: returns 401 when user is not authenticated", async () => {
    const response = await DELETE(makeCtx(null) as unknown as APIContext);
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("P2: returns 500 when admin client is unavailable", async () => {
    mockState.createAdminClient.mockReturnValue(null);
    const response = await DELETE(makeCtx("user-a") as unknown as APIContext);
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("P3: returns 500 when deleteUser returns an error object", async () => {
    mockState.deleteUser.mockResolvedValue({ error: new Error("db error") });
    const response = await DELETE(makeCtx("user-a") as unknown as APIContext);
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("P4: returns 500 when deleteUser throws", async () => {
    mockState.deleteUser.mockRejectedValue(new Error("network failure"));
    const response = await DELETE(makeCtx("user-a") as unknown as APIContext);
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("P5: returns 200 when signOut throws (non-fatal)", async () => {
    mockState.signOut.mockRejectedValue(new Error("signout failed"));
    const response = await DELETE(makeCtx("user-a") as unknown as APIContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("P6: returns 200 with success on happy path", async () => {
    const response = await DELETE(makeCtx("user-a") as unknown as APIContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});
