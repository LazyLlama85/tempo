-- Tempo — per-user IANA timezone, for real server-side quiet hours
-- (MASTER_FIX_PLAN.md F10 part 4). Populated client-side at profile creation
-- via Intl.DateTimeFormat().resolvedOptions().timeZone (see profile-setup.tsx);
-- nullable so existing accounts fall back to the server's UTC hour until they
-- next update their profile, rather than needing a backfill pass.
alter table public.user_profiles
  add column if not exists timezone text;
