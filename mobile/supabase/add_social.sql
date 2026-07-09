-- Social layer: friendships, privacy controls, and workout sharing. (Additive.)
--
-- Design notes:
--   • friendships is a single-row-per-pair table (unique on the unordered pair);
--     the addressee accepts by flipping status to 'accepted'.
--   • Privacy is three per-user knobs on user_profiles (workouts / stats /
--     activity), each public | friends | private (default friends).
--   • Profile discovery goes through SECURITY DEFINER RPCs that expose only
--     user_id / display_name / avatar_url — RLS on user_profiles stays owner-only.
--   • Friend workout browsing = an extra SELECT policy on workout_templates
--     gated by the owner's privacy_workouts + are_friends().
--   • Sharing snapshots a template into workout_shares under a short code; any
--     signed-in user with the code can read it (the link IS the capability).

-- 1) Friendships ---------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_uniq
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;
drop policy if exists "Parties can view friendship" on public.friendships;
create policy "Parties can view friendship" on public.friendships
  for select using (auth.uid() in (requester_id, addressee_id));
drop policy if exists "Send friend request" on public.friendships;
create policy "Send friend request" on public.friendships
  for insert with check (auth.uid() = requester_id and status = 'pending');
drop policy if exists "Addressee responds" on public.friendships;
create policy "Addressee responds" on public.friendships
  for update using (auth.uid() = addressee_id) with check (auth.uid() = addressee_id);
drop policy if exists "Either party can remove" on public.friendships;
create policy "Either party can remove" on public.friendships
  for delete using (auth.uid() in (requester_id, addressee_id));

-- 2) Privacy preferences --------------------------------------------------------
alter table public.user_profiles
  add column if not exists privacy_workouts text not null default 'friends'
    check (privacy_workouts in ('public', 'friends', 'private')),
  add column if not exists privacy_stats text not null default 'friends'
    check (privacy_stats in ('public', 'friends', 'private')),
  add column if not exists privacy_activity text not null default 'friends'
    check (privacy_activity in ('public', 'friends', 'private'));

-- 3) Helper: accepted friendship between two users -------------------------------
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a))
  );
$$;
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- 4) Discovery RPCs (name + avatar only) ----------------------------------------
create or replace function public.search_profiles(q text)
returns table (user_id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url
  from public.user_profiles p
  where auth.uid() is not null
    and p.user_id <> auth.uid()
    and p.display_name is not null
    and length(trim(q)) >= 2
    and p.display_name ilike '%' || trim(q) || '%'
  order by p.display_name
  limit 20;
$$;
revoke execute on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

create or replace function public.get_public_profiles(ids uuid[])
returns table (user_id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url
  from public.user_profiles p
  where auth.uid() is not null and p.user_id = any (ids)
  limit 100;
$$;
revoke execute on function public.get_public_profiles(uuid[]) from public, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;

-- 5) Friend profile overview (privacy-gated stats + recent activity) -------------
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
  select display_name, avatar_url, privacy_stats, privacy_activity
    into prof from public.user_profiles where user_id = target;
  if not found then return null; end if;

  can_stats := me = target or prof.privacy_stats = 'public'
    or (prof.privacy_stats = 'friends' and public.are_friends(me, target));
  can_activity := me = target or prof.privacy_activity = 'public'
    or (prof.privacy_activity = 'friends' and public.are_friends(me, target));

  result := jsonb_build_object(
    'display_name', prof.display_name,
    'avatar_url', prof.avatar_url,
    'stats_visible', can_stats,
    'activity_visible', can_activity
  );

  if can_stats then
    result := result || jsonb_build_object(
      'total_workouts',
        (select count(*) from public.scheduled_workouts
          where user_id = target and status = 'completed'),
      'total_sets',
        (select count(*) from public.set_logs sl
          join public.workout_logs wl on wl.id = sl.workout_log_id
          where wl.user_id = target),
      -- Settled sessions (last 120 days) so the client can run its own streak math.
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
revoke execute on function public.friend_overview(uuid) from public, anon;
grant execute on function public.friend_overview(uuid) to authenticated;

-- 6) Friends (or everyone, when public) can browse workout templates -------------
drop policy if exists "Friends can view templates" on public.workout_templates;
create policy "Friends can view templates" on public.workout_templates
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.user_profiles p
      where p.user_id = workout_templates.user_id
        and (p.privacy_workouts = 'public'
          or (p.privacy_workouts = 'friends'
              and public.are_friends(auth.uid(), workout_templates.user_id)))
    )
  );

-- 7) Workout shares (link/code sharing, snapshot semantics) ----------------------
create table if not exists public.workout_shares (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_name text,
  name text not null,
  -- [{ "id": uuid, "name": text }] snapshot so the preview renders even if the
  -- viewer can't read some exercise rows (e.g. the owner's custom exercises).
  exercises jsonb not null default '[]'::jsonb,
  config jsonb not null default '[]'::jsonb,
  est_duration_min integer not null default 45,
  created_at timestamptz not null default now()
);
create index if not exists workout_shares_owner_idx on public.workout_shares (owner_id);

alter table public.workout_shares enable row level security;
drop policy if exists "Signed-in users can read shares" on public.workout_shares;
create policy "Signed-in users can read shares" on public.workout_shares
  for select using (auth.uid() is not null);
drop policy if exists "Create own shares" on public.workout_shares;
create policy "Create own shares" on public.workout_shares
  for insert with check (auth.uid() = owner_id);
drop policy if exists "Delete own shares" on public.workout_shares;
create policy "Delete own shares" on public.workout_shares
  for delete using (auth.uid() = owner_id);
