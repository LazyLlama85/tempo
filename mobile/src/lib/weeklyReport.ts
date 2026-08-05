// Tempo — Weekly Progress Report.
//
// Answers the one question a training app must answer: "am I actually improving?"
// Aggregates the week's real data into a small, shareable scorecard — workouts,
// volume vs last week, estimated strength gains, weight trend, consistency — all
// from data we already store. Reused by the Sunday report screen, the workout
// celebration ("momentum"), and the goal countdown.

import type { SupabaseClient } from '@supabase/supabase-js'
import { estimate1RM } from '@/lib/progression'
import { fetchMeasurements, computeWeightTrend } from '@/lib/bodyMeasurements'
import { toDateStr } from '@/lib/dates'

export interface StrengthGain { name: string; deltaLbs: number }

export interface WeeklyReport {
  weekStart: string            // Monday 'YYYY-MM-DD'
  workouts: number             // completed this week
  prevWorkouts: number
  missed: number               // scheduled-but-missed this week
  minutes: number
  volumeLbs: number
  prevVolumeLbs: number
  volumeDeltaPct: number | null   // % change vs last week (null when last week had none)
  strongerExercises: number       // # lifts whose estimated 1RM beat their prior best this week
  strengthGains: StrengthGain[]    // top few, largest gain first
  weightPerWeek: number | null     // lb/week from the body-weight trend
  consistencyPct: number           // completed / (completed+missed) scheduled this week
  newPRs: number                   // weight PRs set this week
}

function mondayOf(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0)
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}

interface LogRow { id: string; started_at: string | null; completed_at: string | null }
interface SetRow { workout_log_id: string; exercise_id: string; weight_lbs: number | null; reps_completed: number; completed_at: string | null }

/**
 * Build a week's report. `weekOffset` picks WHICH week, in whole weeks back from
 * the current one: 0 (default) is the current, still-in-progress week — what
 * workout-complete.tsx's "momentum" celebration wants ("you've trained 3 days
 * THIS week"). 1 is the last FULLY COMPLETED week (last Monday-Sunday) — what
 * the dedicated Weekly Report screen wants, so opening it on, say, a Tuesday
 * shows last week's finished recap instead of this week's still-tiny numbers.
 * Every date range below is bounded on BOTH ends, so weekOffset=0's upper bound
 * (next Monday) is always in the future and never excludes anything real — the
 * same bounding logic serves both cases with no special-casing.
 *
 * Returns null only on hard failure; an empty week still returns a (zeroed)
 * report so the UI can show "nothing logged".
 */
