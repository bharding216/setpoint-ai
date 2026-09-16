-- Grant table access to the authenticated API role.
-- Required because "Automatically expose new tables" is disabled.

GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.training_preferences TO authenticated;
GRANT ALL ON public.weekly_schedule TO authenticated;
GRANT ALL ON public.workouts TO authenticated;
GRANT ALL ON public.workout_exercises TO authenticated;
GRANT ALL ON public.exercise_sets TO authenticated;
GRANT ALL ON public.cardio_entries TO authenticated;
