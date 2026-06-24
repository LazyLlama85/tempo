-- Tempo — Server-driven push notifications.
--
-- Two tables:
--   device_tokens     — every device's Expo push token, so the backend can reach
--                       a user without the app being open. The retention engine
--                       (see functions/retention-push) reads these.
--   notification_log  — an audit row for every push we attempt to send. Used for
--                       debugging, de-duplication ("did we already nudge this user
--                       today?"), and analytics tie-in.

-- ─────────────────────────────────────────────
-- Device push tokens
-- ─────────────────────────────────────────────
create table if not exists public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  token         text not null unique,           -- Expo push token (ExponentPushToken[...])
  platform      text not null check (platform in ('ios','android','web')),
  enabled       boolean not null default true,   -- flipped off when Expo reports the token is dead
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on public.device_tokens(user_id) where enabled;

alter table public.device_tokens enable row level security;

-- Users can register / refresh / remove their own device tokens. The backend
-- sender uses the service-role key, which bypasses RLS to read every token.
create policy "Users can manage own device tokens"
  on public.device_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Notification log (every send attempt)
-- ─────────────────────────────────────────────
create table if not exists public.notification_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  type           text not null,                 -- 'missed_workout' | 'streak_at_risk' | 'free_time_gap' | 'reactivation' | ...
  title          text not null,
  body           text not null,
  data           jsonb,                         -- deep-link payload delivered with the push
  token          text,                          -- the device token we targeted
  status         text not null default 'pending' check (status in ('pending','sent','failed')),
  error          text,                          -- Expo error code/message when status = 'failed'
  expo_ticket_id text,                          -- Expo push ticket id, for receipt lookups
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);

-- Fast lookup for "have we already sent this user this type today?" (de-dup).
create index if not exists notification_log_user_type_idx
  on public.notification_log(user_id, type, created_at desc);

alter table public.notification_log enable row level security;

-- Users may read their own notification history; only the service role writes
-- (no client insert/update policy — sends always go through the backend).
create policy "Users can view own notifications"
  on public.notification_log for select
  using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Scheduling the retention engine (pg_cron + pg_net)
-- ─────────────────────────────────────────────
-- Runs the retention-push Edge Function once an hour. The function itself decides
-- which users are eligible *right now* (local-evening streak nudges, same-day
-- missed-workout reminders, inactivity reactivation, free-time-gap hooks), so an
-- hourly tick is enough granularity without per-user cron rows.
--
-- Requires the pg_cron and pg_net extensions (enable under Database → Extensions),
-- and a Vault secret holding the service-role key. Replace <PROJECT_REF>.
--
--   select cron.schedule(
--     'retention-push-hourly',
--     '0 * * * *',
--     $$
--     select net.http_post(
--       url     := 'https://<PROJECT_REF>.functions.supabase.co/retention-push',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
--       ),
--       body    := '{}'::jsonb
--     );
--     $$
--   );
