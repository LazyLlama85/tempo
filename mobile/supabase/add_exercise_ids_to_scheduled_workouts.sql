-- Migration: add exercise_ids to scheduled_workouts
-- Run FIRST in Supabase SQL Editor before seeds.

ALTER TABLE public.scheduled_workouts
  ADD COLUMN IF NOT EXISTS exercise_ids uuid[] NOT NULL DEFAULT '{}';
