// Tempo — materialize a split into scheduled workouts.
//
// Activating a split lays its weekly weekday→workout pattern onto the calendar as
// ordinary `scheduled_workouts` rows (source='split'). This is the split analogue of
// generatePlan's insert loop: same row shape, so the feed/runner/auto-scheduler all
// work unchanged. It's idempotent over a rolling horizon — safe to re-run on app
// open to extend the window as days pass.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience, Split, SplitDay, TimeOfDay, WorkoutExerciseConfig } from '@/types'
import { autoScheduleUpcoming, autoSchedulingEnabled } from './autoSchedule'
import { estimateSessionMin } from './durationEstimate'
import { fetchActiveSplit, setActiveSplit, ensureAutoSplit, isAutoSplit } from './splits'
import { generatePlan, type PlanProfile } from './generatePlan'
import { sweepScheduledPlanRows } from './retireWorkouts'

const HORIZON_DAYS = 28

// Varied default start times per time-of-day (mirrors generatePlan) so a fresh split
// doesn't read as the same hour every day. Auto mode refines these around the real
// calendar afterward; manual mode leaves them as the user's chosen window.
const START_TIMES: Record<TimeOfDay, string[]> = {
  morning:   ['07:00:00', '08:00:00', '06:30:00', '07:30:00'],
  afternoon: ['12:30:00', '15:30:00', '13:00:00', '16:00:00'],
  evening:   ['17:30:00', '18:30:00', '19:00:00', '18:00:00'],
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// ISO weekday 1=Mon … 7=Sun.
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

function estimateDurationMin(config: WorkoutExerciseConfig[]): number {
  return estimateSessionMin(config.map((c) => ({
    sets: c.sets,
    workSec: c.metrics?.includes('duration') && c.duration_sec ? c.duration_sec : null,
    restSec: null,
  })))
}

// Insert split workouts for any date in the rolling horizon that doesn't already
// have one. Returns how many were inserted.
export async function materializeSplit(
  client: SupabaseClient,
  userId: string,
  split: Split,
  preferredTimeOfDay: TimeOfDay | null,
): Promise<number> {
  // The auto (program) mirror is a read-only *projection* of the active plan — the
  // plan already owns those sessions as source='plan' rows (and rolls them forward
  // via extendActivePlan). Materializing the mirror would lay down duplicate
  // source='split' sessions on top of every plan day. Never do it; the mirror is only
  // ever "activated" by regenerating the plan (activateAutoPlan), not materialized.
  if (isAutoSplit(split)) return 0

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + HORIZON_DAYS)

  const byWeekday = new Map<number, SplitDay>()
  for (const d of split.days) byWeekday.set(d.weekday, d)
  // Nothing to place if every day is rest/empty.
  const hasWork = split.days.some((d) => !d.rest && (d.exercise_ids?.length ?? 0) > 0)
  if (!hasWork) return 0

  // Dates this split already owns in the horizon → skip (idempotent re-runs).
  // A 'skipped' row (the user removed just that one day) is deliberately NOT
  // "taken" — it reads as open again so this fill naturally re-adds it on the
  // next run, instead of leaving a manually-removed day permanently empty.
  // 'rescheduled' rows (superseded by a plan/split change or a dedupe pass)
  // stay excluded — those really are gone, not just a single skipped day.
  const { data: existing } = await client
    .from('scheduled_workouts')
    .select('planned_date')
    .eq('user_id', userId)
    .eq('split_id', split.id)
    .neq('status', 'skipped')
    .gte('planned_date', toDateStr(today))
    .lte('planned_date', toDateStr(horizonEnd))
  const taken = new Set((existing ?? []).map((r: any) => r.planned_date as string))

  const tod = preferredTimeOfDay ?? 'morning'
  const times = START_TIMES[tod]
  const rows: object[] = []
  let idx = 0
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = new Date(today); date.setDate(today.getDate() + i)
    const dateStr = toDateStr(date)
    if (taken.has(dateStr)) { idx++; continue }
    const day = byWeekday.get(isoWeekday(date))
    if (!day || day.rest || !(day.exercise_ids?.length)) continue
    const config = day.config ?? []
    rows.push({
      user_id: userId,
      user_plan_id: null,
      split_id: split.id,
      planned_date: dateStr,
      planned_start_time: times[idx % times.length],
      planned_duration_min: estimateDurationMin(config),
      focus: day.label || 'Workout',
      status: 'scheduled',
      source: 'split',
      exercise_ids: day.exercise_ids,
      exercise_config: config,
    })
    idx++
  }
  if (!rows.length) return 0

  const { error } = await client.from('scheduled_workouts').insert(rows)
  if (error) throw error
  return rows.length
}

