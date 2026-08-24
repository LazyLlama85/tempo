-- Applied 2026-08-24 (Supabase migration `harden_definer_functions`).
--
-- 1. `save_exercise_instructions` was executable by the `anon` role. It is
--    SECURITY DEFINER and writes `exercises.instructions` on GLOBAL rows
--    (user_id is null) whose instructions are still empty, so any
--    unauthenticated caller could permanently set the instruction text shown to
--    every user for any exercise not yet backfilled -- arbitrary text presented
--    as how to perform a lift. Write-once, so the blast radius was bounded and
--    the damage would have been permanent.
--
--    Safe to revoke: the only caller (lib/exerciseDb.ts) runs inside the app.
--    Supabase guest sign-ins are anonymous USERS but still carry the
--    `authenticated` role, so guests keep working.
--
-- 2. `gen_friend_code` / `gen_username` had a mutable search_path and are called
--    by `set_profile_identity()`, a SECURITY DEFINER trigger -- the standard
--    shape for privilege escalation via function shadowing.
--
-- Deliberately NOT changed: `set_profile_identity` itself. The advisor reports
-- it as anon-executable via /rest/v1/rpc, but it returns `trigger`, and
-- PostgREST does not expose trigger functions -- there is no reachable endpoint.
-- Revoking EXECUTE on a function that fires on every profile insert carries real
-- regression risk for zero security gain. Same for `get_workout_share_by_code`,
-- whose anon access is the entire point of a public share link.

revoke execute on function public.save_exercise_instructions(uuid, text[]) from anon;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('gen_friend_code', 'gen_username')
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.sig);
  end loop;
end $$;
