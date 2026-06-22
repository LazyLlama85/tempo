-- Tempo — "completely unavailable" times.
-- Run this in your Supabase SQL editor: https://supabase.com/dashboard → SQL Editor
--
-- Hard "never schedule a workout here" windows the user defines themselves —
-- recurring (a weekday, e.g. every Saturday for Shabbat) or a one-off date, all-day
-- or a time range. Stored as JSON on the profile so it travels with every load.
--
-- Each element:
--   { "id": "uuid", "scope": "weekday"|"date", "weekday": 1-7, "date": "YYYY-MM-DD",
--     "allDay": bool, "start": "HH:MM:SS", "end": "HH:MM:SS", "label": "Shabbat" }
-- (weekday: 1=Mon … 7=Sun. `start`/`end` omitted when allDay is true.)

alter table public.user_profiles
  add column if not exists unavailable_blocks jsonb not null default '[]'::jsonb;
