-- "Add workouts to my calendar" preference.  (APPLIED to live project.)
--
-- When ON (the default) and a calendar is connected, Tempo automatically adds
-- scheduled workouts to the user's calendar. Connecting a calendar is the opt-in;
-- the toggle lets users turn the auto-add off without disconnecting.
alter table public.user_profiles
  add column if not exists calendar_autosync boolean not null default true;
