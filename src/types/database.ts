export type PlanGoal = "speed" | "distance";

export interface TrainingSession {
  type: string;
  description: string;
  duration_min: number;
}

export interface TrainingDay {
  day: string;
  session: TrainingSession;
}

export interface TrainingWeek {
  week: number;
  focus: string;
  days: TrainingDay[];
}

export interface TrainingPlan {
  weeks: TrainingWeek[];
}

export interface Plan {
  id: string;
  user_id: string;
  name: string;
  goal: PlanGoal;
  ride_stats: string;
  plan: TrainingPlan;
  created_at: string;
}

export type NewPlan = Omit<Plan, "id" | "created_at">;
