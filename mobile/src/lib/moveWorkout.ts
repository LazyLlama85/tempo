// Tempo — keep a moved workout's satellites in sync.
//
// Whenever a scheduled workout changes date/time, three things must agree: the
// scheduled_workouts row, the synced calendar event, and the local pre-workout
// reminder. The row update lives with each caller (auto re-slot, missed-workout
// move, manual edit); this helper re-points the other two. Routing every move
// through here is what prevents "the app says 7:30, my calendar still says 6:00,
// and my phone buzzed for a workout that no longer exists".

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CalendarProvider } from '@/types'
import { addWorkoutToCalendar, removeWorkoutFromCalendar } from '@/services/calendarSync'
import { scheduleWorkoutReminders, cancelWorkoutReminder, hasReminderPermission } from '@/lib/notifications'

export interface MovableWorkout {
  id: string
  focus: string
  planned_date: string         // the NEW date
  planned_start_time: string   // the NEW time
  planned_duration_min: number
  calendar_event_id: string | null
  calendar_provider: CalendarProvider | null
}

// Best-effort by design: a calendar/notification hiccup must never undo a move
// that already persisted.
export async function resyncMovedWorkout(
  client: SupabaseClient,
  userId: string,
  workout: MovableWorkout,
): Promise<void> {
  // Calendar: drop the old event, recreate it on the SAME provider at the new time.
  if (workout.calendar_event_id) {
    try {
      await removeWorkoutFromCalendar(client, workout, userId)
      await addWorkoutToCalendar(
        client,
        { ...workout, calendar_event_id: null, calendar_provider: null },
        userId,
        workout.calendar_provider,
      )
    } catch { /* the move itself already stuck */ }
  }

  // Reminder: re-point the 30-min heads-up. Only when permission already exists —
  // a background sync path must never pop the OS permission prompt.
  try {
    await cancelWorkoutReminder(workout.id)
    if (await hasReminderPermission()) {
      await scheduleWorkoutReminders([{ ...workout, status: 'scheduled' }])
    }
  } catch { /* best-effort */ }
}
