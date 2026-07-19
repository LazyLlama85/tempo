-- Tempo — indexes on two hot query paths (MASTER_FIX_PLAN.md F10 part 1).
--
-- schema.sql defines zero indexes anywhere; the one index that exists on
-- scheduled_workouts arrived as a side effect of an unrelated social-feature
-- migration, not a deliberate choice. Two real gaps:
--   • workout_logs(user_id, completed_at) — scanned by retention-push's
--     per-user bulk queries (retention-push/index.ts) and by history/PREV
--     lookups (generatePlan.ts, session history), currently a full scan that
--     grows with the table.
--   • set_logs(workout_log_id) — scanned by the RLS EXISTS check on every
--     set_logs read/write, and by every per-workout set fetch.

create index if not exists workout_logs_user_completed_idx
  on public.workout_logs (user_id, completed_at);

create index if not exists set_logs_workout_log_id_idx
  on public.set_logs (workout_log_id);
