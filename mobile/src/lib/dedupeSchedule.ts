import type { SupabaseClient } from '@supabase/supabase-js'

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

interface Row {
  id: string
  planned_date: string
  status: string
  user_plan_id: string | null
  calendar_event_id: string | null
  created_at: string | null
}

// Collapses duplicate *plan* workouts so a day never holds more than one — this
// repairs the "4 workouts on Friday at 7:00" state caused by older builds that
// regenerated the plan without clearing the previous block.
//
// Only future, still-scheduled, plan-owned sessions are considered. Completed
// history and ad-hoc Quick Workouts (user_plan_id is null) are never touched.
// When several share a day we keep the most "real" one: a session already synced
// to the device calendar wins, otherwise the earliest-created.
//
// Extras are MARKED 'rescheduled' (not deleted): some may already be referenced
// by workout_logs, whose foreign key has no cascade, so a delete would fail. The
// UI hides 'rescheduled' rows. Returns the number of duplicates collapsed.
export async function dedupeScheduledWorkouts(client: SupabaseClient, userId: string): Promise<number> {
  const today = toDateStr(new Date())

  const { data, error } = await client
    .from('scheduled_workouts')
    .select('id, planned_date, status, user_plan_id, calendar_event_id, created_at')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('planned_date', today)
    .not('user_plan_id', 'is', null)

  if (error || !data?.length) return 0

  const byDate: Record<string, Row[]> = {}
  for (const w of data as Row[]) {
    ;(byDate[w.planned_date] ??= []).push(w)
  }

  const toCollapse: string[] = []
  for (const date of Object.keys(byDate)) {
    const list = byDate[date]
    if (list.length <= 1) continue
    list.sort((a, b) => {
      const aCal = a.calendar_event_id ? 0 : 1
      const bCal = b.calendar_event_id ? 0 : 1
      if (aCal !== bCal) return aCal - bCal
      return (a.created_at ?? '').localeCompare(b.created_at ?? '')
    })
    for (const extra of list.slice(1)) toCollapse.push(extra.id)
  }

  if (!toCollapse.length) return 0

  const { error: updErr } = await client
    .from('scheduled_workouts')
    .update({ status: 'rescheduled' })
    .in('id', toCollapse)
    .eq('user_id', userId)

  if (updErr) return 0
  return toCollapse.length
}
