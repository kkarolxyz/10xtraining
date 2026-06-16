import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

vi.mock("@/lib/supabase", () => ({
  createClient: mockState.createClient,
}));

vi.mock("astro:env/server", () => ({
  get SUPABASE_URL() {
    return "https://test.supabase.co";
  },
  get SUPABASE_KEY() {
    return "test-anon-key";
  },
}));

import { onRequest } from "@/middleware";
import { POST as generatePOST } from "@/pages/api/plans/generate";
import type { APIContext } from "astro";

function makeCtx(pathname: string) {
  return {
    url: new URL(`http://localhost${pathname}`),
    request: new Request(`http://localhost${pathname}`),
    cookies: {},
    locals: {} as App.Locals,
    redirect: vi.fn((path: string) => new Response(null, { status: 302, headers: { Location: path } })),
  };
}

const next = vi.fn(() => new Response(null, { status: 200 }));

beforeEach(() => {
  mockState.getUser.mockReset();
  next.mockClear();
  mockState.createClient.mockReturnValue({
    auth: { getUser: mockState.getUser },
  });
});

describe("R3 — middleware auth boundary", () => {
  it("redirects to /auth/signin when session cookie is missing", async () => {
    mockState.getUser.mockResolvedValue({ data: { user: null } });
    const ctx = makeCtx("/dashboard");
    await onRequest(ctx as unknown as Parameters<typeof onRequest>[0], next);
    expect(ctx.redirect).toHaveBeenCalledWith("/auth/signin");
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects to /auth/signin when getUser returns no user (expired or invalid token)", async () => {
    // Expired JWT: getUser resolves with user: null (JWT validation fails server-side)
    mockState.getUser.mockResolvedValue({ data: { user: null } });
    const ctx = makeCtx("/plans");
    await onRequest(ctx as unknown as Parameters<typeof onRequest>[0], next);
    expect(ctx.redirect).toHaveBeenCalledWith("/auth/signin");
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects to /auth/signin when getUser throws (network failure — proves the Phase 2 fix)", async () => {
    // Before the try/catch fix, this throw would propagate as an unhandled 500.
    // After the fix, the catch sets locals.user = null and the route guard redirects.
    mockState.getUser.mockRejectedValue(new Error("network error"));
    const ctx = makeCtx("/dashboard");
    await onRequest(ctx as unknown as Parameters<typeof onRequest>[0], next);
    expect(ctx.redirect).toHaveBeenCalledWith("/auth/signin");
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and does not redirect when session is valid", async () => {
    mockState.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const ctx = makeCtx("/dashboard");
    await onRequest(ctx as unknown as Parameters<typeof onRequest>[0], next);
    expect(next).toHaveBeenCalled();
    expect(ctx.redirect).not.toHaveBeenCalled();
  });

  it("calls next() and does not redirect for an unprotected route even with no session", async () => {
    // /api/ is NOT in PROTECTED_ROUTES — API routes self-protect via their own 401 checks.
    mockState.getUser.mockResolvedValue({ data: { user: null } });
    const ctx = makeCtx("/api/plans/generate");
    await onRequest(ctx as unknown as Parameters<typeof onRequest>[0], next);
    expect(next).toHaveBeenCalled();
    expect(ctx.redirect).not.toHaveBeenCalled();
  });
});

describe("R3 — API route self-auth guard (generate.ts)", () => {
  it("returns 401 when context.locals.user is null", async () => {
    // Auth guard fires at line 7 of generate.ts before any DB or OpenRouter call —
    // no additional mocks needed.
    const ctx = {
      locals: { user: null },
      request: new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideStats: "r1\nr2\nr3", goal: "speed" }),
      }),
      cookies: {},
      params: {},
    };
    const response = await generatePOST(ctx as unknown as APIContext);
    expect(response.status).toBe(401);
  });
});
