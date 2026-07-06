-- Exercise Library v2 — supporting columns for the expanded (1300+) library.
-- Run BEFORE seed_exercise_library_v2.sql.
--
--   is_core      — the plan/quick-workout engines only program from this pool, so a
--                  10× bigger search library can't degrade generated plans.
--   popularity   — 0–100 ranking signal for search ordering (staples first).
--   muscle_group — coarse filter bucket: chest/back/shoulders/arms/core/legs/
--                  glutes/cardio/mobility. Null for user customs (derived client-side).

ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS is_core boolean NOT NULL DEFAULT false;
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS popularity smallint NOT NULL DEFAULT 30;
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS muscle_group text;

-- The original hand-curated seed (50 strength + 10 mobility) is the foundation the
-- plan generator was tuned on: all of it stays core, ranked above the imported rows.
UPDATE public.exercises SET is_core = true, popularity = 90 WHERE user_id IS NULL AND popularity = 30;

UPDATE public.exercises SET muscle_group = CASE
  WHEN movement_pattern = 'cardio' THEN 'cardio'
  WHEN movement_pattern = 'mobility' THEN 'mobility'
  WHEN primary_muscles[1] IN ('chest', 'upper_chest') THEN 'chest'
  WHEN primary_muscles[1] IN ('lats', 'rhomboids', 'back', 'upper_back', 'traps', 'teres_major') THEN 'back'
  WHEN primary_muscles[1] IN ('shoulders', 'lateral_deltoids', 'rear_delts', 'rotator_cuff') THEN 'shoulders'
  WHEN primary_muscles[1] IN ('biceps', 'triceps', 'forearms', 'brachialis') THEN 'arms'
  WHEN primary_muscles[1] IN ('abs', 'obliques', 'transverse_abdominis', 'core', 'hip_flexors') THEN 'core'
  WHEN primary_muscles[1] IN ('glutes') THEN 'glutes'
  WHEN primary_muscles[1] IN ('quads', 'hamstrings', 'calves', 'legs', 'inner_thighs', 'adductors', 'abductors') THEN 'legs'
  WHEN primary_muscles[1] IN ('erectors', 'lower_back') THEN 'back'
  ELSE 'core'
END
WHERE user_id IS NULL AND muscle_group IS NULL;

-- Search hits name + muscles; keep the common lookups indexed as the table grows.
CREATE INDEX IF NOT EXISTS exercises_muscle_group_idx ON public.exercises (muscle_group) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS exercises_is_core_idx ON public.exercises (is_core) WHERE user_id IS NULL;
