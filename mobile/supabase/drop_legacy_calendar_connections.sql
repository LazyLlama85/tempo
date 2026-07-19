-- Tempo — drop the legacy calendar_connections table (MASTER_FIX_PLAN.md
-- F10 part 3).
--
-- Its access_token/refresh_token columns were stored plaintext (schema.sql's
-- own comment: "store encrypted in production" — never actually done). Real
-- Google OAuth tokens have long since moved to google_calendar_tokens
-- (service-role-only RLS, per ARCHITECTURE.md). Verified before dropping:
-- zero references anywhere in src/ or supabase/functions/ (grepped, not
-- assumed), and the live table has 0 rows. This was dead weight PLUS a
-- plaintext-secret liability sitting in the schema — not a column to patch,
-- a table to remove outright.

drop table if exists public.calendar_connections;
