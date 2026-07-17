-- Tempo — optional cardio finisher (onboarding question, Phase 7c).
--
-- muscle_gain/strength plan templates carry zero cardio by design (pure
-- hypertrophy/strength focus). This lets a user on either of those two goals opt
-- in to an optional cardio finisher slot on generated sessions. fat_loss/
-- athletic/general_fitness already bake in cardio on some days regardless of
-- this flag — see lib/generatePlan.ts's withCardio()/CARDIO_OPT.

alter table public.user_profiles
  add column if not exists include_cardio boolean not null default false;
