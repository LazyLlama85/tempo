-- Social upgrade Stage 1 — leaderboard trio (Weekly Consistency, Streak, Tempo Score).
-- Additive + idempotent. Keeps the existing friends_leaderboard() untouched (older
-- clients still work); adds a v2 that returns every rank input in one round trip.
--
-- The Tempo Score itself is computed in the CLIENT (lib/tempoScore.ts) so the formula
-- stays OTA-tunable — this RPC returns only the raw, strength-free components.

-- Perf: every subquery below filters scheduled_workouts by (user, date, status).
create index if not exists scheduled_workouts_user_date_status_idx
  on public.scheduled_workouts (user_id, planned_date, status);

-- ── Streak in SQL — mirrors lib/streak.ts (consecutive COMPLETED sessions) ────────
-- Settled sessions (completed/missed/skipped) up to today, newest first; on a day
-- with both a completion and a miss the completion ranks first so the day nets its
-- win. Streak = completions before the first non-completion.
create or replace function public.current_session_streak(uid uuid)
returns int
language sql stable security definer set search_path = public as $$
  with settled as (
    select status,
      row_number() over (order by planned_date desc, (status = 'completed') desc) as rn
    from public.scheduled_workouts
    where user_id = uid
      and planned_date <= current_date
      and status in ('completed', 'missed', 'skipped')
  ), brk as (
    select min(rn) as first_break from settled where status <> 'completed'
  )
  select coalesce(
    (select first_break - 1 from brk where first_break is not null),
    (select count(*) from settled)
  )::int;
$$;
revoke execute on function public.current_session_streak(uuid) from public, anon;
grant execute on function public.current_session_streak(uuid) to authenticated;

-- ── Leaderboard v2 — one row per friend (+ self), all rank inputs ─────────────────
-- Privacy-gated exactly like friends_leaderboard(): a friend appears only if their
-- privacy_stats is public/friends (self always included). Unordered — the client
-- sorts per tab (completion% / streak / Tempo Score).
create or replace function public.friends_leaderboard_v2()
returns table (
  user_id uuid, display_name text, avatar_url text, username text,
  scheduled_this_week bigint, completed_this_week bigint, active_days_this_week bigint,
  current_streak int,
  due_28 bigint, completed_28 bigint, weeks_met_goal int, goal_per_week int
)
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
    and (p.user_id = auth.uid() or p.privacy_stats in ('public', 'friends'));
$$;
revoke execute on function public.friends_leaderboard_v2() from public, anon;
grant execute on function public.friends_leaderboard_v2() to authenticated;
