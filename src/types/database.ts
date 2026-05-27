export type PlanGoal = "speed" | "distance";

export interface Plan {
  id: string;
  user_id: string;
  name: string;
  goal: PlanGoal;
  ride_stats: string;
  plan: Record<string, unknown>;
  created_at: string;
}

export type NewPlan = Omit<Plan, "id" | "created_at">;
