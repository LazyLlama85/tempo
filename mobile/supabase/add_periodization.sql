-- Tempo — periodization on plan workouts.
--
-- Each plan-generated scheduled_workout now records which week of the mesocycle
-- it belongs to and that week's progression directive (volume / intensity /
-- deload). Written at plan generation (see mobile/src/lib/generatePlan.ts) and
-- re-stamped by the adaptation engine (mobile/src/lib/adaptation.ts) whenever the
-- plan's adaptation_mode changes in response to real signals (missed sessions,
-- repeated "too hard" feedback).
--
-- `progression` shape (see mobile/src/lib/periodization.ts → WeekProgression):
--   { weekIndex, phase, intensityPct, setsDelta, repBias, isDeload, label, note }
alter table public.scheduled_workouts
  add column if not exists week_index int not null default 0,
  add column if not exists progression jsonb;
