-- Pause / vacation mode (PRODUCT_AUDIT.html §26, L21 — designed in AUDIT.md §6,
-- never built). A user who goes away for a week today returns to a broken streak
-- and a wall of "missed" sessions, because nothing tells the plan they're gone.
--
-- Model: pausing shifts every future scheduled row forward by N days (client-side,
-- lib/pauseMode.ts — reuses resyncMovedWorkout so calendar events + reminders move
-- with them) and records the return date here. Resuming early shifts the
-- still-unrealized remainder back. Time simply passing (today >= paused_until)
-- needs no shift — the dates already landed in the right place — just clears the
-- flag. week_index is never touched, so the mesocycle resumes exactly where it
-- left off. No new table: a single nullable column is enough state.

alter table public.user_profiles
  add column if not exists paused_until date default null;

comment on column public.user_profiles.paused_until is
  'Inclusive last day of an active pause. Null = not paused. Every scheduled_workouts row with planned_date >= the pause start was shifted forward by the pause length (lib/pauseMode.ts); this column exists so the missed-workout sweep and Home/Plan UI can tell a pause is in effect.';
