-- Tempo — app_config: tiny key/value store for remote flags (audit §10).
--
-- Powers the Tempo Pro "dormant launch": Pro ships code-complete but inert, gated
-- by the `pro_enabled` row read on app open (lib/proConfig). Flip Pro on for
-- everyone with a single UPDATE — no new build, no store resubmission.
--
--   value shape:  { "enabled": <bool>, "test_user_ids": ["<uuid>", ...] }
--     enabled       — turn Pro on for ALL users.
--     test_user_ids — turn it on for just these accounts (private paywall testing)
--                     while it stays off for everyone else.

create table if not exists app_config (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Seed the flag DISABLED so the public v1 launches free-only.
insert into app_config (key, value)
values ('pro_enabled', '{"enabled": false, "test_user_ids": []}'::jsonb)
on conflict (key) do nothing;

-- Read-only to clients (the flag is public, non-sensitive); writes go through the
-- SQL editor / service role only. RLS on, with a permissive SELECT policy.
alter table app_config enable row level security;

drop policy if exists app_config_read on app_config;
create policy app_config_read on app_config
  for select
  using (true);

-- ── To turn Pro on later ────────────────────────────────────────────────────────
-- Everyone:
--   update app_config set value = jsonb_set(value, '{enabled}', 'true'), updated_at = now()
--   where key = 'pro_enabled';
-- Just your own account (private testing):
--   update app_config
--     set value = jsonb_set(value, '{test_user_ids}', '["YOUR-USER-UUID"]'::jsonb), updated_at = now()
--   where key = 'pro_enabled';
