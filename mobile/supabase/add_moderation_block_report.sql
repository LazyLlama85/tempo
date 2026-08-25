-- Arclo — App Store Guideline 1.2 (Safety: User-Generated Content) safeguards.
--
-- WHY (2026-08-25). The age-rating questionnaire declares `userGeneratedContent:
-- true`, which is correct: usernames (`updateUsername`, USERNAME_RULE) and group
-- names (`create_group`) are both user-authored free text shown to other people,
-- and the feed/leaderboards surface them. Guideline 1.2 requires an app with UGC
-- to provide a way to REPORT offensive content and a way to BLOCK abusive users.
-- This app had neither. `removeFriendship` is unfriending, not blocking — the
-- other party can simply send another request.
--
-- WHY IT IS ENFORCED HERE AND NOT IN THE CLIENT. Every discovery surface
-- (search, feed, both leaderboards, group leaderboard, friend profile) reads
-- through a SECURITY DEFINER RPC, which bypasses RLS by design. Filtering in the
-- app would leave the data reachable by any older/modified client and would not
-- be a real block. Each RPC below is therefore re-created with its ORIGINAL body
-- preserved verbatim and exactly one predicate added. Nothing else changed —
-- these definitions were read back from the live database with
-- pg_get_functiondef, not copied from the older migration files, several of
-- which have since been superseded.

-- 1) Blocks -------------------------------------------------------------------
-- One row per (blocker, blocked) direction. Hiding is symmetric (see is_blocked):
-- if either party blocks, neither sees the other. That is the behaviour users
-- expect and it stops a blocked user from watching the blocker's activity.
create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocked_users_blocked_idx on public.blocked_users (blocked_id);

alter table public.blocked_users enable row level security;
drop policy if exists "Own blocks are visible" on public.blocked_users;
create policy "Own blocks are visible" on public.blocked_users
  for select using ((select auth.uid()) = blocker_id);
drop policy if exists "Block someone" on public.blocked_users;
create policy "Block someone" on public.blocked_users
  for insert with check ((select auth.uid()) = blocker_id);
drop policy if exists "Unblock someone" on public.blocked_users;
create policy "Unblock someone" on public.blocked_users
  for delete using ((select auth.uid()) = blocker_id);

-- 2) Reports ------------------------------------------------------------------
-- Insert-and-read-own only: a reporter must never be able to edit or delete a
-- report after the fact, and must never be able to read anyone else's. Triage
-- happens with the service_role key, which bypasses RLS.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  context text not null check (context in ('profile', 'feed', 'group', 'leaderboard')),
  reason text not null check (reason in
    ('harassment', 'hate_speech', 'sexual_content', 'spam', 'impersonation', 'other')),
  details text check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_id <> reported_user_id)
);
create index if not exists content_reports_reported_idx
  on public.content_reports (reported_user_id, created_at desc);
create index if not exists content_reports_open_idx
  on public.content_reports (created_at desc) where resolved_at is null;

alter table public.content_reports enable row level security;
drop policy if exists "Own reports are visible" on public.content_reports;
create policy "Own reports are visible" on public.content_reports
  for select using ((select auth.uid()) = reporter_id);
drop policy if exists "File a report" on public.content_reports;
create policy "File a report" on public.content_reports
  for insert with check ((select auth.uid()) = reporter_id);

-- 3) Helper -------------------------------------------------------------------
-- Symmetric, and SECURITY DEFINER so it works both inside the definer RPCs below
-- and inside the friendships RLS policy. Self is never blocked, which keeps the
-- caller's own row in the leaderboards' `members` CTE (it unions auth.uid()).
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and a <> b and exists (
    select 1 from public.blocked_users bu
    where (bu.blocker_id = a and bu.blocked_id = b)
       or (bu.blocker_id = b and bu.blocked_id = a)
  );
$$;

