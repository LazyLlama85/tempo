-- Tempo — saved exercise swaps.
-- When a user swaps an exercise (e.g. the machine's taken, or they prefer an
-- alternative), we remember it and auto-apply it to future workouts.
-- Run in your Supabase SQL editor.

create table if not exists public.exercise_substitutions (
  user_id                uuid not null references auth.users(id) on delete cascade,
  original_exercise_id   uuid not null references public.exercises(id) on delete cascade,
  substitute_exercise_id uuid not null references public.exercises(id) on delete cascade,
  created_at             timestamptz not null default now(),
  primary key (user_id, original_exercise_id)
);

alter table public.exercise_substitutions enable row level security;

create policy "Users manage own substitutions"
  on public.exercise_substitutions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
