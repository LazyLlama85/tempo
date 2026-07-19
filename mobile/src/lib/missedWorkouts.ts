import type { SupabaseClient } from '@supabase/supabase-js'
import { toDateStr } from '@/lib/dates'

// Marks any committed scheduled_workouts whose planned_date is before today as
// 'missed'. Plan workouts (user_plan_id set) and active-split workouts (source='split')
// are commitments; ad-hoc Quick Workouts / one-off custom sessions (user_plan_id null,
// not from a split) are opportunistic, so leaving one unstarted never reads as missed.
// Returns the number of rows updated. Errors are swallowed — caller gets 0.
export async function checkMissedWorkouts(client: SupabaseClient, userId: string): Promise<number> {
  const today = toDateStr(new Date())

  const { data, error } = await client
    .from('scheduled_workouts')
    .update({ status: 'missed' })
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .lt('planned_date', today)
    .or('user_plan_id.not.is.null,source.eq.split')
    .select('id')

  if (error) return 0
  return data?.length ?? 0
}
