// Tempo — contextual Quick Workout suggestions.
//
// This is the bridge between Tempo's calendar awareness and the Quick Workout
// engine. It answers, proactively: "given your real day, here's a session that
// fits right now." That's the thing a plain workout generator never does.
//
// Priority order (most time-sensitive first):
//   1. A real free gap in today's calendar      → "You have 18 free minutes…"
//   2. A recently missed workout                → "Missed leg day? 15-min version."
//   3. A few days with no training              → "It's been 4 days. 10-min restart."

import type { SupabaseClient } from '@supabase/supabase-js'
import { findFreeWindows, getCalendarPermissionStatus } from '@/services/calendarService'
import { QUICK_DURATIONS, type QuickMinutes, type QuickPurpose, type MovementPattern } from '@/lib/quickWorkout'
import { toDateStr } from '@/lib/dates'

export interface QuickSuggestion {
  minutes: QuickMinutes
  purpose?: QuickPurpose
  targetPattern?: MovementPattern
  daysSinceTrained?: number
  fromCalendarGap?: boolean
  icon: string
  headline: string
  sub: string
}

// Largest preset duration that fits the available minutes (min 10 for calendar gaps).
function snapMinutes(available: number, floor: QuickMinutes = 10): QuickMinutes {
  let best: QuickMinutes | null = null
  for (const d of QUICK_DURATIONS) {
    if (d <= available && d >= floor) best = d
  }
  return best ?? floor
}

// Map a plan's focus label to the movement pattern it was built around.
function focusToPattern(focus: string): MovementPattern | undefined {
  const f = focus.toLowerCase()
  if (f.includes('lower') || f.includes('leg')) return 'squat'
  if (f.includes('upper')) return 'push'
  if (f.includes('push')) return 'push'
  if (f.includes('pull')) return 'pull'
  return undefined
}

export async function getQuickSuggestion(
  client: SupabaseClient,
  userId: string,
): Promise<QuickSuggestion | null> {
  if (!userId) return null
  try {
    const now = new Date()
    const todayStr = toDateStr(now)

    // ── 1) Free calendar gap today ───────────────────────────────────────────
    if ((await getCalendarPermissionStatus()) === 'granted') {
      const windows = await findFreeWindows(now, 15)
      // The next window that's still ahead of (or currently open) right now AND is
      // bounded by a real event — otherwise "N free minutes before your next event"
      // is a lie on an empty day (the window just ran to 9pm). Empty/open calendars
      // fall through to the missed-workout / restart nudges below instead.
      const upcoming = windows
        .map(w => {
          const ongoing = w.start <= now && now < w.end
          const start = ongoing ? now : w.start
          const minsLeft = Math.round((w.end.getTime() - start.getTime()) / 60000)
          return { start, minsLeft, startsLater: w.start > now, endIsEvent: w.endIsEvent }
        })
        .filter(w => w.endIsEvent && w.minsLeft >= 15 && (w.startsLater || w.minsLeft >= 15))
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0]

      if (upcoming && upcoming.minsLeft >= 15) {
        const minutes = snapMinutes(upcoming.minsLeft)
        return {
          minutes,
          fromCalendarGap: true,
          icon: 'time-outline',
          headline: `${upcoming.minsLeft} min free before your next event`,
          sub: `A ${minutes}-minute session fits right in.`,
        }
      }
    }

    // ── 2) A recently missed workout ─────────────────────────────────────────
    const twoDaysAgo = new Date(now); twoDaysAgo.setDate(now.getDate() - 2)
    const { data: missed } = await client
      .from('scheduled_workouts')
      .select('focus, planned_date')
      .eq('user_id', userId)
      .eq('status', 'missed')
      .gte('planned_date', toDateStr(twoDaysAgo))
      .order('planned_date', { ascending: false })
      .limit(1)

    if (missed && missed.length) {
      const focus = missed[0].focus as string
      const pattern = focusToPattern(focus)
      return {
        minutes: 15,
        purpose: 'recovery',
        targetPattern: pattern,
        icon: 'home-outline',
        headline: 'You missed your workout',
        sub: `No gym needed — try a quick 15-minute version at home.`,
      }
    }

    // ── 3) No training for a few days ────────────────────────────────────────
    const { data: lastDone } = await client
      .from('scheduled_workouts')
      .select('planned_date')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('planned_date', { ascending: false })
      .limit(1)

    if (lastDone && lastDone.length) {
      const last = new Date((lastDone[0].planned_date as string) + 'T00:00:00')
      const days = Math.floor((now.getTime() - last.getTime()) / 86400000)
      if (days >= 3) {
        return {
          minutes: 10,
          purpose: 'recovery',
          daysSinceTrained: days,
          icon: 'flame-outline',
          headline: `It's been ${days} days`,
          sub: `Here's a 10-minute restart — momentum beats perfection.`,
        }
      }
    }

    // No completed workout today and nothing else triggered → gentle default nudge
    // only when there's genuinely nothing scheduled to do.
    const { data: todayWorkouts } = await client
      .from('scheduled_workouts')
      .select('status')
      .eq('user_id', userId)
      .eq('planned_date', todayStr)

    const hasActionableToday = (todayWorkouts ?? []).some(w => w.status === 'scheduled')
    if (!hasActionableToday) {
      return {
        minutes: 15,
        icon: 'flash-outline',
        headline: 'Got a spare 15 minutes?',
        sub: 'Squeeze in a quick session — it all counts.',
      }
    }

    return null
  } catch {
    return null
  }
}