export async function computeWeeklyReport(client: SupabaseClient, userId: string, weekOffset: 0 | 1 = 0): Promise<WeeklyReport | null> {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const currentWeekStart = mondayOf(today)
    const weekStart = new Date(currentWeekStart); weekStart.setDate(weekStart.getDate() - weekOffset * 7)
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7) // exclusive upper bound
    const prevStart = new Date(weekStart); prevStart.setDate(prevStart.getDate() - 7)
    const weekStartIso = weekStart.toISOString()
    const weekEndIso = weekEnd.toISOString()
    const prevStartIso = prevStart.toISOString()
    const weekStartStr = toDateStr(weekStart)
    const weekEndStr = toDateStr(weekEnd)
    const prevStartStr = toDateStr(prevStart)

    const [{ data: workouts }, { data: logs }] = await Promise.all([
      client.from('scheduled_workouts').select('planned_date, status').eq('user_id', userId),
      client.from('workout_logs').select('id, started_at, completed_at').eq('user_id', userId),
    ])
    const wk = (workouts ?? []) as { planned_date: string; status: string }[]
    const logRows = (logs ?? []) as LogRow[]

    const logIds = logRows.map(l => l.id)
    const { data: sets } = logIds.length
      ? await client.from('set_logs').select('workout_log_id, exercise_id, weight_lbs, reps_completed, completed_at').in('workout_log_id', logIds).not('is_warmup', 'is', true)
      : { data: [] as SetRow[] }
    const setRows = (sets ?? []) as SetRow[]

    // workout_log_id → started_at, to bucket sets into this / last week.
    const logStart = new Map<string, string>(logRows.map(l => [l.id, l.started_at ?? '']))
    const inThisWeek = (logId: string) => {
      const s = logStart.get(logId) ?? ''
      return s >= weekStartIso && s < weekEndIso
    }
    const inLastWeek = (logId: string) => {
      const s = logStart.get(logId) ?? ''
      return s >= prevStartIso && s < weekStartIso
    }

    // ── Workouts + consistency ──────────────────────────────────────────────
    const completedThisWeek = wk.filter(w => w.status === 'completed' && w.planned_date >= weekStartStr && w.planned_date < weekEndStr).length
    const prevCompleted = wk.filter(w => w.status === 'completed' && w.planned_date >= prevStartStr && w.planned_date < weekStartStr).length
    const missedThisWeek = wk.filter(w => w.status === 'missed' && w.planned_date >= weekStartStr && w.planned_date < weekEndStr).length
    const decidedThisWeek = completedThisWeek + missedThisWeek
    const consistencyPct = decidedThisWeek ? Math.round((completedThisWeek / decidedThisWeek) * 100) : (completedThisWeek ? 100 : 0)

    // ── Minutes + volume (this vs last week) ────────────────────────────────
    let minutes = 0
    for (const l of logRows) {
      if (!inThisWeek(l.id) || !l.started_at || !l.completed_at) continue
      minutes += Math.max(0, Math.round((Date.parse(l.completed_at) - Date.parse(l.started_at)) / 60000))
    }
    let volumeLbs = 0, prevVolumeLbs = 0
    for (const s of setRows) {
      if (s.weight_lbs == null) continue
      const v = s.weight_lbs * s.reps_completed
      if (inThisWeek(s.workout_log_id)) volumeLbs += v
      else if (inLastWeek(s.workout_log_id)) prevVolumeLbs += v
    }
    const volumeDeltaPct = prevVolumeLbs > 0 ? Math.round(((volumeLbs - prevVolumeLbs) / prevVolumeLbs) * 100) : null

    // ── Estimated strength gains: best est-1RM this week vs best before this week ─
    const bestThisWeek = new Map<string, number>()
    const bestBefore = new Map<string, number>()
    for (const s of setRows) {
      if (s.weight_lbs == null || s.weight_lbs <= 0) continue
      const e = estimate1RM(s.weight_lbs, s.reps_completed)
      if (inThisWeek(s.workout_log_id)) {
        if (e > (bestThisWeek.get(s.exercise_id) ?? 0)) bestThisWeek.set(s.exercise_id, e)
      } else if ((logStart.get(s.workout_log_id) ?? '') < weekStartIso) {
        if (e > (bestBefore.get(s.exercise_id) ?? 0)) bestBefore.set(s.exercise_id, e)
      }
    }
    const exIds = [...bestThisWeek.keys()]
    const { data: exRows } = exIds.length
      ? await client.from('exercises').select('id, name').in('id', exIds)
      : { data: [] as { id: string; name: string }[] }
    const exName = new Map<string, string>((exRows ?? []).map((e: any) => [e.id, e.name]))

    const gains: StrengthGain[] = []
    for (const [id, now] of bestThisWeek) {
      const prior = bestBefore.get(id)
      if (prior != null && now > prior) gains.push({ name: exName.get(id) ?? 'Lift', deltaLbs: Math.round(now - prior) })
    }
    gains.sort((a, b) => b.deltaLbs - a.deltaLbs)

    // ── Weekly weight trend ─────────────────────────────────────────────────
    let weightPerWeek: number | null = null
    try {
      const ms = await fetchMeasurements(client, userId, 60)
      weightPerWeek = computeWeightTrend(ms).lbsPerWeek
    } catch { /* trend optional */ }

    // ── New weight PRs set this week (running max over chronological sets) ────
    const chrono = [...setRows].filter(s => s.weight_lbs != null && s.weight_lbs > 0)
      .sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''))
    const runMax = new Map<string, number>()
    let newPRs = 0
    for (const s of chrono) {
      const prev = runMax.get(s.exercise_id) ?? 0
      if (s.weight_lbs! > prev) {
        if (prev > 0 && (s.completed_at ?? '') >= weekStartIso && (s.completed_at ?? '') < weekEndIso) newPRs++
        runMax.set(s.exercise_id, s.weight_lbs!)
      }
    }

    return {
      weekStart: weekStartStr,
      workouts: completedThisWeek,
      prevWorkouts: prevCompleted,
      missed: missedThisWeek,
      minutes,
      volumeLbs: Math.round(volumeLbs),
      prevVolumeLbs: Math.round(prevVolumeLbs),
      volumeDeltaPct,
      strongerExercises: gains.length,
      strengthGains: gains.slice(0, 3),
      weightPerWeek,
      consistencyPct,
      newPRs,
    }
  } catch {
    return null
  }
}

/** Did the user log anything worth reporting this week? */
export function reportHasContent(r: WeeklyReport | null): boolean {
  return !!r && (r.workouts > 0 || r.volumeLbs > 0)
}
