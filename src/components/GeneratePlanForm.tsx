import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  disabled?: boolean;
  initialRideStats?: string;
  initialGoal?: "speed" | "distance" | "";
  updatePlanId?: string;
}

interface GenerateResponse {
  planId?: string;
  error?: string;
}

export function GeneratePlanForm({ disabled = false, initialRideStats = "", initialGoal = "", updatePlanId }: Props) {
  const [rideStats, setRideStats] = useState(initialRideStats);
  const [goal, setGoal] = useState<"speed" | "distance" | "">(initialGoal);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!rideStats.trim()) {
      setError("Paste your ride stats (at least 2 rides)");
      return;
    }
    if (!goal) {
      setError("Select a training goal");
      return;
    }

    setIsLoading(true);
    try {
      const url = updatePlanId ? `/api/plans/${updatePlanId}` : "/api/plans/generate";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideStats, goal }),
      });
      const data = (await res.json()) as GenerateResponse;
      if (res.ok) {
        if (updatePlanId) {
          window.location.reload();
        } else {
          window.location.href = `/plans/${data.planId}`;
        }
      } else {
        setError(data.error ?? "Something went wrong — please try again");
        setIsLoading(false);
      }
    } catch {
      setError("Something went wrong — please try again");
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <label className="mb-2 block text-sm text-blue-100/80">Ride stats (paste from Strava, Garmin, etc.)</label>
        <textarea
          rows={6}
          value={rideStats}
          onChange={(e) => {
            setRideStats(e.target.value);
          }}
          disabled={isLoading || disabled}
          placeholder={
            "Date: 2024-04-01, Distance: 42km, Avg speed: 28.5 km/h\nDate: 2024-04-03, Distance: 25km, Avg speed: 26.1 km/h"
          }
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/30 focus:ring-2 focus:ring-purple-400 focus:outline-none disabled:opacity-50"
        />
      </div>

      <div>
        <p className="mb-3 text-sm text-blue-100/80">Training goal</p>
        <div className="grid grid-cols-2 gap-3">
          {(["speed", "distance"] as const).map((g) => (
            <label
              key={g}
              className={`cursor-pointer rounded-xl border p-4 text-center transition-colors ${
                goal === g
                  ? "border-purple-400 bg-purple-500/20 text-white"
                  : "border-white/20 bg-white/10 text-blue-100/70 hover:bg-white/20"
              } ${isLoading || disabled ? "pointer-events-none opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="goal"
                value={g}
                checked={goal === g}
                onChange={() => {
                  setGoal(g);
                }}
                disabled={isLoading || disabled}
                className="sr-only"
              />
              <p className="font-semibold capitalize">{g}</p>
              <p className="mt-1 text-xs opacity-70">{g === "speed" ? "Faster average speed" : "Longer rides"}</p>
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={isLoading || disabled} className="w-full">
        {isLoading ? (
          <>
            <span className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Generating your plan…
          </>
        ) : (
          "Generate plan"
        )}
      </Button>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  );
}
