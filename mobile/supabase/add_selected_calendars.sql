-- Tempo — multi-calendar selection (B1.5).
--
-- Which of the user's Google calendars (beyond 'primary') Tempo reads busy-time
-- from. Nullable/optional so the app keeps working before this migration is
-- applied and before any user has configured it — null/empty means "just
-- primary", identical to today's behavior. Dormant until the
-- calendar.calendarlist.readonly OAuth scope is granted (see
-- services/googleCalendar/config.ts) — the picker UI honestly shows "not
-- available yet" until then, but the column can exist ahead of that.

alter table public.user_profiles
  add column if not exists selected_google_calendar_ids jsonb;
