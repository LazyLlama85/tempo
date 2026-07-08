// Tempo — safely retire scheduled workouts when a plan/split is replaced.
//
// Two hard constraints shape this module:
//   1. `workout_logs.scheduled_workout_id` has NO cascade — a session the user ever
//      started can't be hard-deleted (the FK blocks it, and because a bulk DELETE is
//      one atomic statement, ONE such row silently kept EVERY retired row alive).
//   2. The partial unique index `scheduled_workouts_one_plan_per_day` rejects a new
//      plan's insert whenever a leftover 'scheduled' plan row still holds that date —
//      which surfaced to users as "Something went wrong" on every Change Plan.
//
// So retiring = release external artifacts (calendar event, local reminder), then
// hard-delete the never-started rows and mark the log-referenced ones 'rescheduled'
// (a status every feed/stat surface already hides). Failures THROW so callers stop
// before inserting a replacement schedule on top of rows that never cleared.

import type { SupabaseClient } from '@supabase/supabase-js'
import { removeWorkoutFromCalendar } from '@/services/calendarSync'
import { cancelWorkoutReminder } from '@/lib/notifications'

export interface ReleasableRow {
  id: string
  focus: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  calendar_event_id: string | null
  calendar_provider: 'google' | 'device' | null
}

export const RELEASE_COLS =
  'id, focus, planned_date, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider'

// Clean up a row's external artifacts before it's retired: its synced calendar
// event and its pending local reminder. Best-effort per row — a dead Google token
// must never block replacing a plan.
export async function releaseScheduledRows(
  client: SupabaseClient,
  userId: string,
  rows: ReleasableRow[],
): Promise<void> {
  // Each removal is an independent network/OS round-trip; a 4-week block can hold
  // dozens of synced rows, so running them serially would hold the plan-swap
  // spinner for seconds. Fire them together.
  await Promise.all(rows.map(async (w) => {
    if (w.calendar_event_id) {
      try { await removeWorkoutFromCalendar(client, w, userId) } catch { /* best-effort */ }
    }
    cancelWorkoutReminder(w.id).catch(() => {})
  }))
}

// The one sweep both plan generation and split activation run before laying down a
// new schedule: find every still-'scheduled' plan-linked or split-sourced row from
// TODAY forward, release its calendar event + reminder, and retire it. One shared
// predicate so the two paths can't drift apart (drift is how stranded rows — and the
// "Something went wrong on every Change Plan" poisoning — happened last time).
//
// Only today+ rows: new schedules never insert past-dated sessions (generatePlan and
// materializeSplit both skip them), so an older stranded row can't collide with an
// insert — and a past still-'scheduled' row is exactly what the missed-workout sweep
// needs to see to mark it 'missed'. Retiring it would erase that signal.
export async function sweepScheduledPlanRows(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const { data, error } = await client
    .from('scheduled_workouts')
    .select(RELEASE_COLS)
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .gte('planned_date', todayStr)
    .or('user_plan_id.not.is.null,source.eq.split')
  if (error) throw error
  const rows = (data ?? []) as ReleasableRow[]
  await releaseScheduledRows(client, userId, rows)
  await retireScheduledWorkouts(client, userId, rows.map((r) => r.id))
}

// Remove rows from the schedule so a replacement can be inserted. Rows already
// referenced by a workout_log are marked 'rescheduled' instead of deleted (the FK
// has no cascade); everything else is hard-deleted. Throws on any write failure.
export async function retireScheduledWorkouts(
  client: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<void> {
  if (!ids.length) return

  const { data: logged, error: logErr } = await client
    .from('workout_logs')
    .select('scheduled_workout_id')
    .eq('user_id', userId)
    .in('scheduled_workout_id', ids)
  if (logErr) throw logErr

  const keep = new Set((logged ?? []).map((r: { scheduled_workout_id: string | null }) => r.scheduled_workout_id))
  const deletable = ids.filter((id) => !keep.has(id))
  const markable = ids.filter((id) => keep.has(id))

  if (deletable.length) {
    const { error } = await client
      .from('scheduled_workouts')
      .delete()
      .eq('user_id', userId)
      .in('id', deletable)
    if (error) {
      // A log could land between our check and the delete — fall back to marking,
      // which can't hit the FK and still frees the unique per-day slot.
      const { error: markErr } = await client
        .from('scheduled_workouts')
        .update({ status: 'rescheduled' })
        .eq('user_id', userId)
        .in('id', deletable)
      if (markErr) throw markErr
    }
  }

  if (markable.length) {
    const { error } = await client
      .from('scheduled_workouts')
      .update({ status: 'rescheduled' })
      .eq('user_id', userId)
      .in('id', markable)
    if (error) throw error
  }
}
