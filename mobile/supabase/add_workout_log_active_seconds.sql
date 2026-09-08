-- Applied 2026-09-07.
-- Seconds of ACTIVE training in a session, excluding time the user was paused.
--
-- The session timer is wall-clock based (so locking the phone between sets does
-- not stop the clock), and resuming an open log recomputed elapsed as
-- (now - started_at). That counted every paused minute as training: pause a
-- workout, come back two hours later, and the timer read two hours — which also
-- inflated `actual_duration_min` on completion, making it a data problem rather
-- than only a display one.
--
-- Nullable on purpose: logs predating this have no value, and the client falls
-- back to the old wall-clock derivation for those (see
-- lib/durationEstimate.resumeElapsedSeconds) rather than inventing one.
alter table public.workout_logs
  add column if not exists active_seconds integer;

comment on column public.workout_logs.active_seconds is
  'Seconds actually spent training, excluding paused time. Null for logs predating 2026-09-07.';
