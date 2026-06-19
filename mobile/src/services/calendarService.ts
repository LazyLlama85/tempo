import * as Calendar from 'expo-calendar/legacy'
import { Platform } from 'react-native'

export interface WorkoutEventInput {
  id: string
  focus: string
  planned_date: string          // 'YYYY-MM-DD'
  planned_start_time: string    // 'HH:MM:SS'
  planned_duration_min: number
}

async function getWritableCalendar(): Promise<string | null> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
  const writable = calendars.filter(c => c.allowsModifications)
  if (!writable.length) return null
  if (Platform.OS === 'ios') {
    const local = writable.find(c => c.source?.type === Calendar.SourceType.LOCAL)
    return (local ?? writable[0]).id
  }
  return writable[0].id
}

export async function requestCalendarPermissions(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync()
  return status === 'granted'
}

export async function getCalendarPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Calendar.getCalendarPermissionsAsync()
  return status as 'granted' | 'denied' | 'undetermined'
}

// Create a workout event on the DEVICE calendar and return its id (no DB write —
// the unified calendarSync layer owns persisting calendar_event_id/provider).
// Returns null if calendar permission isn't granted or there's no writable calendar.
export async function createDeviceEvent(
  workout: WorkoutEventInput
): Promise<string | null> {
  const granted = await requestCalendarPermissions()
  if (!granted) return null

  const calendarId = await getWritableCalendar()
  if (!calendarId) return null

  const [y, m, d] = workout.planned_date.split('-').map(Number)
  const [hStr, mStr] = workout.planned_start_time.split(':')
  const startDate = new Date(y, m - 1, d, parseInt(hStr, 10), parseInt(mStr, 10))
  const endDate = new Date(startDate.getTime() + workout.planned_duration_min * 60 * 1000)

  return Calendar.createEventAsync(calendarId, {
    title: `Tempo: ${workout.focus}`,
    startDate,
    endDate,
    notes: `${workout.planned_duration_min} min workout · Tracked in Tempo`,
    alarms: [{ relativeOffset: -15 }],
  })
}

// ── Reading the calendar (schedule around real life) ──────────────────────────

export interface BusyBlock { start: Date; end: Date }
export interface FreeWindow { start: Date; end: Date; durationMin: number }

// All timed events on a given day, sorted by start. Returns [] without permission.
export async function getBusyBlocks(date: Date): Promise<BusyBlock[]> {
  const status = await getCalendarPermissionStatus()
  if (status !== 'granted') return []

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
  const ids = calendars.map(c => c.id)
  if (!ids.length) return []

  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999)

  const events = await Calendar.getEventsAsync(ids, dayStart, dayEnd)
  return events
    .filter(e => !e.allDay)
    .map(e => ({ start: new Date(e.startDate as string | number | Date), end: new Date(e.endDate as string | number | Date) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

// Open gaps on a day that are at least `neededMin` long, within waking hours.
export async function findFreeWindows(
  date: Date,
  neededMin: number,
  dayStartHour = 6,
  dayEndHour = 21,
): Promise<FreeWindow[]> {
  const busy = await getBusyBlocks(date)
  const windows: FreeWindow[] = []

  const cursor = new Date(date); cursor.setHours(dayStartHour, 0, 0, 0)
  const dayEnd = new Date(date); dayEnd.setHours(dayEndHour, 0, 0, 0)

  for (const block of busy) {
    if (block.end <= cursor) continue
    if (block.start > cursor) {
      const gapMin = (block.start.getTime() - cursor.getTime()) / 60000
      if (gapMin >= neededMin) {
        windows.push({ start: new Date(cursor), end: new Date(block.start), durationMin: Math.round(gapMin) })
      }
    }
    if (block.end > cursor) cursor.setTime(block.end.getTime())
  }

  if (cursor < dayEnd) {
    const gapMin = (dayEnd.getTime() - cursor.getTime()) / 60000
    if (gapMin >= neededMin) {
      windows.push({ start: new Date(cursor), end: new Date(dayEnd), durationMin: Math.round(gapMin) })
    }
  }

  return windows
}

export interface DayEvent { id: string; title: string; start: Date; end: Date }

// Timed events on a given day, WITH titles, for display on the home timeline.
// Tempo's own synced workouts (titled "Tempo …") are filtered out — those are
// rendered from scheduled_workouts, so we don't want them showing twice.
// Returns [] without calendar permission.
export async function getDayEvents(date: Date): Promise<DayEvent[]> {
  const status = await getCalendarPermissionStatus()
  if (status !== 'granted') return []

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
  const ids = calendars.map(c => c.id)
  if (!ids.length) return []

  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999)

  const events = await Calendar.getEventsAsync(ids, dayStart, dayEnd)
  return events
    .filter(e => !e.allDay && !(e.title ?? '').startsWith('Tempo'))
    .map(e => ({
      id: e.id,
      title: e.title || 'Busy',
      start: new Date(e.startDate as string | number | Date),
      end: new Date(e.endDate as string | number | Date),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

// Timed events across a date range [start 00:00 … end 23:59], WITH titles, for
// the unified home feed (a whole week in one query). Same filtering as
// getDayEvents — all-day blocks and Tempo's own synced workouts are excluded.
// Returns [] without calendar permission.
export async function getRangeEvents(start: Date, end: Date): Promise<DayEvent[]> {
  const status = await getCalendarPermissionStatus()
  if (status !== 'granted') return []

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
  const ids = calendars.map(c => c.id)
  if (!ids.length) return []

  const rangeStart = new Date(start); rangeStart.setHours(0, 0, 0, 0)
  const rangeEnd = new Date(end); rangeEnd.setHours(23, 59, 59, 999)

  const events = await Calendar.getEventsAsync(ids, rangeStart, rangeEnd)
  return events
    .filter(e => !e.allDay && !(e.title ?? '').startsWith('Tempo'))
    .map(e => ({
      id: e.id,
      title: e.title || 'Busy',
      start: new Date(e.startDate as string | number | Date),
      end: new Date(e.endDate as string | number | Date),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

// Delete a DEVICE-calendar event by id (no DB write — calendarSync clears the
// pointer). A missing/already-deleted event is treated as success.
export async function deleteDeviceEvent(eventId: string): Promise<void> {
  try {
    await Calendar.deleteEventAsync(eventId)
  } catch {
    // Event may have been manually deleted from the calendar already
  }
}