-- 4) Actions ------------------------------------------------------------------
-- Blocking also tears down any existing friendship, in either direction and at
-- any status. Leaving the row would keep a pending request alive and let the
-- blocked user reappear the moment they were unblocked.
create or replace function public.block_user(target uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or target is null or me = target then return false; end if;
  insert into public.blocked_users (blocker_id, blocked_id)
    values (me, target) on conflict do nothing;
  delete from public.friendships f
    where (f.requester_id = me and f.addressee_id = target)
       or (f.requester_id = target and f.addressee_id = me);
  return true;
end;
$$;

create or replace function public.unblock_user(target uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return false; end if;
  delete from public.blocked_users where blocker_id = me and blocked_id = target;
  return true;
end;
$$;

-- The blocked list needs names to be manageable, and user_profiles is owner-only
-- under RLS, so this mirrors get_public_profiles' definer pattern.
create or replace function public.list_blocked_users()
returns table(user_id uuid, display_name text, avatar_url text, username text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username, bu.created_at
  from public.blocked_users bu
  join public.user_profiles p on p.user_id = bu.blocked_id
  where bu.blocker_id = auth.uid() and auth.uid() is not null
  order by bu.created_at desc
  limit 200;
$$;

create or replace function public.report_content(
  target uuid, p_context text, p_reason text, p_details text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or target is null or me = target then return false; end if;
  insert into public.content_reports (reporter_id, reported_user_id, context, reason, details)
    values (me, target, p_context, p_reason, nullif(btrim(coalesce(p_details, '')), ''));
  return true;
end;
$$;

-- 5) Stop a blocked user from re-requesting -----------------------------------
-- Same policy as before plus the block check; without this, "Block" would not
-- stop a new friend request from landing.
drop policy if exists "Send friend request" on public.friendships;
create policy "Send friend request" on public.friendships
  for insert with check (
    (select auth.uid()) = requester_id
    and status = 'pending'
    and not public.is_blocked(requester_id, addressee_id)
  );

-- 6) Filter every discovery surface -------------------------------------------
-- Each body below is the live definition, unchanged except for the added
-- `is_blocked` predicate.

create or replace function public.search_profiles(q text)
returns table(user_id uuid, display_name text, avatar_url text, username text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username
  from public.user_profiles p
  where auth.uid() is not null
    and p.user_id <> auth.uid()
    and not public.is_blocked(auth.uid(), p.user_id)
    and length(trim(q)) >= 2
    and (
      upper(trim(q)) = p.friend_code
      or (left(trim(q), 1) = '@' and p.username ilike ltrim(trim(q), '@') || '%')
      or p.display_name ilike '%' || trim(q) || '%'
      or p.username ilike trim(q) || '%'
    )
  order by (upper(trim(q)) = p.friend_code) desc, p.username
  limit 20;
$$;

create or replace function public.get_public_profiles(ids uuid[])
returns table(user_id uuid, display_name text, avatar_url text, username text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username
  from public.user_profiles p
  where auth.uid() is not null and p.user_id = any (ids)
    and not public.is_blocked(auth.uid(), p.user_id)
  limit 100;
$$;

create or replace function public.friend_feed()
returns table(user_id uuid, display_name text, avatar_url text, username text,
              focus text, completed_at timestamptz, workout_id uuid,
              reaction_count integer, i_reacted boolean)
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
    and not public.is_blocked(auth.uid(), p.user_id)
    and p.privacy_activity in ('public', 'friends')
    and sw.status = 'completed'
    and sw.completed_at > now() - interval '14 days'
  order by sw.completed_at desc
  limit 30;
$$;

create or replace function public.friend_events()
returns table(user_id uuid, display_name text, avatar_url text, username text,
              kind text, payload jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username, e.kind, e.payload, e.created_at
  from public.friendships f
  join public.user_profiles p
    on p.user_id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  join public.activity_events e on e.user_id = p.user_id
  where auth.uid() is not null
    and f.status = 'accepted' and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and not public.is_blocked(auth.uid(), p.user_id)
    and p.privacy_activity in ('public', 'friends')
    and e.created_at > now() - interval '14 days'
  order by e.created_at desc
  limit 30;
$$;

create or replace function public.friends_leaderboard()
returns table(user_id uuid, display_name text, avatar_url text, username text,
              workouts_this_week bigint)
language sql stable security definer set search_path = public as $$
  with members as (
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    union
    select auth.uid()
  )
  select p.user_id, p.display_name, p.avatar_url, p.username,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id and sw.status = 'completed'
        and sw.planned_date >= date_trunc('week', current_date)::date) as workouts_this_week
  from members m
  join public.user_profiles p on p.user_id = m.uid
  where auth.uid() is not null
    and not public.is_blocked(auth.uid(), p.user_id)
    and (p.user_id = auth.uid() or p.privacy_stats in ('public', 'friends'))
  order by workouts_this_week desc, p.username
  limit 50;
$$;

create or replace function public.friends_leaderboard_v2()
returns table(user_id uuid, display_name text, avatar_url text, username text,
              scheduled_this_week bigint, completed_this_week bigint,
              active_days_this_week bigint, current_streak integer,
              due_28 bigint, completed_28 bigint, weeks_met_goal integer,
              goal_per_week integer)
language sql stable security definer set search_path = public as $$
  with members as (
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    union
    select auth.uid()
  )
  select
    p.user_id, p.display_name, p.avatar_url, p.username,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status in ('completed', 'missed', 'skipped')) as scheduled_this_week,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status = 'completed') as completed_this_week,
    (select count(distinct sw.planned_date) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status = 'completed') as active_days_this_week,
    public.current_session_streak(p.user_id) as current_streak,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= current_date - 27 and sw.planned_date <= current_date
        and sw.status in ('completed', 'missed', 'skipped')) as due_28,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= current_date - 27 and sw.planned_date <= current_date
        and sw.status = 'completed') as completed_28,
    (select count(*)::int
      from generate_series(0, 3) as g(w)
      where (select count(*) from public.scheduled_workouts sw
              where sw.user_id = p.user_id and sw.status = 'completed'
                and sw.planned_date >= current_date - (g.w * 7 + 6)
                and sw.planned_date <= current_date - (g.w * 7))
            >= greatest(1, ceil(0.6 * coalesce(nullif(p.days_per_week, 0), 3)))) as weeks_met_goal,
    coalesce(nullif(p.days_per_week, 0), 3) as goal_per_week
  from members m
  join public.user_profiles p on p.user_id = m.uid
  where auth.uid() is not null
    and not public.is_blocked(auth.uid(), p.user_id)
    and (p.user_id = auth.uid() or p.privacy_stats in ('public', 'friends'));
