-- Tempo — lazy, real-usage backfill for exercises.instructions.
--
-- 1285 of the 1297 ExerciseDB-imported exercises have no local instructions
-- (RLS-safe SELECT-only for built-in rows, so the app can't UPDATE them
-- directly). Today ExerciseFormSheet falls back to a LIVE ExerciseDB fetch
-- (lib/exerciseDb.ts's fetchRemoteInstructions) cached only in an in-memory
-- Map — lost on every app restart, so the same exercise gets re-fetched from
-- RapidAPI over and over across users and sessions, against the same limited
-- monthly quota the founder's batch backfill script already competes for.
--
-- This RPC lets the app persist a successful live fetch straight into the
-- built-in row, once, so every future viewer (including the same user
-- reopening the app) reads it from the database instead of hitting RapidAPI
-- again. Narrowly scoped: only touches instructions, only on a built-in
-- row (user_id IS NULL), and only when that row's instructions are still
-- empty (never overwrites curated content) — a real user can't use this to
-- vandalize the shared exercise library.

create or replace function save_exercise_instructions(p_exercise_id uuid, p_instructions text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update exercises
  set instructions = p_instructions
  where id = p_exercise_id
    and user_id is null
    and (instructions is null or array_length(instructions, 1) is null);
end;
$$;

revoke all on function save_exercise_instructions(uuid, text[]) from public;
grant execute on function save_exercise_instructions(uuid, text[]) to authenticated;

-- One-off data fix found alongside this: the only hand-written (non-imported)
-- exercise with no instructions also had an empty primary_muscles array,
-- which would silently exclude it from muscle-volume/recovery logic.
update exercises
set
  instructions = array[
    'Set the pendulum squat machine''s pad against your shoulders and stand with feet shoulder-width apart on the platform.',
    'Brace your core and unrack the weight by straightening your legs slightly.',
    'Lower under control, letting the machine''s arc guide your knees forward over your toes, until your thighs are at least parallel to the platform.',
    'Drive through your whole foot to press back up to the starting position, without locking your knees out hard at the top.'
  ],
  primary_muscles = array['quadriceps'],
  secondary_muscles = case
    when secondary_muscles is null or array_length(secondary_muscles, 1) is null
      then array['glutes']
    else secondary_muscles
  end
where id = '68d7cd4a-875e-44b0-9211-9e879fa05a19'
  and (instructions is null or array_length(instructions, 1) is null);
