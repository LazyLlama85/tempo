import * as Notifications from 'expo-notifications'
import { getPreWorkoutEnabled } from '@/lib/notificationPrefs'

// Handle notifications while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export interface ScheduledWorkout {
  id: string
  focus: string
  planned_date: string         // 'YYYY-MM-DD'
  planned_start_time: string   // 'HH:MM:SS'
  planned_duration_min: number
  status: string
}

export async function requestPermissions(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

// True when permission is already granted — for background/sync paths that must
// never surface the OS prompt themselves (prompting is an onboarding moment).
export async function hasReminderPermission(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).status === 'granted'
  } catch {
    return false
  }
}

export async function scheduleWorkoutReminders(workouts: ScheduledWorkout[]): Promise<void> {
  // Respect the per-device "Pre-workout reminder" setting (audit §6.1). Default on,
  // so this is a no-op change unless the user has explicitly turned it off. Gating
  // at this single choke point means every caller (Home sync, builder, edit, move)
  // honors the preference without each having to check it. The rest-timer alert is
  // a separate function and is unaffected.
  if (!getPreWorkoutEnabled()) return

  const now = Date.now()

  for (const workout of workouts) {
    if (workout.status !== 'scheduled') continue

    const [y, mo, d] = workout.planned_date.split('-').map(Number)
    const [h, mi] = workout.planned_start_time.split(':').map(Number)
    // Date constructor handles negative minutes (e.g. mi - 30 with mi < 30 rolls back the hour)
    const notifTime = new Date(y, mo - 1, d, h, mi - 30, 0, 0)

    if (notifTime.getTime() <= now) continue  // trigger already in the past — skip

    await Notifications.scheduleNotificationAsync({
      identifier: workout.id,
      content: {
        title: `${workout.focus} starts in 30 min`,
        body: `Your ${workout.planned_duration_min}-min session is coming up. Tap when you're ready to go.`,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: notifTime,
      },
    })
  }
}

export async function cancelWorkoutReminder(workoutId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(workoutId)
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync()
}

// ── Rest timer ────────────────────────────────────────────────────────────────
// People rest with the phone locked; a JS timer stops the moment the app
// suspends. The OS notification is what actually taps them on the shoulder.

const REST_NOTIF_ID = 'tempo-rest-timer'

export async function scheduleRestDoneNotification(seconds: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REST_NOTIF_ID).catch(() => {})
  if (!(await hasReminderPermission())) return
  await Notifications.scheduleNotificationAsync({
    identifier: REST_NOTIF_ID,
    content: {
      title: 'Rest complete',
      body: 'Time for your next set.',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + seconds * 1000),
    },
  })
}

export async function cancelRestDoneNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REST_NOTIF_ID).catch(() => {})
}
