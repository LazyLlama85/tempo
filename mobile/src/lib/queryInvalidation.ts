import type { QueryClient } from '@tanstack/react-query'

// Every query key that reflects training state. Invalidated together after any
// mutation that changes what's scheduled or logged (completing / skipping /
// rescheduling a workout, quick workouts, plan regeneration), so no screen can
// keep showing a workout as "upcoming" after it was done. Keys are roots —
// partial matching catches every per-range/per-user instance.
const TRAINING_KEYS = [
  ['scheduled_workouts'],
  ['missed_workouts'],
  ['next_workout'],
  ['block_phase'],
  ['quick_suggestion'],
  ['rest_advice'],
  ['progress_workouts'],
  ['progress_set_logs'],
  ['wrapped_cards'],
  ['goal_projection'],
  // Home/Plan's calendar-derived views — without these, a plan regeneration
  // (onboarding, Change Plan) or a workout being placed at real times
  // (autoScheduleUpcoming) could leave the merged day feed showing a stale
  // (often empty) picture until an unrelated refetch happened to catch up.
  ['range_events'],
  ['plan_cal_workouts'],
  // Plan's "Current Split" card — a genuine gap this key was missing
  // entirely: `train_splits` carries a 5-minute staleTime, so a Change Plan
  // replan (which deactivates the old split and activates the new
  // Tempo-generated one) could leave Plan showing the OLD split for up to 5
  // minutes, or until the app fully restarted — read by a founder as "the
  // plan takes a long time to show up."
  ['train_splits'],
  // §24/§30 L2's free-tier conflict card (findCalendarConflicts) — without
  // this, resolving a conflict manually (or Tempo doing it silently for a
  // Pro user right before this same sweep) could leave a stale card showing
  // for a conflict that no longer exists.
  ['calendar_conflicts'],
  // The Home-hero + Progress + paywall proof number (fetchSchedulingImpact) —
  // without this it sat on a 5-minute staleTime, so completing a workout would
  // not visibly move the ONE number this whole surface exists to make you
  // watch. LAUNCH_SCORE_PLAN.md T1.1.
  ['scheduling_impact'],
] as const

export function invalidateTrainingData(queryClient: QueryClient) {
  for (const key of TRAINING_KEYS) {
    queryClient.invalidateQueries({ queryKey: key })
  }
}
