import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePlan } from "@/lib/openrouter";
import type { TrainingPlan } from "@/types/database";

const mockState = vi.hoisted(() => ({
  apiKey: "test-api-key",
  create: vi.fn(),
}));

vi.mock("astro:env/server", () => ({
  get OPENROUTER_API_KEY() {
    return mockState.apiKey;
  },
}));

vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: mockState.create } } };
  }),
}));

const BASE_STATS = "ride1\nride2\nride3";

const VALID_PLAN: TrainingPlan = {
  weeks: Array.from({ length: 4 }, (_, i) => ({
    week: i + 1,
    focus: `Week ${i + 1} focus`,
    days: [
      { day: "Monday", session: { type: "rest", description: "Rest day", duration_min: 0 } },
      { day: "Tuesday", session: { type: "interval", description: "6x3 min intervals", duration_min: 60 } },
      { day: "Wednesday", session: { type: "endurance", description: "Aerobic base ride", duration_min: 90 } },
      { day: "Thursday", session: { type: "threshold", description: "Threshold effort", duration_min: 60 } },
      { day: "Friday", session: { type: "recovery", description: "Easy recovery spin", duration_min: 30 } },
      { day: "Saturday", session: { type: "endurance", description: "Long ride", duration_min: 120 } },
      { day: "Sunday", session: { type: "rest", description: "Full rest", duration_min: 0 } },
    ],
  })),
};

beforeEach(() => {
  mockState.apiKey = "test-api-key";
  mockState.create.mockReset();
});

describe("R1 — LLM error handling", () => {
  it("throws when SDK returns non-JSON content", async () => {
    mockState.create.mockResolvedValue({
      choices: [{ message: { content: "not valid json }{" } }],
    });
    await expect(generatePlan(BASE_STATS, "speed")).rejects.toThrow("Failed to parse training plan JSON");
  });

  it("throws when SDK returns JSON without a weeks field", async () => {
    mockState.create.mockResolvedValue({
      choices: [{ message: { content: '{"no_weeks_field": true}' } }],
    });
    await expect(generatePlan(BASE_STATS, "speed")).rejects.toThrow(
      "Invalid training plan: missing or empty 'weeks' array.",
    );
  });

  it("throws when SDK returns empty choices array", async () => {
    mockState.create.mockResolvedValue({ choices: [] });
    await expect(generatePlan(BASE_STATS, "speed")).rejects.toThrow("OpenRouter returned an empty response.");
  });

  it("throws when OPENROUTER_API_KEY is not configured", async () => {
    mockState.apiKey = undefined;
    await expect(generatePlan(BASE_STATS, "speed")).rejects.toThrow("OPENROUTER_API_KEY is not configured");
  });

  it("returns a valid TrainingPlan when SDK returns well-formed JSON", async () => {
    mockState.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(VALID_PLAN) } }],
    });
    const result = await generatePlan(BASE_STATS, "speed");
    expect(result.weeks).toHaveLength(4);
    expect(result.weeks[0].days).toHaveLength(7);
    expect(result.weeks[0].days.some((d) => d.session.type === "rest")).toBe(true);
  });
});
