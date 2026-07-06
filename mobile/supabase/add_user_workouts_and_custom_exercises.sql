-- Phase A: user-created workouts + custom exercises.  (APPLIED to live project.)
--
-- Lets users build/save/schedule their own workouts and create custom exercises
-- that behave exactly like built-ins (logging, PRs, progress, analytics) because
-- they live in the same `exercises` table.

-- 1) Custom exercises in the exercises table.
alter table public.exercises
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists is_custom boolean not null default false,
  add column if not exists category text,
  add column if not exists notes text,
  add column if not exists tracking_metrics text[] not null default '{}'::text[];

create index if not exists exercises_user_id_idx on public.exercises(user_id);

-- Built-ins (user_id IS NULL) stay public; custom rows are visible only to their owner.
drop policy if exists "Exercises are publicly readable" on public.exercises;
create policy "Read built-in and own exercises" on public.exercises
  for select using (user_id is null or user_id = auth.uid());
create policy "Insert own custom exercises" on public.exercises
  for insert with check (user_id = auth.uid() and is_custom = true);
create policy "Update own custom exercises" on public.exercises
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Delete own custom exercises" on public.exercises
  for delete using (user_id = auth.uid());

-- 2) Set logging can capture duration & distance (cardio / custom metrics).
alter table public.set_logs
  add column if not exists duration_sec integer,
  add column if not exists distance_m numeric;

-- 3) User-created scheduled workouts (source='custom') + a per-workout prescription
--    so the player honors the sets/reps/weight/duration/distance the user chose.
alter table public.scheduled_workouts drop constraint if exists scheduled_workouts_source_check;
alter table public.scheduled_workouts add constraint scheduled_workouts_source_check
  check (source = any (array['plan','quick','smart','custom']));
alter table public.scheduled_workouts
  add column if not exists exercise_config jsonb;

-- 4) Reusable, user-owned workout templates.
create table if not exists public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  exercise_ids uuid[] not null default '{}'::uuid[],
  config jsonb not null default '[]'::jsonb,
  notes text,
  est_duration_min integer not null default 45,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workout_templates_user_id_idx on public.workout_templates(user_id);
alter table public.workout_templates enable row level security;
create policy "Users manage own templates" on public.workout_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
