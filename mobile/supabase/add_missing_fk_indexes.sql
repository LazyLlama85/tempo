-- Tempo — index the remaining unindexed foreign keys (Supabase advisor: 11
-- `unindexed_foreign_keys` findings, distinct from add_hot_path_indexes.sql's
-- two hot-path indexes). A missing index on a foreign-key column means every
-- lookup by that column is a full table scan, and it only gets slower as the
-- table grows — some of these sit on tables Home's app-open sweep reads on
-- every cold start (user_plans.user_id in particular: the block-phase query
-- filters on it directly, `(tabs)/index.tsx`'s `block_phase` useQuery).
--
-- Standard `CREATE INDEX IF NOT EXISTS` (not CONCURRENTLY) — these tables are
-- pre-launch scale, so a brief write lock during index build is a non-issue,
-- and CONCURRENTLY can't run inside the transaction a migration applies in.

create index if not exists adaptation_events_user_id_idx
  on public.adaptation_events (user_id);

create index if not exists exercise_substitutions_original_exercise_id_idx
  on public.exercise_substitutions (original_exercise_id);

create index if not exists exercise_substitutions_substitute_exercise_id_idx
  on public.exercise_substitutions (substitute_exercise_id);

create index if not exists friendships_requester_id_idx
  on public.friendships (requester_id);

create index if not exists groups_owner_id_idx
  on public.groups (owner_id);

create index if not exists scheduled_workouts_partner_id_idx
  on public.scheduled_workouts (partner_id);

create index if not exists scheduled_workouts_user_plan_id_idx
  on public.scheduled_workouts (user_plan_id);

create index if not exists set_logs_exercise_id_idx
  on public.set_logs (exercise_id);

create index if not exists user_plans_program_id_idx
  on public.user_plans (program_id);

-- The standout: user_plans has NO index on user_id at all, despite being
-- filtered by user_id on nearly every Home load (block_phase query) and by
-- generatePlan.ts/adaptation.ts's own reads/writes.
create index if not exists user_plans_user_id_idx
  on public.user_plans (user_id);

create index if not exists workout_logs_scheduled_workout_id_idx
  on public.workout_logs (scheduled_workout_id);
