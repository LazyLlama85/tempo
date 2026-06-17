-- Tempo — repair duplicate scheduled workouts + prevent it recurring.
-- Run once in your Supabase SQL editor. Safe to re-run (idempotent).
--
-- Background: older builds regenerated the plan without clearing the previous
-- 4-week block, so the same day could end up with several identical sessions
-- (e.g. 4 workouts every Friday at 7:00). This collapses each future day to a
-- single plan workout and adds a guard so it can't happen again.
--
-- Note: we MARK extras as 'rescheduled' rather than DELETE them. Some duplicates
-- may already be referenced by workout_logs (you opened the session), and that
-- foreign key has no cascade — deleting would error. Marking them avoids the FK
-- violation, loses no logged history, and the app hides 'rescheduled' rows.

-- 1) One-time cleanup: keep one future, still-scheduled plan workout per day.
--    Prefer a session already synced to the device calendar, else the oldest.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, planned_date
      order by (calendar_event_id is not null) desc, created_at asc
    ) as rn
  from public.scheduled_workouts
  where status = 'scheduled'
    and planned_date >= current_date
    and user_plan_id is not null
)
update public.scheduled_workouts
set status = 'rescheduled'
where id in (select id from ranked where rn > 1);

-- 2) Guard: at most one *plan* scheduled workout per user per day going forward.
--    Completed history and ad-hoc Quick Workouts (user_plan_id is null) are
--    unaffected by this partial unique index.
create unique index if not exists scheduled_workouts_one_plan_per_day
  on public.scheduled_workouts (user_id, planned_date)
  where status = 'scheduled' and user_plan_id is not null;
