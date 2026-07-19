-- Tempo — workout_shares: read access scoped to "you know the code"
-- (MASTER_FIX_PLAN.md F10 part 2).
--
-- The existing SELECT policy ("Signed-in users can read shares", using
-- auth.uid() IS NOT NULL) let ANY signed-in user SELECT * from the whole
-- table directly via PostgREST — not just look up one share by its code, but
-- enumerate every user's shared workout name, owner_name, and exercise list,
-- since RLS only gates "are you signed in," not "did you present the code."
--
-- workout_shares.code is a bearer-token-style capability (a short, effectively
-- unguessable random string) — the correct access model is "you may read a
-- row if you present its exact code," which RLS alone can't express (a policy
-- predicate can't see "the client filtered by code" vs. "the client is
-- enumerating everything"). Fixed the same way any capability-URL system
-- does: the table's own RLS is tightened to owner-only (matching insert/
-- delete, which were already owner-scoped), and a SECURITY DEFINER function
-- does the by-code lookup, bypassing RLS internally the way the row's own
-- "if you have the code, you're meant to see it" semantics require.

drop policy if exists "Signed-in users can read shares" on public.workout_shares;
create policy "Owners can read their own shares" on public.workout_shares
  for select using (auth.uid() = owner_id);

create or replace function public.get_workout_share_by_code(p_code text)
returns setof public.workout_shares
language sql
security definer
set search_path = public
stable
as $$
  select * from public.workout_shares
  where code = lower(trim(p_code))
  limit 1;
$$;

grant execute on function public.get_workout_share_by_code(text) to authenticated;
