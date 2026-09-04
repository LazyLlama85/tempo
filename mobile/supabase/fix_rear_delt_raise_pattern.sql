-- Rear lateral raises were seeded as movement_pattern 'push' with primary muscle
-- 'shoulders'. The programming classifier reads the NAME and correctly slots them
-- as rear_delt, so generated plans were never affected — but Quick Workouts group
-- by the raw movement_pattern, so a Quick "Push" session could surface a rear-delt
-- raise. Applied 2026-09-03 alongside the push/pull side guard in generatePlan.
UPDATE public.exercises
SET movement_pattern = 'pull', primary_muscles = ARRAY['rear_delts']
WHERE user_id IS NULL
  AND name IN ('Dumbbell Rear Lateral Raise', 'Dumbbell Rear Lateral Raise (support Head)')
  AND movement_pattern = 'push';
