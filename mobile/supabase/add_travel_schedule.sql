-- Travel mode — persist per-workout equipment adaptation.
--
-- When travel mode is on, Tempo swaps exercises in each UPCOMING scheduled workout
-- for ones the user's current equipment supports (see src/lib/travelSchedule.ts),
-- so the whole app — cards, durations, previews, the runner — shows the adjusted
-- session, not a barbell they can't touch. The pre-travel version is stashed here so
-- it's restored exactly when travel mode ends (or the trip's end date passes).
--   travel_restore = { exercise_ids: uuid[], exercise_config: jsonb | null }

ALTER TABLE public.scheduled_workouts ADD COLUMN IF NOT EXISTS travel_restore jsonb;
