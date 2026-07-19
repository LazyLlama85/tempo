-- Tempo — separate "date offset from plan start" from "mesocycle phase index"
-- (MASTER_FIX_PLAN.md F1 — the plan-cliff bug).
--
-- scheduled_workouts.week_index was overloaded to mean two different things:
--   (1) generatePlan.ts/extendActivePlan used it as a pure DATE OFFSET from the
--       owning plan's start_date (date = start_date + week_index*7 + slot-1);
--   (2) periodization.ts/weekProgression uses it as a MESOCYCLE PHASE index
--       (mod BLOCK_WEEKS), which adaptation.ts's applyAdaptationMode re-anchors
--       to the coming week on a recovery/deload transition.
--
-- Re-anchoring is correct for meaning (2) but silently corrupts meaning (1):
-- the next rollover's MAX(week_index) read then computes dates from a
-- re-anchored value with no relationship to start_date, which can land
-- entirely in the past — the past-date guard then skips every generated row,
-- producing an EMPTY schedule for a paying user.
--
-- week_offset is the pure date-offset meaning, written once at insert time and
-- never rewritten by adaptation (week_index remains the mesocycle-phase field
-- only, still rewritten as before). Backfilled by computing it directly from
-- (planned_date - the owning plan's start_date), not by copying week_index —
-- so a row already corrupted by a prior adaptation restamp gets a CORRECT
-- value here instead of carrying that corruption into the new column.
alter table public.scheduled_workouts
  add column if not exists week_offset int;

update public.scheduled_workouts sw
set week_offset = floor((sw.planned_date - up.start_date) / 7.0)::int
from public.user_plans up
where sw.user_plan_id = up.id
  and sw.week_offset is null;
