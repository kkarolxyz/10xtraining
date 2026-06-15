import { describe, it, expect, vi } from "vitest";
import { generatePlan } from "@/lib/openrouter";

vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: undefined,
}));

describe("R4 — sparse input rejection", () => {
  it("throws with user message on empty rideStats", async () => {
    await expect(generatePlan("", "speed")).rejects.toThrow("Insufficient ride data");
  });

  it("throws when rideStats contains only whitespace lines", async () => {
    await expect(generatePlan("   \n  \n   ", "speed")).rejects.toThrow("Insufficient ride data");
  });

  it("throws when rideStats has only one non-empty line", async () => {
    await expect(generatePlan("one ride\n   ", "speed")).rejects.toThrow("Insufficient ride data");
  });

  it("boundary: two non-empty lines pass the R4 guard and fail on missing API key", async () => {
    await expect(generatePlan("ride1\nride2", "speed")).rejects.toThrow("OPENROUTER_API_KEY");
  });
});
