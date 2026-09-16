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
  duration_minutes?: number;
  distance?: number;
  pace?: string;
  notes?: string;
};

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
