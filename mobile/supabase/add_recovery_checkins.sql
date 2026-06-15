-- Tempo — Recovery check-ins
-- Run this in your Supabase SQL Editor (after schema.sql).
-- Powers the daily readiness score that trims workout volume on rough days.

create table if not exists public.recovery_checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  sleep      int  not null check (sleep between 1 and 5),   -- higher = better
  energy     int  not null check (energy between 1 and 5),  -- higher = better
  soreness   int  not null check (soreness between 1 and 5),-- higher = worse
  stress     int  not null check (stress between 1 and 5),  -- higher = worse
  readiness  int  not null check (readiness between 0 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.recovery_checkins enable row level security;

create policy "Users can manage own recovery checkins"
  on public.recovery_checkins for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
