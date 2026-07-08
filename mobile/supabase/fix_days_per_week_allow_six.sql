-- The app has offered 2–6 training days/week since the constraint-aware
-- generatePlan work (weekend-only + 6-day support), but user_profiles still
-- capped days_per_week at 5 — so picking 6 made every onboarding/Change Plan
-- profile save fail with "Something went wrong". Widen the check to match the UI.
alter table public.user_profiles
  drop constraint user_profiles_days_per_week_check;
alter table public.user_profiles
  add constraint user_profiles_days_per_week_check
  check (days_per_week between 2 and 6);
