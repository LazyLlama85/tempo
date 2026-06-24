-- Tempo — "ignore this event" support.
--
-- Stores the content keys (see mobile/src/lib/ignoredEvents.ts) of calendar events
-- the user has chosen to ignore, so the scheduler may place a workout over that time.
-- A JSON array of strings; null/absent means nothing is ignored.
alter table public.user_profiles
  add column if not exists ignored_events jsonb;
