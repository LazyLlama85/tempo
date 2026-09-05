// Arclo — one-off repair for sessions scheduled at a time the user cannot make.
//
// Fixing the generators (generatePlan, splitSchedule, smartSchedule) only helps
// plans made from now on. A user who already has a 07:00 session on a day school
// starts at 07:00 keeps it until something happens to move it — and scheduling is
// the product, so a wrong time sitting in someone's week is not cosmetic.
//
// This sweeps upcoming sessions and re-times ONLY the ones that are genuinely
// unmakeable: the session overlaps sleep, work, school or a weekday block, or it
// starts before the user has got out of bed. A session that is merely early, or
// merely not where the scheduler would put it today, is left alone — the user may
// have chosen it, and silently rearranging someone's week is its own bug.
//
// Deliberately narrow, and deliberately idempotent: running it twice changes
// nothing the second time.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  chooseSessionStart, weekdayFreeIntervals, toMinutes, minutesToTime, isoWeekday,
  WAKE_BUFFER_MIN, type AvailabilityInputs,
} from '@/lib/availability'
import { captureApiError } from '@/lib/crashReporting'

/** How far ahead to repair. Matches the plan's own rolling horizon. */
const HORIZON_DAYS = 28

export interface RetimeRow {
  id: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number | null
}

/**
 * Is this session impossible as scheduled? True only when it collides with
 * something the user told us about, or starts before wake + buffer.
 *
 * Pure, so the judgement is unit-tested rather than inferred from behaviour.
 */
export function isUnmakeable(row: RetimeRow, av: AvailabilityInputs): boolean {
  const start = toMinutes(row.planned_start_time)
  if (start == null) return false
  const duration = row.planned_duration_min ?? 45
  const end = start + duration

  // With nothing declared there is nothing to contradict — never move a session
  // on the strength of defaults alone. (The caller guards this too; belt and
  // braces, because this is the function that decides to touch someone's week.)
  const declared = !!av.wake_time || !!av.work_start || !!av.school_start || !!(av.unavailable_blocks ?? []).length
  if (!declared) return false

  const wake = toMinutes(av.wake_time)
  if (wake != null && start < wake + WAKE_BUFFER_MIN) return true

  const free = weekdayFreeIntervals(av, isoWeekday(row.planned_date))
  if (free.length === 0) return false // nothing known about this day: leave it be
  return !free.some(([s, e]) => start >= s && end <= e)
}

/**
 * The candidate times a repair prefers, in order: the session's own hour first.
 * Exported so an out-of-band repair (e.g. fixing rows for users who have not yet
 * received the client update) uses the identical candidate list, rather than a
 * second copy that could drift from this one.
 */
export function candidatesFor(row: RetimeRow): number[] {
  const own = toMinutes(row.planned_start_time)
  const usual = ['07:00', '08:00', '09:00', '12:30', '15:30', '16:00', '17:30', '18:30', '19:00']
    .map(t => toMinutes(t))
    .filter((m): m is number => m != null)
  return own != null ? [own, ...usual] : usual
}

/**
 * Re-time upcoming sessions that the user cannot make. Returns how many moved.
 * Best-effort: a failure to repair one row never blocks the rest, and never
 * throws into a caller that is mid-app-open.
 */
export async function retimeUnmakeableSessions(
  client: SupabaseClient,
  userId: string,
  opts?: { todayStr?: string; horizonDays?: number },
): Promise<number> {
  try {
    const today = opts?.todayStr ?? new Date().toISOString().slice(0, 10)
    const horizon = new Date(`${today}T00:00:00Z`)
    horizon.setUTCDate(horizon.getUTCDate() + (opts?.horizonDays ?? HORIZON_DAYS))
    const horizonStr = horizon.toISOString().slice(0, 10)

    const { data: p } = await client
      .from('user_profiles')
      .select('wake_time, bedtime, work_start, work_end, school_start, school_end, unavailable_blocks')
      .eq('user_id', userId)
      .maybeSingle()
    if (!p) return 0
    const av: AvailabilityInputs = {
      wake_time: (p.wake_time ?? null) as string | null,
      bedtime: (p.bedtime ?? null) as string | null,
      work_start: (p.work_start ?? null) as string | null,
      work_end: (p.work_end ?? null) as string | null,
      school_start: (p.school_start ?? null) as string | null,
      school_end: (p.school_end ?? null) as string | null,
      unavailable_blocks: (p.unavailable_blocks ?? []) as AvailabilityInputs['unavailable_blocks'],
    }
    // Nothing declared means nothing to check against — do not invent moves.
    if (!av.wake_time && !av.work_start && !av.school_start && !(av.unavailable_blocks ?? []).length) return 0

    const { data: rows } = await client
      .from('scheduled_workouts')
      .select('id, planned_date, planned_start_time, planned_duration_min')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('planned_date', today)
      .lte('planned_date', horizonStr)
    if (!rows?.length) return 0

    let moved = 0
    for (const r of rows as RetimeRow[]) {
      if (!isUnmakeable(r, av)) continue
      const next = chooseSessionStart({
        candidates: candidatesFor(r),
        weekday: isoWeekday(r.planned_date),
        durationMin: r.planned_duration_min ?? 45,
        av,
      })
      // No window at all on that day: leave the session where it is rather than
      // deleting it or parking it somewhere arbitrary. The user can move it.
      if (next == null) continue
      const newTime = minutesToTime(next)
      if (newTime === r.planned_start_time) continue

      const { error } = await client
        .from('scheduled_workouts')
        .update({ planned_start_time: newTime })
        .eq('id', r.id)
        .eq('user_id', userId)
      if (!error) moved++
    }
    return moved
  } catch (e) {
    captureApiError('retimeUnmakeableSessions', e)
    return 0
  }
}
