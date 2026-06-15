import type { SupabaseClient } from '@supabase/supabase-js'

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// Marks any *plan* scheduled_workouts whose planned_date is before today as
// 'missed'. Ad-hoc Quick Workouts (user_plan_id is null) are intentionally
// excluded — they're opportunistic sessions, not plan commitments, so leaving one
// unstarted should never read as a "missed workout".
// Returns the number of rows updated. Errors are swallowed — caller gets 0.
export async function checkMissedWorkouts(client: SupabaseClient, userId: string): Promise<number> {
  const today = toDateStr(new Date())

  const { data, error } = await client
    .from('scheduled_workouts')
    .update({ status: 'missed' })
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .lt('planned_date', today)
    .not('user_plan_id', 'is', null)
    .select('id')

  if (error) return 0
  return data?.length ?? 0
}
