export type Profile = {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type TrainingPreference = {
  id: string;
  user_id: string;
  content: string;
  category: 'goal' | 'preference' | 'equipment' | 'general';
  created_at: string;
  updated_at: string;
};

export type WeeklyScheduleEntry = {
  id: string;
  user_id: string;
  day_of_week: number;
  session_type: string;
  created_at: string;
  updated_at: string;
};

export type Workout = {
  id: string;
  user_id: string;
  date: string;
  type: string | null;
  status: 'planned' | 'in_progress' | 'completed';
  notes: string | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkoutExercise = {
  id: string;
  workout_id: string;
  name: string;
  exercise_type: 'strength' | 'cardio';
  exercise_order: number;
  is_planned: boolean;
  notes: string | null;
  equipment_count: number | null;
  created_at: string;
};

export type ExerciseSet = {
  id: string;
  exercise_id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rest_seconds: number | null;
  created_at: string;
};

export type CardioEntry = {
  id: string;
  exercise_id: string;
  duration_minutes: number | null;
  distance: number | null;
  distance_unit: 'miles' | 'km' | 'meters';
  pace: string | null;
  heart_rate: number | null;
  intervals: unknown | null;
  notes: string | null;
  created_at: string;
};

export type ExerciseWithSets = WorkoutExercise & {
  sets: ExerciseSet[];
  cardio?: CardioEntry;
};

export type AIRecommendation = {
  summary: string;
  workout: {
    type: string;
    exercises: AIExercise[];
  };
};

export type AIExercise = {
  name: string;
  exercise_type: 'strength' | 'cardio';
  sets?: number;
  reps?: number;
  weight?: number;
  equipment_count?: number;
  duration_minutes?: number;
  distance?: number;
  pace?: string;
  notes?: string;
};

// ─── Subscriptions ──────────────────────────────────────────

export type SubscriptionTier = 'free' | 'plus';
export type SubscriptionStatus = 'trialing' | 'active' | 'canceled' | 'expired' | 'past_due';
export type SubscriptionProvider = 'apple' | 'stripe' | 'manual';

export type Subscription = {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  provider: SubscriptionProvider | null;
  provider_subscription_id: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

// ─── AI Usage Tracking ──────────────────────────────────────

export type AIUsageLog = {
  id: string;
  user_id: string;
  function_name: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_cents: number | null;
  created_at: string;
};

// ─── Compact AI Profile ─────────────────────────────────────

export type RecentBenchmark = {
  best_recent: string;
  trend: 'progressing' | 'maintaining' | 'regressing';
};

export type AIProfileData = {
  goals: string[];
  training_split: string;
  equipment: string[];
  preferences: string[];
  recent_benchmarks: Record<string, RecentBenchmark>;
  training_consistency: string;
  fatigue_notes: string;
};

export type UserAIProfile = {
  id: string;
  user_id: string;
  profile_data: AIProfileData;
  last_rebuilt_at: string;
  created_at: string;
  updated_at: string;
};

// ─── Constants ──────────────────────────────────────────────

export const FREE_TIER_AI_SESSIONS = 10;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
