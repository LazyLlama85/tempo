-- Phase B: the Program / Split layer.
--
-- A "split" is the user's overall weekly training schedule (Push Pull Legs, Upper
-- Lower, a custom split, …): a 7-day weekday→workout pattern they author and own.
-- One split is active at a time; activating it materializes ordinary
-- `scheduled_workouts` rows (source='split') so the calendar feed, the workout
-- runner, auto-scheduling, calendar sync and the missed sweep all work unchanged.

-- 1) The splits table. `days` holds the weekly pattern (see lib/splits.ts):
--    [{ weekday: 1..7, label, rest, template_id, exercise_ids, config }, …]
--    config is snapshotted at save time so a split keeps working even if the
--    source template is later edited or deleted.
create table if not exists public.splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_active boolean not null default false,
  days jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists splits_user_id_idx on public.splits(user_id);
-- At most one active split per user.
create unique index if not exists splits_one_active_per_user
  on public.splits(user_id) where is_active;

alter table public.splits enable row level security;
create policy "Users manage own splits" on public.splits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) scheduled_workouts can come from a split. Extend the source check + link back
--    to the split so re-materialization can clean up its own future rows.
alter table public.scheduled_workouts drop constraint if exists scheduled_workouts_source_check;
alter table public.scheduled_workouts add constraint scheduled_workouts_source_check
  check (source = any (array['plan','quick','smart','custom','split']));
alter table public.scheduled_workouts
  add column if not exists split_id uuid references public.splits(id) on delete set null;
create index if not exists scheduled_workouts_split_id_idx on public.scheduled_workouts(split_id);
