-- Scheduling mode: connecting a calendar should NOT force automatic scheduling.
--
-- 'auto'   — Tempo places each workout at a real, calendar-aware time and quietly
--            re-slots it when a new event overlaps (the existing behaviour).
-- 'manual' — Tempo never moves a workout's time on its own; the user controls
--            times (still editable from the schedule). Connecting a calendar just
--            lets Tempo *read* busy times / sync events — it no longer implies auto.
--
-- Defaults to 'auto' so existing users keep today's behaviour.
alter table public.user_profiles
  add column if not exists scheduling_mode text not null default 'auto'
    check (scheduling_mode in ('auto','manual'));
