-- Setpoint AI — Initial Schema
-- Run this in the Supabase SQL Editor to set up the database.

-- ============================================================
-- Tables
-- ============================================================

-- User profiles (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Free-form training preferences, goals, and equipment
CREATE TABLE public.training_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('goal', 'preference', 'equipment', 'general')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Weekly schedule — one row per day per user
CREATE TABLE public.weekly_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  session_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, day_of_week)
);

-- Workouts
CREATE TABLE public.workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  type TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed')),
  notes TEXT,
  ai_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exercises within a workout (both planned and actual)
CREATE TABLE public.workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  exercise_type TEXT NOT NULL DEFAULT 'strength'
    CHECK (exercise_type IN ('strength', 'cardio')),
  exercise_order SMALLINT NOT NULL DEFAULT 0,
  is_planned BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual sets for strength exercises
CREATE TABLE public.exercise_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  set_number SMALLINT NOT NULL,
  weight NUMERIC(7,2),
  reps SMALLINT,
  rpe NUMERIC(3,1),
  rest_seconds SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cardio details
CREATE TABLE public.cardio_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  duration_minutes NUMERIC(6,1),
  distance NUMERIC(6,2),
  distance_unit TEXT DEFAULT 'miles' CHECK (distance_unit IN ('miles', 'km', 'meters')),
  pace TEXT,
  heart_rate SMALLINT,
  intervals JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_training_preferences_user ON public.training_preferences(user_id);
CREATE INDEX idx_weekly_schedule_user ON public.weekly_schedule(user_id);
CREATE INDEX idx_workouts_user_date ON public.workouts(user_id, date DESC);
CREATE INDEX idx_workout_exercises_workout ON public.workout_exercises(workout_id);
CREATE INDEX idx_exercise_sets_exercise ON public.exercise_sets(exercise_id);
CREATE INDEX idx_cardio_entries_exercise ON public.cardio_entries(exercise_id);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cardio_entries ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- training_preferences
CREATE POLICY "Users can view own preferences"
  ON public.training_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own preferences"
  ON public.training_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own preferences"
  ON public.training_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own preferences"
  ON public.training_preferences FOR DELETE USING (auth.uid() = user_id);

-- weekly_schedule
CREATE POLICY "Users can view own schedule"
  ON public.weekly_schedule FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own schedule"
  ON public.weekly_schedule FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own schedule"
  ON public.weekly_schedule FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own schedule"
  ON public.weekly_schedule FOR DELETE USING (auth.uid() = user_id);

-- workouts
CREATE POLICY "Users can view own workouts"
  ON public.workouts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own workouts"
  ON public.workouts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workouts"
  ON public.workouts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own workouts"
  ON public.workouts FOR DELETE USING (auth.uid() = user_id);

-- workout_exercises (join through workouts for user_id check)
CREATE POLICY "Users can view own exercises"
  ON public.workout_exercises FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workouts
            WHERE workouts.id = workout_exercises.workout_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can insert own exercises"
  ON public.workout_exercises FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.workouts
            WHERE workouts.id = workout_exercises.workout_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can update own exercises"
  ON public.workout_exercises FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.workouts
            WHERE workouts.id = workout_exercises.workout_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can delete own exercises"
  ON public.workout_exercises FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.workouts
            WHERE workouts.id = workout_exercises.workout_id
              AND workouts.user_id = auth.uid())
  );

-- exercise_sets (join through workout_exercises → workouts)
CREATE POLICY "Users can view own sets"
  ON public.exercise_sets FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = exercise_sets.exercise_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can insert own sets"
  ON public.exercise_sets FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = exercise_sets.exercise_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can update own sets"
  ON public.exercise_sets FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = exercise_sets.exercise_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can delete own sets"
  ON public.exercise_sets FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = exercise_sets.exercise_id
              AND workouts.user_id = auth.uid())
  );

-- cardio_entries (same join pattern)
CREATE POLICY "Users can view own cardio"
  ON public.cardio_entries FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = cardio_entries.exercise_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can insert own cardio"
  ON public.cardio_entries FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = cardio_entries.exercise_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can update own cardio"
  ON public.cardio_entries FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = cardio_entries.exercise_id
              AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can delete own cardio"
  ON public.cardio_entries FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.workout_exercises
            JOIN public.workouts ON workouts.id = workout_exercises.workout_id
            WHERE workout_exercises.id = cardio_entries.exercise_id
              AND workouts.user_id = auth.uid())
  );

-- ============================================================
-- Triggers
-- ============================================================

-- Auto-create profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_training_preferences_updated_at
  BEFORE UPDATE ON public.training_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_weekly_schedule_updated_at
  BEFORE UPDATE ON public.weekly_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_workouts_updated_at
  BEFORE UPDATE ON public.workouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
