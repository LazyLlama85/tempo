import type { SupabaseClient } from '@supabase/supabase-js'
import { toDateStr } from '@/lib/dates'

// Marks any committed scheduled_workouts whose planned_date is before today as
// 'missed'. Plan workouts (user_plan_id set) and active-split workouts (source='split')
// are commitments; ad-hoc Quick Workouts / one-off custom sessions (user_plan_id null,
// not from a split) are opportunistic, so leaving one unstarted never reads as missed.
// Returns the number of rows updated. Errors are swallowed — caller gets 0.
//
// Pause mode (lib/pauseMode.ts) already shifts every future row past the pause
// window before this ever runs, so there's structurally nothing in range to mark
// missed during a pause — this guard is belt-and-suspenders (a stale/leftover row
// must never get marked missed just because a sweep happened to run mid-pause).
export async function checkMissedWorkouts(client: SupabaseClient, userId: string): Promise<number> {
  const today = toDateStr(new Date())

  const { data: profile } = await client
    .from('user_profiles')
    .select('paused_until')
    .eq('user_id', userId)
    .maybeSingle()
  const pausedUntil = (profile?.paused_until as string | null) ?? null
  if (pausedUntil && today < pausedUntil) return 0

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
