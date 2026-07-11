-- Activity reactions: a single lightweight "nice work" (🔥) on a friend's completed
-- session in the Friend Activity feed. Additive; mirrors the friends-only visibility
-- and SECURITY DEFINER-RPC pattern of add_social_v2.sql. Reads (counts + "did I
-- react?") ride the feed RPC; writes go through a validated toggle RPC — so the
-- table itself stays owner-only under RLS.

-- 1) Table ----------------------------------------------------------------------
create table if not exists public.activity_reactions (
  id          uuid primary key default gen_random_uuid(),
  reactor_id  uuid not null references auth.users (id) on delete cascade,
  -- The feed item reacted to is a completed scheduled_workout.
  workout_id  uuid not null references public.scheduled_workouts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- One reaction per person per session (a single reaction type, not a picker).
  unique (reactor_id, workout_id)
);
create index if not exists activity_reactions_workout_idx on public.activity_reactions (workout_id);

-- 2) RLS ------------------------------------------------------------------------
-- Feed counts + toggling go through SECURITY DEFINER functions that validate
-- friendship, so direct table access is limited to a user's OWN reaction rows.
alter table public.activity_reactions enable row level security;

drop policy if exists activity_reactions_own_select on public.activity_reactions;
create policy activity_reactions_own_select on public.activity_reactions
  for select using (reactor_id = auth.uid());

drop policy if exists activity_reactions_own_insert on public.activity_reactions;
create policy activity_reactions_own_insert on public.activity_reactions
  for insert with check (reactor_id = auth.uid());

drop policy if exists activity_reactions_own_delete on public.activity_reactions;
create policy activity_reactions_own_delete on public.activity_reactions
  for delete using (reactor_id = auth.uid());

-- 3) Feed RPC — now also carries the workout id + reaction summary ---------------
-- Same body/visibility as add_social_v2.sql's friend_feed, plus three columns:
-- workout_id (so the client can react to a row), reaction_count, and i_reacted.
-- Dropped first because adding OUT columns changes the return type, which
-- CREATE OR REPLACE can't do.
drop function if exists public.friend_feed();
create or replace function public.friend_feed()
returns table (
  user_id uuid, display_name text, avatar_url text, username text,
  focus text, completed_at timestamptz,
  workout_id uuid, reaction_count int, i_reacted boolean
)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username, sw.focus, sw.completed_at,
         sw.id as workout_id,
         (select count(*)::int from public.activity_reactions ar where ar.workout_id = sw.id) as reaction_count,
         exists (
           select 1 from public.activity_reactions ar
           where ar.workout_id = sw.id and ar.reactor_id = auth.uid()
         ) as i_reacted
  from public.friendships f
  join public.user_profiles p
    on p.user_id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  join public.scheduled_workouts sw on sw.user_id = p.user_id
  where auth.uid() is not null
    and f.status = 'accepted'
    and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and p.privacy_activity in ('public', 'friends')
    and sw.status = 'completed'
    and sw.completed_at > now() - interval '14 days'
  order by sw.completed_at desc
  limit 30;
$$;
revoke execute on function public.friend_feed() from public, anon;
grant execute on function public.friend_feed() to authenticated;

-- 4) Toggle RPC — react / un-react, returns the fresh count + state --------------
create or replace function public.toggle_activity_reaction(target_workout uuid)
returns table (reaction_count int, i_reacted boolean)
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  owner uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  -- You can only react to what you could see in the feed: a completed session
  -- owned by an accepted friend (or yourself).
  select sw.user_id into owner from public.scheduled_workouts sw
    where sw.id = target_workout and sw.status = 'completed';
  if owner is null then raise exception 'workout not found'; end if;
  if owner <> me and not public.are_friends(me, owner) then
    raise exception 'not permitted';
  end if;

  if exists (select 1 from public.activity_reactions where reactor_id = me and workout_id = target_workout) then
    delete from public.activity_reactions where reactor_id = me and workout_id = target_workout;
  else
    insert into public.activity_reactions (reactor_id, workout_id) values (me, target_workout)
      on conflict (reactor_id, workout_id) do nothing;
  end if;

  return query
    select (select count(*)::int from public.activity_reactions where workout_id = target_workout),
           exists (select 1 from public.activity_reactions where workout_id = target_workout and reactor_id = me);
end;
$$;
revoke execute on function public.toggle_activity_reaction(uuid) from public, anon;
grant execute on function public.toggle_activity_reaction(uuid) to authenticated;
