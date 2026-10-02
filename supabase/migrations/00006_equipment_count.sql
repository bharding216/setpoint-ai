-- Add equipment_count to workout_exercises for exercises that use
-- multiple pieces of equipment (e.g., a pair of dumbbells).
--
-- NULL / 1 = single implement (barbell, machine, one dumbbell, bodyweight)
-- 2        = bilateral dumbbell pair — weight column stores per-hand value
--
-- The display layer uses this to render "25 lbs ×2" so the user knows
-- which dumbbell to grab off the rack.

ALTER TABLE public.workout_exercises
  ADD COLUMN equipment_count SMALLINT;
