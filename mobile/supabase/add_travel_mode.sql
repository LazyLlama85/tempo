-- Temporary equipment override ("travel mode"). One nullable JSON blob keeps the
-- migration trivial and lets the app degrade gracefully before it's applied:
--   { "equipment": ["dumbbells"], "until": "2026-06-27", "label": "Hotel gym" }
-- null = not travelling. `until` is an inclusive 'YYYY-MM-DD' (or omitted = until the
-- user turns it off). When active, it replaces the profile's home equipment for Quick
-- Workouts, exercise swaps, and in-session substitutions.
alter table public.user_profiles
  add column if not exists travel_mode jsonb;
