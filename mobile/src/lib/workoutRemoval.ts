// Arclo — getting rid of a workout, with the right meaning for what it is.
//
// Until now every "remove this" path in the app did exactly one thing: set
// `status = 'skipped'`. Home's "Skip it" did it, and EditWorkoutSheet's "Remove"
// did the same thing under a different word. That is wrong for one whole class of
// workout, and the founder named it (2026-09-04): a Quick Workout is a one-off
// you invented five seconds ago, so "skipped" records a failure that never
// happened, and leaves a ghost row in your history forever. There were 10 such
// rows in production, and `useProgressStats` already carried a special case to
// filter `source === 'quick' && skipped` back out again — a workaround for this
// exact modelling gap.
//
// So there are two genuinely different outcomes, and which one you get depends on
// what the workout IS:
//
//   • A PLAN or SPLIT session is one occurrence of a recurring programme. Not
//     doing it is a real event worth recording, and next week's session is a
//     separate row that is unaffected. → skip, and keep the record.
//
//   • A QUICK or CUSTOM session is a one-off the user created themselves. It
//     recurs never. Deleting it is what "get rid of this" actually means, and it
//     should leave nothing behind. → delete for real.
//
// Deliberately NOT offered: "delete forever" on a plan session. Plan rows are
// generated per-date, so deleting one occurrence would not stop next week's from
// appearing, and a button that claims otherwise would be lying. Changing what the
// plan schedules is a plan-level edit, not a per-row one.

import type { SupabaseClient } from '@supabase/supabase-js'
import { removeWorkoutFromCalendar } from '@/services/calendarSync'
import { cancelWorkoutReminder } from '@/lib/notifications'

/** What removing this workout should mean. */
export type RemovalMode = 'skip' | 'delete'
/** What removal actually did — not always what was asked for; see applyRemoval. */
export type RemovalOutcome = 'skipped' | 'deleted'

/**
 * Sources the user creates ad hoc, one session at a time. These never recur, so
 * there is no future occurrence for a "skip" to be meaningful against.
 */
const ONE_OFF_SOURCES = new Set(['quick', 'custom'])

export function isOneOff(source: string | null | undefined): boolean {
  return ONE_OFF_SOURCES.has(source ?? '')
}

/**
 * The right removal for this workout. A one-off is deleted; anything belonging to
 * a recurring programme (plan, split, or an unknown/legacy source) is skipped,
 * because skipping is the conservative option — it keeps the row and can be
 * reasoned about later, where a delete cannot be undone.
 */
export function removalModeFor(source: string | null | undefined): RemovalMode {
  return isOneOff(source) ? 'delete' : 'skip'
}

export interface RemovalCopy {
  title: string
  subtitle: string
  /** Label for the destructive option. */
  actionLabel: string
  icon: string
}

/** Copy for the confirmation, so Home and the edit sheet cannot drift apart. */
export function removalCopy(mode: RemovalMode, focus: string): RemovalCopy {
  const name = focus.trim() || 'this workout'
  return mode === 'delete'
    ? {
        title: `Delete ${name}?`,
        subtitle: "You made this one yourself, so it won't come back. Deleting removes it completely and it won't count as a missed session.",
        actionLabel: 'Delete it',
        icon: 'trash-outline',
      }
    : {
        title: `Skip ${name}?`,
        subtitle: "It'll be marked skipped and drop off your day. Next week's session isn't affected. Rescheduling keeps your week on track instead.",
        actionLabel: 'Skip it',
        icon: 'close-circle-outline',
      }
}

export interface RemovableWorkout {
  id: string
  focus?: string
  status?: string | null
  source?: string | null
  calendar_event_id?: string | null
  calendar_provider?: 'device' | 'google' | null
}

/** Postgres foreign-key violation — a workout_log still points at this row. */
const FK_VIOLATION = '23503'

/**
 * Apply the removal. Returns what actually happened.
 *
 * A hard delete can legitimately fail: `workout_logs.scheduled_workout_id` is
 * ON DELETE NO ACTION, so a session the user already started (and whose logged
 * sets we must not destroy) cannot be deleted. Rather than fail in the user's
 * face, that falls back to a skip — the row survives, the logged work survives,
 * and the caller is told which outcome it got so it can say so.
 *
 * Calendar event and pre-workout reminder are cleaned up either way, best-effort:
 * a calendar hiccup must never block the removal itself.
 */
export async function applyRemoval(
  client: SupabaseClient,
  userId: string,
  workout: RemovableWorkout,
  mode: RemovalMode,
): Promise<RemovalOutcome> {
  if (workout.calendar_event_id) {
    await removeWorkoutFromCalendar(client, workout as never, userId).catch(() => {})
  }
  cancelWorkoutReminder(workout.id).catch(() => {})

  if (mode === 'delete') {
    const { error } = await client
      .from('scheduled_workouts')
      .delete()
      .eq('id', workout.id)
      .eq('user_id', userId)
    if (!error) return 'deleted'
    if (error.code !== FK_VIOLATION) throw error
    // Started session: fall through to a skip so the logged sets survive.
  }

  const { error } = await client
    .from('scheduled_workouts')
    .update({ status: 'skipped' })
    .eq('id', workout.id)
    .eq('user_id', userId)
  if (error) throw error
  return 'skipped'
}
