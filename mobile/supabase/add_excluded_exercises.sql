-- Tempo — permanent per-user exercise exclusion.
--
-- "Skip for today" (already existed) only ever removes an exercise from
-- today's session; the plan/split keep suggesting it next time. There was no
-- way to say "never program this movement for me again" from inside a live
-- session. excluded_exercise_ids is that list — checked by every exercise-
-- selection path that produces scheduled_workouts.exercise_ids (generatePlan,
-- splitSchedule's materialization, quickWorkout), so it's enforced uniformly
-- regardless of which system generated the session, without needing to hunt
-- down and rewrite the user's saved split JSON.

alter table public.user_profiles
  add column if not exists excluded_exercise_ids uuid[] not null default '{}';
