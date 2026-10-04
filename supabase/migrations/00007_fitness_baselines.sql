-- Fitness Baselines — user self-reported athletic starting point
-- Used by AI to calibrate initial workout recommendations.
-- Over time, logged workout data supplements/overrides these baselines.

CREATE TABLE public.fitness_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experience_level TEXT CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
  benchmarks JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX idx_fitness_baselines_user ON public.fitness_baselines(user_id);

ALTER TABLE public.fitness_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own baseline"
  ON public.fitness_baselines FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own baseline"
  ON public.fitness_baselines FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own baseline"
  ON public.fitness_baselines FOR UPDATE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.fitness_baselines TO authenticated;

CREATE TRIGGER update_fitness_baselines_updated_at
  BEFORE UPDATE ON public.fitness_baselines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
