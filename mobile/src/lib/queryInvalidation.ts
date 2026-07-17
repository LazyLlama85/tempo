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
] as const

export function invalidateTrainingData(queryClient: QueryClient) {
  for (const key of TRAINING_KEYS) {
    queryClient.invalidateQueries({ queryKey: key })
  }
}
