-- Tempo — actual session duration.
--
-- A completed workout now records how long it actually took (set on completion in
-- the workout runner) so the schedule shows real time, not the planned estimate —
-- e.g. "15 min" for a session that took 15, instead of the planned 45.
-- planned_duration_min stays as the up-front estimate.
alter table public.scheduled_workouts
  add column if not exists actual_duration_min int;
