-- Tempo — Google Calendar integration: per-user Google refresh-token store.
-- Run once in your Supabase SQL editor. Safe to re-run (idempotent).
--
-- Architecture (Reuse Supabase + Edge Function):
--   1. The user signs in with Google through Supabase (already wired up). With
--      the calendar.events scope added to the provider, Supabase returns a Google
--      refresh token in session.provider_refresh_token.
--   2. The app hands that refresh token to the 'google-calendar-token' Edge
--      Function ONCE; the function stores it here using the service-role key.
--   3. Whenever the app needs the Google Calendar API, the same function reads
--      this row (service role) and exchanges the refresh token for a fresh access
--      token — so the Google *client secret* never ships in the app.
--
-- Security: the refresh token is long-lived and sensitive. RLS is ENABLED with
-- NO policies, so the anon/authenticated client can neither read nor write this
-- table. Only the Edge Function (service-role key, which bypasses RLS) touches
-- it. Refresh tokens therefore stay entirely server-side.

create table if not exists public.google_calendar_tokens (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  refresh_token text        not null,
  scope         text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_calendar_tokens enable row level security;

-- Intentionally NO policies: RLS with no policies = deny-all for the anon and
-- authenticated roles. The service-role key (Edge Function only) bypasses RLS.

comment on table public.google_calendar_tokens is
  'Per-user Google OAuth refresh tokens for the Calendar integration. Written/read only by the google-calendar-token Edge Function via the service-role key; RLS denies all direct client access.';
