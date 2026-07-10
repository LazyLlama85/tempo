-- Social v2: identity (username + friend code), activity feed, friends
-- leaderboard, richer friend overview, split sharing, warm-up sets. (Additive.)

-- 1) Identity ------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists username text
    check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  add column if not exists friend_code text;
create unique index if not exists user_profiles_username_uniq
  on public.user_profiles (lower(username));
create unique index if not exists user_profiles_friend_code_uniq
  on public.user_profiles (friend_code);

-- 6-char code, no 0/O/1/I/L lookalikes (matches the share-code alphabet).
create or replace function public.gen_friend_code()
returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random()*31)+1)::int, 1), '')
  from generate_series(1, 6);
$$;

-- Slug a display name into a valid, likely-unique username base.
create or replace function public.gen_username(base text)
returns text language sql volatile as $$
  select left(coalesce(nullif(regexp_replace(lower(coalesce(base, '')), '[^a-z0-9_]', '', 'g'), ''), 'athlete'), 12)
         || (1000 + floor(random() * 9000))::int::text;
$$;

-- Backfill every existing profile (retry loops absorb the tiny collision odds).
do $$
declare r record;
begin
  for r in select user_id, display_name from public.user_profiles where friend_code is null loop
    loop
      begin
        update public.user_profiles set friend_code = public.gen_friend_code() where user_id = r.user_id;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
  end loop;
  for r in select user_id, display_name from public.user_profiles where username is null loop
    loop
      begin
        update public.user_profiles set username = public.gen_username(r.display_name) where user_id = r.user_id;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
  end loop;
end $$;

-- New profiles get both automatically.
create or replace function public.set_profile_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.friend_code is null then new.friend_code := public.gen_friend_code(); end if;
  if new.username is null then new.username := public.gen_username(new.display_name); end if;
  return new;
end;
$$;
drop trigger if exists user_profiles_identity on public.user_profiles;
create trigger user_profiles_identity
  before insert on public.user_profiles
  for each row execute function public.set_profile_identity();

-- 2) Discovery v2 (username + friend-code aware; return shapes changed) ----------
drop function if exists public.search_profiles(text);
create or replace function public.search_profiles(q text)
returns table (user_id uuid, display_name text, avatar_url text, username text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username
  from public.user_profiles p
  where auth.uid() is not null
    and p.user_id <> auth.uid()
    and length(trim(q)) >= 2
    and (
      -- exact friend code (case-insensitive)
      upper(trim(q)) = p.friend_code
      -- @username (exact or prefix)
      or (left(trim(q), 1) = '@' and p.username ilike ltrim(trim(q), '@') || '%')
      -- plain text: name or username
      or p.display_name ilike '%' || trim(q) || '%'
      or p.username ilike trim(q) || '%'
    )
  order by (upper(trim(q)) = p.friend_code) desc, p.username
  limit 20;
$$;
revoke execute on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

drop function if exists public.get_public_profiles(uuid[]);
create or replace function public.get_public_profiles(ids uuid[])
returns table (user_id uuid, display_name text, avatar_url text, username text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username
  from public.user_profiles p
  where auth.uid() is not null and p.user_id = any (ids)
  limit 100;
$$;
revoke execute on function public.get_public_profiles(uuid[]) from public, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;

-- 3) Activity feed ---------------------------------------------------------------
create or replace function public.friend_feed()
returns table (user_id uuid, display_name text, avatar_url text, username text, focus text, completed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.username, sw.focus, sw.completed_at
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

-- 4) Friends-only weekly leaderboard (self always included) -----------------------
create or replace function public.friends_leaderboard()
returns table (user_id uuid, display_name text, avatar_url text, username text, workouts_this_week bigint)
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
    and (p.user_id = auth.uid() or p.privacy_stats in ('public', 'friends'))
  order by workouts_this_week desc, p.username
  limit 50;
$$;
revoke execute on function public.friends_leaderboard() from public, anon;
grant execute on function public.friends_leaderboard() to authenticated;

-- 5) Richer friend overview (adds identity, goal, volume, favorite muscle, age) ---
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
  select display_name, avatar_url, username, created_at, goal, privacy_stats, privacy_activity
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

-- 6) Split sharing + share metadata ------------------------------------------------
alter table public.workout_shares
  add column if not exists kind text not null default 'workout'
    check (kind in ('workout', 'split')),
  add column if not exists days jsonb,
  add column if not exists equipment text[] not null default '{}'::text[];

-- 7) Warm-up sets -------------------------------------------------------------------
alter table public.set_logs
  add column if not exists is_warmup boolean not null default false;
