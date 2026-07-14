-- Social upgrade Stage 2 — badges + richer activity feed. Additive + idempotent.
--
--   • user_badges     — awarded competitive/social badges (Weekly Winner, Top 3
--                       Monthly, Workout Partner). Derived consistency badges are
--                       NOT stored (they light up from stats in lib/badges.ts).
--   • activity_events — feed items that aren't a completed session (streak
--                       milestone, perfect week, badge earned). Completions stay
--                       in friend_feed(); the client merges the two streams.
--   • claim_competitive_badges() — awards last week's Weekly Winner + last month's
--                       Top 3 among the caller's friends. Idempotent; run on app open.

-- ── 1) user_badges ───────────────────────────────────────────────────────────────
create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_key text not null,
  period text not null default '', -- '2026-W28' / '2026-07' — dedupe scope
  earned_at timestamptz not null default now(),
  unique (user_id, badge_key, period)
);
create index if not exists user_badges_user_idx on public.user_badges (user_id);

alter table public.user_badges enable row level security;
drop policy if exists "Read own or friends badges" on public.user_badges;
create policy "Read own or friends badges" on public.user_badges
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.user_profiles p
      where p.user_id = user_badges.user_id
        and (p.privacy_stats = 'public'
          or (p.privacy_stats = 'friends' and public.are_friends(auth.uid(), user_badges.user_id)))
    )
  );
-- No client INSERT policy: competitive badges are written only by the SECURITY
-- DEFINER RPC below (which bypasses RLS), so they can't be spoofed.

-- ── 2) activity_events ───────────────────────────────────────────────────────────
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('streak_milestone', 'perfect_week', 'badge')),
  payload jsonb not null default '{}'::jsonb,
  dedupe text not null default '', -- e.g. 'streak:30' / 'week:2026-W28' / 'badge:weekly_winner'
  created_at timestamptz not null default now(),
  unique (user_id, kind, dedupe)
);
create index if not exists activity_events_user_idx on public.activity_events (user_id, created_at desc);

alter table public.activity_events enable row level security;
drop policy if exists "Insert own events" on public.activity_events;
create policy "Insert own events" on public.activity_events
  for insert with check (auth.uid() = user_id);
drop policy if exists "Read own or friends events" on public.activity_events;
create policy "Read own or friends events" on public.activity_events
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.user_profiles p
      where p.user_id = activity_events.user_id
        and (p.privacy_activity = 'public'
          or (p.privacy_activity = 'friends' and public.are_friends(auth.uid(), activity_events.user_id)))
    )
  );

-- ── 3) Award competitive badges (idempotent; run on app open) ────────────────────
create or replace function public.claim_competitive_badges()
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  lw_start date := date_trunc('week', current_date)::date - 7;
  lw_end   date := date_trunc('week', current_date)::date - 1;
  lw_period text := to_char(date_trunc('week', current_date)::date - 7, 'IYYY"-W"IW');
  lm_first date := (date_trunc('month', current_date) - interval '1 month')::date;
  lm_last  date := (date_trunc('month', current_date))::date - 1;
  lm_period text := to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM');
  member_count int;
  my_week int; max_week int;
  my_month int; better_month int;
begin
  if me is null then return; end if;

  with members as (
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    union select me
  )
  select count(*) into member_count from members;
  if member_count < 2 then return; end if;

  -- Weekly Winner — most completed sessions last ISO week (ties all win).
  select count(*) into my_week from public.scheduled_workouts
    where user_id = me and status = 'completed' and planned_date between lw_start and lw_end;
  with members as (
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    union select me
  )
  select max((select count(*) from public.scheduled_workouts sw
              where sw.user_id = m.uid and sw.status = 'completed'
                and sw.planned_date between lw_start and lw_end))
    into max_week from members m;
  if my_week > 0 and my_week = max_week then
    insert into public.user_badges (user_id, badge_key, period)
      values (me, 'weekly_winner', lw_period) on conflict do nothing;
  end if;

  -- Top 3 Monthly — fewer than 3 friends ahead of me last calendar month.
  select count(*) into my_month from public.scheduled_workouts
    where user_id = me and status = 'completed' and planned_date between lm_first and lm_last;
  with members as (
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    union select me
  )
  select count(*) into better_month from members m
    where m.uid <> me
      and (select count(*) from public.scheduled_workouts sw
           where sw.user_id = m.uid and sw.status = 'completed'
             and sw.planned_date between lm_first and lm_last) > my_month;
  if my_month > 0 and better_month < 3 then
    insert into public.user_badges (user_id, badge_key, period)
      values (me, 'top3_monthly', lm_period) on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.claim_competitive_badges() from public, anon;
grant execute on function public.claim_competitive_badges() to authenticated;

-- ── 4) Friend events stream (for the richer feed; merged client-side w/ completions)
create or replace function public.friend_events()
returns table (user_id uuid, display_name text, avatar_url text, username text,
               kind text, payload jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username, e.kind, e.payload, e.created_at
  from public.friendships f
  join public.user_profiles p
    on p.user_id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  join public.activity_events e on e.user_id = p.user_id
  where auth.uid() is not null
    and f.status = 'accepted' and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and p.privacy_activity in ('public', 'friends')
    and e.created_at > now() - interval '14 days'
  order by e.created_at desc
  limit 30;
$$;
revoke execute on function public.friend_events() from public, anon;
grant execute on function public.friend_events() to authenticated;

-- ── 5) friend_overview += stored_badges (competitive/social badge keys) ───────────
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