$$;

create or replace function public.group_leaderboard(p_group uuid)
returns table(user_id uuid, display_name text, avatar_url text, username text,
              scheduled_this_week bigint, completed_this_week bigint,
              active_days_this_week bigint, current_streak integer,
              due_28 bigint, completed_28 bigint, weeks_met_goal integer,
              goal_per_week integer)
language sql stable security definer set search_path = public as $$
  select
    p.user_id, p.display_name, p.avatar_url, p.username,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status in ('completed', 'missed', 'skipped')) as scheduled_this_week,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status = 'completed') as completed_this_week,
    (select count(distinct sw.planned_date) from public.scheduled_workouts sw
      where sw.user_id = p.user_id and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status = 'completed') as active_days_this_week,
    public.current_session_streak(p.user_id) as current_streak,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id and sw.planned_date >= current_date - 27 and sw.planned_date <= current_date
        and sw.status in ('completed', 'missed', 'skipped')) as due_28,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id and sw.planned_date >= current_date - 27 and sw.planned_date <= current_date
        and sw.status = 'completed') as completed_28,
    (select count(*)::int from generate_series(0, 3) as g(w)
      where (select count(*) from public.scheduled_workouts sw
              where sw.user_id = p.user_id and sw.status = 'completed'
                and sw.planned_date >= current_date - (g.w * 7 + 6)
                and sw.planned_date <= current_date - (g.w * 7))
            >= greatest(1, ceil(0.6 * coalesce(nullif(p.days_per_week, 0), 3)))) as weeks_met_goal,
    coalesce(nullif(p.days_per_week, 0), 3) as goal_per_week
  from public.group_members m
  join public.user_profiles p on p.user_id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group, auth.uid())
    and not public.is_blocked(auth.uid(), p.user_id);
