-- Tempo — ensure set_logs.rpe exists (adaptive progression needs it).
-- schema.sql already defines this column; run this only if your live database
-- was created from an older schema. Safe to run repeatedly.

alter table public.set_logs
  add column if not exists rpe numeric check (rpe between 1 and 10);
