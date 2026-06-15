-- Tempo — injury / restriction awareness
-- Run in your Supabase SQL Editor (after schema.sql).
--
-- Free-text area keywords (e.g. 'knee', 'lower back', 'shoulder') that the Quick
-- Workout engine and plan generator use to avoid loading injured areas. Optional:
-- the app reads it gracefully and behaves exactly as before when empty/absent.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS injuries text[] NOT NULL DEFAULT '{}';
