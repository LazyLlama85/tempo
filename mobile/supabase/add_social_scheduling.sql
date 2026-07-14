-- Social upgrade Stage 4 — social scheduling (shared availability + workout invites).
-- Additive + idempotent.
--
--   • privacy_availability — opt-in knob (default friends) for sharing coarse
--     availability with friends. friend_availability() is gated on it.
--   • workout_invites      — "train together" invitations; accept schedules the
--     workout for BOTH users (partner_id links the pair).
--   • partner_id on scheduled_workouts — marks a workout scheduled with a friend
--     (drives the "with X" display + the Workout Partner badge on completion).

alter table public.user_profiles
  add column if not exists privacy_availability text not null default 'friends'
    check (privacy_availability in ('public', 'friends', 'private'));

alter table public.scheduled_workouts
  add column if not exists partner_id uuid references auth.users(id) on delete set null;

create table if not exists public.workout_invites (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  focus text not null default 'Workout',
  proposed_date date not null,
  proposed_start time not null,
  duration_min int not null default 45,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'countered')),
  counter_date date,
  counter_start time,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);
create index if not exists workout_invites_to_idx on public.workout_invites (to_user, status);
create index if not exists workout_invites_from_idx on public.workout_invites (from_user, status);

alter table public.workout_invites enable row level security;
drop policy if exists "Parties read invites" on public.workout_invites;
create policy "Parties read invites" on public.workout_invites
  for select using (auth.uid() in (from_user, to_user));
-- Writes go through the SECURITY DEFINER RPCs below (validate friendship, schedule both).

-- ── Coarse availability for a mutual friend (privacy-gated) ──────────────────────
create or replace function public.friend_availability(target uuid, p_days int default 14)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); prof record; can boolean;
begin
  if me is null or target is null then return null; end if;
  select wake_time, bedtime, work_start, work_end, school_start, school_end,
         training_days, unavailable_blocks, preferred_time_of_day, privacy_availability
    into prof from public.user_profiles where user_id = target;
  if not found then return null; end if;
  can := me = target or prof.privacy_availability = 'public'
    or (prof.privacy_availability = 'friends' and public.are_friends(me, target));
  if not can then return null; end if;

  return jsonb_build_object(
    'wake_time', prof.wake_time, 'bedtime', prof.bedtime,
    'work_start', prof.work_start, 'work_end', prof.work_end,
    'school_start', prof.school_start, 'school_end', prof.school_end,
    'training_days', prof.training_days, 'unavailable_blocks', prof.unavailable_blocks,
    'preferred_time_of_day', prof.preferred_time_of_day,
    'busy', (select coalesce(jsonb_agg(jsonb_build_object(
                      'date', planned_date, 'start', planned_start_time, 'duration_min', planned_duration_min)), '[]'::jsonb)
             from public.scheduled_workouts
             where user_id = target and status in ('scheduled', 'completed')
               and planned_date >= current_date and planned_date < current_date + p_days)
  );
end;
$$;
revoke execute on function public.friend_availability(uuid, int) from public, anon;
grant execute on function public.friend_availability(uuid, int) to authenticated;

-- ── Send a "train together" invite (friends only) ───────────────────────────────
create or replace function public.send_workout_invite(p_to uuid, p_focus text, p_date date, p_start time, p_duration int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); iid uuid;
begin
  if me is null or p_to is null or me = p_to then return null; end if;
  if not public.are_friends(me, p_to) then return null; end if;
  if p_date < current_date then return null; end if; -- never invite for a past date
  insert into public.workout_invites (from_user, to_user, focus, proposed_date, proposed_start, duration_min)
    values (me, p_to, coalesce(nullif(trim(p_focus), ''), 'Workout'), p_date, p_start, coalesce(p_duration, 45))
    returning id into iid;
  return iid;
end;
$$;
revoke execute on function public.send_workout_invite(uuid, text, date, time, int) from public, anon;
grant execute on function public.send_workout_invite(uuid, text, date, time, int) to authenticated;

-- ── Respond: accept (schedule BOTH) / decline / counter ─────────────────────────
create or replace function public.respond_workout_invite(p_invite uuid, p_action text, p_counter_date date default null, p_counter_start time default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); inv record;
begin
  if me is null then return false; end if;
  select * into inv from public.workout_invites where id = p_invite and to_user = me and status = 'pending';
  if not found then return false; end if;

  if p_action = 'accept' then
    insert into public.scheduled_workouts
      (user_id, planned_date, planned_start_time, planned_duration_min, focus, status, source, partner_id)
    values
      (inv.from_user, inv.proposed_date, inv.proposed_start, inv.duration_min, inv.focus, 'scheduled', 'quick', inv.to_user),
      (inv.to_user,   inv.proposed_date, inv.proposed_start, inv.duration_min, inv.focus, 'scheduled', 'quick', inv.from_user);
    update public.workout_invites set status = 'accepted', responded_at = now() where id = p_invite;
  elsif p_action = 'decline' then
    update public.workout_invites set status = 'declined', responded_at = now() where id = p_invite;
  elsif p_action = 'counter' then
    update public.workout_invites
      set status = 'countered', counter_date = p_counter_date, counter_start = p_counter_start, responded_at = now()
      where id = p_invite;
  else
    return false;
  end if;
  return true;
end;
$$;
revoke execute on function public.respond_workout_invite(uuid, text, date, time) from public, anon;
grant execute on function public.respond_workout_invite(uuid, text, date, time) to authenticated;

-- ── My pending/countered invites (both directions) with profiles ─────────────────
create or replace function public.list_workout_invites()
returns table (id uuid, direction text, other_id uuid, display_name text, avatar_url text, username text,
               focus text, proposed_date date, proposed_start time, duration_min int, status text,
               counter_date date, counter_start time, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select wi.id,
    case when wi.from_user = auth.uid() then 'outgoing' else 'incoming' end as direction,
    case when wi.from_user = auth.uid() then wi.to_user else wi.from_user end as other_id,
    p.display_name, p.avatar_url, p.username,
    wi.focus, wi.proposed_date, wi.proposed_start, wi.duration_min, wi.status,
    wi.counter_date, wi.counter_start, wi.created_at
  from public.workout_invites wi
  join public.user_profiles p
    on p.user_id = case when wi.from_user = auth.uid() then wi.to_user else wi.from_user end
  where (wi.from_user = auth.uid() or wi.to_user = auth.uid())
    and wi.status in ('pending', 'countered')
    and wi.created_at > now() - interval '30 days'
  order by wi.created_at desc;
$$;
revoke execute on function public.list_workout_invites() from public, anon;
grant execute on function public.list_workout_invites() to authenticated;

-- ── claim_competitive_badges += Workout Partner (completed a partner workout) ────
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

  -- Workout Partner — completed a workout scheduled with a friend (no friend-count gate).
  if exists (select 1 from public.scheduled_workouts
             where user_id = me and status = 'completed' and partner_id is not null) then
    insert into public.user_badges (user_id, badge_key, period)
      values (me, 'workout_partner', '') on conflict do nothing;
  end if;

  with members as (
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    union select me
  )
  select count(*) into member_count from members;
  if member_count < 2 then return; end if;

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