// Activate a split: it becomes the user's schedule. Clears the generated plan's and
// any other split's FUTURE scheduled rows (completed/missed history + ad-hoc Quick
// Workouts are kept), marks the split active, materializes it, and — in auto mode —
// places the new sessions at calendar-aware times.
//
// The old schedule is retired BEFORE the new one is inserted, so a failure between
// the two must not masquerade as "nothing happened": once the split is active,
// materialization failing (gym wifi, mid-chain drop) returns 'activated_pending' —
// the split IS the schedule now, and refreshActiveSplit lays the sessions down on
// the next app open. Callers must tell the user that, not "try again".
export type ActivateSplitResult = 'activated' | 'activated_pending' | 'failed'

export async function activateSplit(
  client: SupabaseClient,
  userId: string,
  split: Split,
  profile: { preferred_time_of_day?: TimeOfDay | null; scheduling_mode?: string } | null,
): Promise<ActivateSplitResult> {
  try {
    // Retire the generated plan so the calendar doesn't show both.
    const { error: abandonErr } = await client
      .from('user_plans')
      .update({ status: 'abandoned' })
      .eq('user_id', userId)
      .eq('status', 'active')
    if (abandonErr) return 'failed'

    // Retire today-forward, not-yet-done plan/split sessions (other sources are
    // user one-offs) via the same FK-safe sweep generatePlan uses — a bulk DELETE
    // dies on any session the user ever started (workout_logs FK), which used to
    // leave the old schedule behind UNDER the new one.
    await sweepScheduledPlanRows(client, userId)

    if (!(await setActiveSplit(client, userId, split.id))) return 'failed'

    // Re-fetch so we materialize the freshly-activated row (is_active true). From
    // here the split is active: a failure below is a scheduling delay, not a
    // failed activation.
    try {
      const active = await fetchActiveSplit(client, userId)
      await materializeSplit(client, userId, active ?? { ...split, is_active: true }, profile?.preferred_time_of_day ?? null)
    } catch {
      return 'activated_pending'
    }

    if (autoSchedulingEnabled(profile)) {
      try { await autoScheduleUpcoming(client, userId) } catch { /* keep default times */ }
    }
    return 'activated'
  } catch {
    return 'failed'
  }
}

// Activate the auto-generated program (the kind='auto' mirror split). Unlike a
// custom split, this REGENERATES the periodized plan from the user's current
// profile — schedule, equipment, injuries — rather than materializing a static
// weekly copy, so the mesocycle/deload logic is preserved. generatePlan clears any
// active plan + splits first, then ensureAutoSplit re-marks the mirror active.
export async function activateAutoPlan(
  client: SupabaseClient,
  userId: string,
  profile: {
    goal?: Goal | null; experience?: Experience | null; equipment?: string[] | null
    days_per_week?: number | null; preferred_duration_min?: number | null
    preferred_time_of_day?: TimeOfDay | null; scheduling_mode?: string
  } | null,
): Promise<boolean> {
  try {
    const planProfile: PlanProfile = {
      goal: (profile?.goal ?? 'general_fitness') as Goal,
      experience: (profile?.experience ?? 'beginner') as Experience,
      equipment: (profile?.equipment ?? []) as string[],
      days_per_week: profile?.days_per_week ?? 3,
      preferred_duration_min: profile?.preferred_duration_min ?? 45,
      preferred_time_of_day: profile?.preferred_time_of_day ?? null,
    }
    await generatePlan(client, userId, planProfile)      // also runs ensureAutoSplit
    await ensureAutoSplit(client, userId, planProfile.goal)
    if (autoSchedulingEnabled(profile)) {
      try { await autoScheduleUpcoming(client, userId) } catch { /* keep default times */ }
    }
    return true
  } catch {
    return false
  }
}

// Roll the horizon forward for the active split, if any. Cheap + idempotent — safe
// to call on app open. Returns inserted count (0 when no active split).
export async function refreshActiveSplit(
  client: SupabaseClient,
  userId: string,
  preferredTimeOfDay: TimeOfDay | null,
): Promise<number> {
  const active = await fetchActiveSplit(client, userId)
  // No active split, or the active "split" is the auto plan mirror (owned by the plan,
  // not materialized here — see materializeSplit): nothing to roll forward.
  if (!active || isAutoSplit(active)) return 0
  return materializeSplit(client, userId, active, preferredTimeOfDay)
}
