-- Adding workouts to a calendar is now OPT-IN (previously default-on).
--
-- Connecting a calendar (to read busy times / schedule around real life) should not
-- silently start writing Tempo events into it. Flip the default to false and reset
-- existing rows so no user has auto-add on without a deliberate choice. The client
-- (`lib/calendarAutoSync.autoSyncEnabled`) now treats only an explicit `true` as on,
-- and turning the toggle off purges every Tempo event we ever added.

alter table public.user_profiles
  alter column calendar_autosync set default false;

update public.user_profiles
  set calendar_autosync = false
  where calendar_autosync is distinct from false;
