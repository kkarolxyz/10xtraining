import OpenAI from "openai";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { PlanGoal, TrainingPlan } from "@/types/database";

const MODEL = "google/gemini-2.5-flash";

function buildSystemPrompt(rideStats: string, goal: PlanGoal): string {
  return `You are a cycling training coach. Your task is to generate a personalised 4-week training plan.

Cyclist's ride data from the past month:
${rideStats}

Training goal: ${goal === "speed" ? "Speed improvement (faster average speed)" : "Distance improvement (longer rides)"}

Rules:
- Return ONLY valid JSON. No markdown code fences, no explanation, no extra text.
- Exactly 4 weeks. Each week has exactly 7 days: Monday through Sunday.
- At least 1 full rest day (duration_min: 0, type: "rest") per week.
- Progressive load increase across the 4 weeks.
- Speed goal: emphasise interval and threshold sessions.
- Distance goal: emphasise long endurance rides and graduated weekly volume.
- Session types: "rest" | "interval" | "endurance" | "threshold" | "recovery" | "strength".

Required JSON structure:
{
  "weeks": [
    {
      "week": 1,
      "focus": "Base building",
      "days": [
        { "day": "Monday", "session": { "type": "rest", "description": "Full rest day", "duration_min": 0 } },
        { "day": "Tuesday", "session": { "type": "interval", "description": "6x3 min @ 105% FTP with 3 min recovery", "duration_min": 60 } }
      ]
    }
  ]
}`;
}

export async function generatePlan(rideStats: string, goal: PlanGoal): Promise<TrainingPlan> {
  const nonEmptyLines = rideStats.split("\n").filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length < 2) {
    throw new Error("Insufficient ride data: provide at least 2 rides to generate a training plan.");
  }

  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured. Add it to your environment variables.");
  }

  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_API_KEY,
  });

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: buildSystemPrompt(rideStats, goal) }],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("OpenRouter returned an empty response.");
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse training plan JSON: ${cleaned.slice(0, 200)}`);
  }

  const plan = parsed as TrainingPlan;
  if (!Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    throw new Error("Invalid training plan: missing or empty 'weeks' array.");
  }

  return plan;
}
