-- Social upgrade Stage 3 — private groups with their own leaderboards. Additive.
--
-- A group is a named circle (Summer Challenge, Roommates…) you join by invite code.
-- Each group gets the same three boards as friends (Weekly / Streak / Tempo Score),
-- scoped to its members. Reuses current_session_streak() + the leaderboard v2 shape.

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 40),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- Membership check as SECURITY DEFINER so RLS policies don't recurse.
create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = gid and user_id = uid);
$$;
revoke execute on function public.is_group_member(uuid, uuid) from public, anon;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

alter table public.groups enable row level security;
drop policy if exists "Members read their groups" on public.groups;
create policy "Members read their groups" on public.groups
  for select using (owner_id = auth.uid() or public.is_group_member(id, auth.uid()));
drop policy if exists "Owner manages group" on public.groups;
create policy "Owner manages group" on public.groups
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table public.group_members enable row level security;
drop policy if exists "Members see co-members" on public.group_members;
create policy "Members see co-members" on public.group_members
  for select using (public.is_group_member(group_id, auth.uid()));
drop policy if exists "Leave a group" on public.group_members;
create policy "Leave a group" on public.group_members
  for delete using (user_id = auth.uid());
-- Joins + the owner's founding membership go through the SECURITY DEFINER RPCs below.

-- ── Create a group (inserts the group + owner membership atomically) ─────────────
create or replace function public.create_group(p_name text)
returns table (id uuid, name text, invite_code text)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gid uuid; code text;
begin
  if me is null or length(trim(coalesce(p_name, ''))) = 0 then return; end if;
  loop
    begin
      code := public.gen_friend_code();
      insert into public.groups (name, owner_id, invite_code)
        values (left(trim(p_name), 40), me, code) returning groups.id into gid;
      exit;
    exception when unique_violation then null; -- retry on code collision
    end;
  end loop;
  insert into public.group_members (group_id, user_id, role) values (gid, me, 'owner');
  return query select gid, left(trim(p_name), 40), code;
end;
$$;
revoke execute on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;

-- ── Join a group by invite code (idempotent) ─────────────────────────────────────
create or replace function public.join_group(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gid uuid;
begin
  if me is null then return null; end if;
  select id into gid from public.groups where invite_code = upper(trim(p_code));
  if gid is null then return null; end if;
  insert into public.group_members (group_id, user_id, role)
    values (gid, me, 'member') on conflict do nothing;
  return gid;
end;
$$;
revoke execute on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

-- ── Leave a group. Owner leaving deletes the whole group (cascade). ──────────────
create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if exists (select 1 from public.groups where id = p_group and owner_id = me) then
    delete from public.groups where id = p_group; -- cascades to members
  else
    delete from public.group_members where group_id = p_group and user_id = me;
  end if;
end;
$$;
revoke execute on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

-- ── My groups (with member count) ────────────────────────────────────────────────
create or replace function public.list_my_groups()
returns table (id uuid, name text, invite_code text, owner_id uuid, member_count bigint)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.invite_code, g.owner_id,
    (select count(*) from public.group_members m2 where m2.group_id = g.id) as member_count
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  where auth.uid() is not null
  order by g.created_at desc;
$$;
revoke execute on function public.list_my_groups() from public, anon;
grant execute on function public.list_my_groups() to authenticated;

-- ── Group leaderboard (same shape as friends_leaderboard_v2, scoped to members) ──
create or replace function public.group_leaderboard(p_group uuid)
returns table (
  user_id uuid, display_name text, avatar_url text, username text,
  scheduled_this_week bigint, completed_this_week bigint, active_days_this_week bigint,
  current_streak int,
  due_28 bigint, completed_28 bigint, weeks_met_goal int, goal_per_week int
)
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
    and public.is_group_member(p_group, auth.uid()); -- only members can read the board
$$;
revoke execute on function public.group_leaderboard(uuid) from public, anon;
grant execute on function public.group_leaderboard(uuid) to authenticated;
