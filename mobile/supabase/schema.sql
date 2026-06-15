-- Tempo — Supabase Database Schema
-- Run this in your Supabase SQL editor: https://supabase.com/dashboard → SQL Editor

-- ─────────────────────────────────────────────
-- User profiles
-- ─────────────────────────────────────────────
create table public.user_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_url    text,
  goal          text not null check (goal in ('muscle_gain','fat_loss','strength','general_fitness','athletic')),
  experience    text not null check (experience in ('beginner','intermediate','advanced')),
  equipment     text[] not null default '{}',
  days_per_week int  not null check (days_per_week between 2 and 5),
  preferred_duration_min int not null default 45,
  bodyweight_lbs numeric,
  onboarding_complete boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Users can only read/write their own profile
alter table public.user_profiles enable row level security;

create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Calendar connections
-- ─────────────────────────────────────────────
create table public.calendar_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('google','apple')),
  access_token  text,  -- store encrypted in production
  refresh_token text,  -- store encrypted in production
  calendar_id   text,
  sync_enabled  boolean not null default true,
  last_synced_at timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.calendar_connections enable row level security;

create policy "Users can manage own calendar connections"
  on public.calendar_connections for all
  using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Exercise library (public read, admin write)
-- ─────────────────────────────────────────────
create table public.exercises (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  movement_pattern   text not null check (movement_pattern in ('push','pull','hinge','squat','carry','core','cardio')),
  primary_muscles    text[] not null default '{}',
  secondary_muscles  text[] not null default '{}',
  required_equipment text[] not null default '{}',
  experience_level   text not null check (experience_level in ('beginner','intermediate','advanced')),
  video_url          text,
  instructions       text[] not null default '{}',
  substitute_ids     uuid[] not null default '{}',
  created_at         timestamptz not null default now()
);

alter table public.exercises enable row level security;

create policy "Exercises are publicly readable"
  on public.exercises for select
  using (true);


-- ─────────────────────────────────────────────
-- Workout programs (templates)
-- ─────────────────────────────────────────────
create table public.programs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  goals          text[] not null default '{}',
  experience_level text not null check (experience_level in ('beginner','intermediate','advanced')),
  days_per_week  int not null,
  duration_weeks int not null default 4,
  created_at     timestamptz not null default now()
);

alter table public.programs enable row level security;
create policy "Programs are publicly readable" on public.programs for select using (true);


-- ─────────────────────────────────────────────
-- User's active plan
-- ─────────────────────────────────────────────
create table public.user_plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  program_id      uuid references public.programs(id),
  start_date      date not null,
  end_date        date,
  current_week    int not null default 1,
  status          text not null default 'active' check (status in ('active','paused','completed','abandoned')),
  adaptation_mode text not null default 'normal' check (adaptation_mode in ('normal','deload','recovery','maintenance')),
  created_at      timestamptz not null default now()
);

alter table public.user_plans enable row level security;
create policy "Users can manage own plans" on public.user_plans for all using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Scheduled workouts
-- ─────────────────────────────────────────────
create table public.scheduled_workouts (
  id                   uuid primary key default gen_random_uuid(),
  user_plan_id         uuid references public.user_plans(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  planned_date         date not null,
  planned_start_time   time not null,
  planned_duration_min int not null default 45,
  focus                text not null,
  calendar_event_id    text,
  status               text not null default 'scheduled'
    check (status in ('scheduled','completed','missed','skipped','rescheduled')),
  completed_at         timestamptz,
  created_at           timestamptz not null default now()
);

alter table public.scheduled_workouts enable row level security;
create policy "Users can manage own scheduled workouts"
  on public.scheduled_workouts for all using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Workout logs
-- ─────────────────────────────────────────────
create table public.workout_logs (
  id                    uuid primary key default gen_random_uuid(),
  scheduled_workout_id  uuid references public.scheduled_workouts(id),
  user_id               uuid not null references auth.users(id) on delete cascade,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  notes                 text,
  feeling_score         int check (feeling_score between 1 and 5),
  created_at            timestamptz not null default now()
);

alter table public.workout_logs enable row level security;
create policy "Users can manage own workout logs" on public.workout_logs for all using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Set logs (the actual lifts)
-- ─────────────────────────────────────────────
create table public.set_logs (
  id               uuid primary key default gen_random_uuid(),
  workout_log_id   uuid not null references public.workout_logs(id) on delete cascade,
  exercise_id      uuid not null references public.exercises(id),
  set_number       int not null,
  reps_completed   int not null,
  weight_lbs       numeric,
  rpe              numeric check (rpe between 1 and 10),
  completed_at     timestamptz not null default now()
);

alter table public.set_logs enable row level security;
create policy "Users can manage own set logs"
  on public.set_logs for all
  using (
    exists (
      select 1 from public.workout_logs w
      where w.id = set_logs.workout_log_id
        and w.user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────
-- Adaptation event log (audit trail)
-- ─────────────────────────────────────────────
create table public.adaptation_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  trigger        text not null,
  trigger_details jsonb,
  action_taken   text not null,
  created_at     timestamptz not null default now()
);

alter table public.adaptation_events enable row level security;
create policy "Users can view own adaptation events"
  on public.adaptation_events for all using (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- Waitlist (for landing page)
-- ─────────────────────────────────────────────
create table public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  joined_at  timestamptz not null default now()
);

-- Waitlist is insert-only from public (no auth required)
alter table public.waitlist enable row level security;
create policy "Anyone can join the waitlist"
  on public.waitlist for insert
  with check (true);
