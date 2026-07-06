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
] as const

export function invalidateTrainingData(queryClient: QueryClient) {
  for (const key of TRAINING_KEYS) {
    queryClient.invalidateQueries({ queryKey: key })
  }
}