$$;

-- friend_overview is the deep-link surface: a blocked user's profile must not be
-- reachable even by direct user_id. Returning null makes the screen render its
-- existing "profile unavailable" empty state — no new client branch needed.
create or replace function public.friend_overview(target uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  prof record;
  can_stats boolean;
  can_activity boolean;
  result jsonb;
begin
  if me is null then return null; end if;
  if public.is_blocked(me, target) then return null; end if;
  select display_name, avatar_url, username, created_at, goal, days_per_week, privacy_stats, privacy_activity
    into prof from public.user_profiles where user_id = target;
  if not found then return null; end if;

  can_stats := me = target or prof.privacy_stats = 'public'
    or (prof.privacy_stats = 'friends' and public.are_friends(me, target));
  can_activity := me = target or prof.privacy_activity = 'public'
    or (prof.privacy_activity = 'friends' and public.are_friends(me, target));

  result := jsonb_build_object(
    'display_name', prof.display_name,
    'avatar_url', prof.avatar_url,
    'username', prof.username,
    'member_since', prof.created_at,
    'stats_visible', can_stats,
    'activity_visible', can_activity
  );

  if can_stats then
    result := result || jsonb_build_object(
      'goal', prof.goal,
      'days_per_week', prof.days_per_week,
      'total_workouts',
        (select count(*) from public.scheduled_workouts
          where user_id = target and status = 'completed'),
      'total_sets',
        (select count(*) from public.set_logs sl
          join public.workout_logs wl on wl.id = sl.workout_log_id
          where wl.user_id = target and coalesce(sl.is_warmup, false) = false),
      'total_volume_lbs',
        (select coalesce(sum(sl.weight_lbs * sl.reps_completed), 0)::bigint from public.set_logs sl
          join public.workout_logs wl on wl.id = sl.workout_log_id
          where wl.user_id = target and sl.weight_lbs is not null
            and coalesce(sl.is_warmup, false) = false),
      'favorite_muscle',
        (select t.m from (
          select unnest(e.primary_muscles) as m, count(*) as c
          from public.set_logs sl
          join public.workout_logs wl on wl.id = sl.workout_log_id
          join public.exercises e on e.id = sl.exercise_id
          where wl.user_id = target and sl.completed_at > now() - interval '90 days'
          group by 1 order by c desc limit 1) t),
      'stored_badges',
        (select coalesce(jsonb_agg(distinct badge_key), '[]'::jsonb)
          from public.user_badges where user_id = target),
      'sessions',
        (select coalesce(jsonb_agg(jsonb_build_object('planned_date', planned_date, 'status', status)
                                   order by planned_date desc), '[]'::jsonb)
          from public.scheduled_workouts
          where user_id = target
            and planned_date >= (current_date - 120)
            and status in ('completed', 'missed', 'skipped'))
    );
  end if;

  if can_activity then
    result := result || jsonb_build_object(
      'recent',
        (select coalesce(jsonb_agg(jsonb_build_object('focus', r.focus, 'date', r.planned_date)), '[]'::jsonb)
          from (select focus, planned_date from public.scheduled_workouts
                 where user_id = target and status = 'completed'
                 order by planned_date desc limit 5) r)
    );
  end if;

  return result;
end;
$$;

grant execute on function public.is_blocked(uuid, uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_blocked_users() to authenticated;
grant execute on function public.report_content(uuid, text, text, text) to authenticated;
