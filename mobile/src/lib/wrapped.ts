// Tempo — "Wrapped"-style shareable cards.
//
// Turns the user's real training data into a small set of badge-worthy cards
// (Spotify-Wrapped energy, not a workout log): a weekly recap, a streak, a fresh
// PR, and goal progress. Each card also gets an auto-generated caption so sharing
// feels personal instead of "Completed workout." Everything is derived from data
// we already store; a card only appears when its numbers are real.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal } from '@/types'
import { fetchMeasurements, computeWeightTrend } from '@/lib/bodyMeasurements'

export type WrappedCard =
  | { kind: 'weekly'; workouts: number; minutes: number; volumeLbs: number; adherencePct: number; prs: number; topExercise: string | null; topDeltaLbs: number | null }
  | { kind: 'streak'; days: number; workouts: number; hours: number }
  | { kind: 'pr'; exercise: string; weight: number; deltaLbs: number | null }
  | { kind: 'goal'; goal: Goal; title: string; pct: number; weeksRemaining: number; workoutsCompleted: number }
  | { kind: 'monthVolume'; lbs: number; workouts: number; monthLabel: string }
  | { kind: 'topLifts'; monthLabel: string; lifts: { name: string; weight: number }[] }
  | { kind: 'weightTrend'; startLbs: number; nowLbs: number; perWeek: number | null; weeks: number }

const GOAL_TITLES: Record<Goal, string> = {
  muscle_gain: 'BUILD MUSCLE',
  fat_loss: 'LOSE FAT',
  strength: 'GET STRONGER',
  general_fitness: 'GENERAL FITNESS',
  athletic: 'ATHLETIC PERFORMANCE',
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function mondayOf(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0)
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}

interface LogRow { id: string; started_at: string | null; completed_at: string | null }
interface SetRow { workout_log_id: string; exercise_id: string; weight_lbs: number | null; reps_completed: number; completed_at: string | null }

// Build every card currently worth sharing, most shareable first. Returns [] on any
// failure so callers can simply hide the share entry point.
export async function buildWrappedCards(client: SupabaseClient, userId: string): Promise<WrappedCard[]> {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const weekStart = mondayOf(today)
    const weekStartStr = toDateStr(weekStart)

    const [{ data: profile }, { data: workouts }, { data: logs }, { data: plan }] = await Promise.all([
      client.from('user_profiles').select('goal, days_per_week').eq('user_id', userId).maybeSingle(),
      client.from('scheduled_workouts').select('planned_date, status').eq('user_id', userId),
      client.from('workout_logs').select('id, started_at, completed_at').eq('user_id', userId),
      client.from('user_plans').select('start_date, end_date, current_week, status').eq('user_id', userId).eq('status', 'active').maybeSingle(),
    ])

    const logRows = (logs ?? []) as LogRow[]
    const logIds = logRows.map(l => l.id)
    const { data: sets } = logIds.length
      ? await client.from('set_logs').select('workout_log_id, exercise_id, weight_lbs, reps_completed, completed_at').in('workout_log_id', logIds)
      : { data: [] as SetRow[] }
    const setRows = (sets ?? []) as SetRow[]

    // Resolve exercise names for PR / top-exercise labels.
    const exIds = [...new Set(setRows.map(s => s.exercise_id))]
    const { data: exRows } = exIds.length
      ? await client.from('exercises').select('id, name').in('id', exIds)
      : { data: [] as { id: string; name: string }[] }
    const exName = new Map<string, string>((exRows ?? []).map((e: any) => [e.id, e.name]))

    const cards: WrappedCard[] = []

    // ── Weekly recap ──────────────────────────────────────────────────────────
    const wk = (workouts ?? []) as { planned_date: string; status: string }[]
    const completedThisWeek = wk.filter(w => w.status === 'completed' && w.planned_date >= weekStartStr).length
    const decidedThisWeek = wk.filter(w => (w.status === 'completed' || w.status === 'missed') && w.planned_date >= weekStartStr).length
    const adherencePct = decidedThisWeek ? Math.round((completedThisWeek / decidedThisWeek) * 100) : (completedThisWeek ? 100 : 0)

    const weekLogIds = new Set(logRows.filter(l => (l.started_at ?? '') >= weekStart.toISOString()).map(l => l.id))
    let weekMinutes = 0
    for (const l of logRows) {
      if (!weekLogIds.has(l.id) || !l.started_at || !l.completed_at) continue
      weekMinutes += Math.max(0, Math.round((new Date(l.completed_at).getTime() - new Date(l.started_at).getTime()) / 60000))
    }

    // This week's volume + top exercise by volume, and PRs set this week.
    const weekVolByEx = new Map<string, number>()
    let weekVolume = 0
    for (const s of setRows) {
      if (!weekLogIds.has(s.workout_log_id) || s.weight_lbs == null) continue
      const v = s.weight_lbs * s.reps_completed
      weekVolume += v
      weekVolByEx.set(s.exercise_id, (weekVolByEx.get(s.exercise_id) ?? 0) + v)
    }
    let topExId: string | null = null, topVol = -1
    for (const [id, v] of weekVolByEx) if (v > topVol) { topVol = v; topExId = id }

    // Per-exercise running max (chronological) → PRs + deltas.
    const sorted = [...setRows].filter(s => s.weight_lbs != null && s.weight_lbs > 0)
      .sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''))
    const runMax = new Map<string, number>()
    const prsThisWeek: { exId: string; when: string; delta: number; weight: number }[] = []
    const latestPr: { exId: string; when: string; delta: number | null; weight: number }[] = []
    for (const s of sorted) {
      const prev = runMax.get(s.exercise_id) ?? 0
      if (s.weight_lbs! > prev) {
        const when = s.completed_at ?? ''
        const isImprovement = prev > 0
        latestPr.push({ exId: s.exercise_id, when, delta: isImprovement ? s.weight_lbs! - prev : null, weight: s.weight_lbs! })
        if (isImprovement && when >= weekStart.toISOString()) {
          prsThisWeek.push({ exId: s.exercise_id, when, delta: s.weight_lbs! - prev, weight: s.weight_lbs! })
        }
        runMax.set(s.exercise_id, s.weight_lbs!)
      }
    }

    // Top exercise delta this week = best improvement on the top-volume lift.
    let topDelta: number | null = null
    if (topExId) {
      const imp = prsThisWeek.filter(p => p.exId === topExId).sort((a, b) => b.delta - a.delta)[0]
      topDelta = imp?.delta ?? null
    }

    if (completedThisWeek > 0) {
      cards.push({
        kind: 'weekly',
        workouts: completedThisWeek,
        minutes: weekMinutes,
        volumeLbs: Math.round(weekVolume),
        adherencePct,
        prs: prsThisWeek.length,
        topExercise: topExId ? (exName.get(topExId) ?? null) : null,
        topDeltaLbs: topDelta,
      })
    }

    // ── Streak ────────────────────────────────────────────────────────────────
    const completedDates = new Set(wk.filter(w => w.status === 'completed').map(w => w.planned_date))
    let streak = 0
    const cur = new Date(today)
    while (completedDates.has(toDateStr(cur))) { streak++; cur.setDate(cur.getDate() - 1) }
    const totalCompleted = wk.filter(w => w.status === 'completed').length
    let totalMinutes = 0
    for (const l of logRows) {
      if (!l.started_at || !l.completed_at) continue
      totalMinutes += Math.max(0, (new Date(l.completed_at).getTime() - new Date(l.started_at).getTime()) / 60000)
    }
    if (streak >= 2) {
      cards.push({ kind: 'streak', days: streak, workouts: totalCompleted, hours: Math.round(totalMinutes / 60) })
    }

    // ── Latest PR ───────────────────────────────────────────────────────────────
    const meaningful = latestPr.filter(p => p.delta != null).sort((a, b) => b.when.localeCompare(a.when))
    const prPick = meaningful[0] ?? latestPr.sort((a, b) => b.when.localeCompare(a.when))[0]
    if (prPick) {
      cards.push({ kind: 'pr', exercise: exName.get(prPick.exId) ?? 'Lift', weight: prPick.weight, deltaLbs: prPick.delta })
    }

    // ── Goal progress (only when the active plan has a real timeline) ────────────
    const goal = (profile?.goal ?? 'general_fitness') as Goal
    if (plan?.start_date && plan?.end_date) {
      const start = new Date(`${plan.start_date}T00:00:00`).getTime()
      const end = new Date(`${plan.end_date}T00:00:00`).getTime()
      const now = today.getTime()
      if (end > start) {
        const pct = Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)))
        const weeksRemaining = Math.max(0, Math.ceil((end - now) / (7 * 86400000)))
        cards.push({ kind: 'goal', goal, title: GOAL_TITLES[goal], pct, weeksRemaining, workoutsCompleted: totalCompleted })
      }
    }

    // ── This month: total volume + top lifts ────────────────────────────────────
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const monthStartIso = monthStart.toISOString()
    const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
    let monthVolume = 0
    const monthMaxByEx = new Map<string, number>()
    for (const s of setRows) {
      if (s.weight_lbs == null || (s.completed_at ?? '') < monthStartIso) continue
      monthVolume += s.weight_lbs * s.reps_completed
      if (s.weight_lbs > (monthMaxByEx.get(s.exercise_id) ?? 0)) monthMaxByEx.set(s.exercise_id, s.weight_lbs)
    }
    const monthWorkouts = wk.filter(w => w.status === 'completed' && w.planned_date >= toDateStr(monthStart)).length
    if (monthVolume > 0) {
      cards.push({ kind: 'monthVolume', lbs: Math.round(monthVolume), workouts: monthWorkouts, monthLabel })
    }
    const topLifts = [...monthMaxByEx.entries()]
      .map(([id, weight]) => ({ name: exName.get(id) ?? 'Lift', weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
    if (topLifts.length >= 2) {
      cards.push({ kind: 'topLifts', monthLabel, lifts: topLifts })
    }

    // ── Weight trend (before → now) ─────────────────────────────────────────────
    try {
      const ms = await fetchMeasurements(client, userId, 90)
      const weighed = ms.filter(m => m.weight_lbs != null)
        .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
      if (weighed.length >= 2) {
        const startLbs = weighed[0].weight_lbs as number
        const t = computeWeightTrend(ms)
        const nowLbs = t.currentAvg ?? (weighed[weighed.length - 1].weight_lbs as number)
        const weeks = Math.max(1, Math.round((Date.parse(weighed[weighed.length - 1].measured_at) - Date.parse(weighed[0].measured_at)) / (7 * 86400000)))
        cards.push({ kind: 'weightTrend', startLbs: Math.round(startLbs * 10) / 10, nowLbs, perWeek: t.lbsPerWeek, weeks })
      }
    } catch { /* trend optional */ }

    return cards
  } catch {
    return []
  }
}

// ── Auto-generated captions ─────────────────────────────────────────────────
// Personal, a little human — the kind of line someone would actually post, not
// "Completed workout." Kept deterministic so the preview matches what gets copied.

function fmtNum(n: number): string { return Math.round(n).toLocaleString() }
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

export function captionFor(card: WrappedCard): string {
  switch (card.kind) {
    case 'weekly': {
      const bits = [`${card.workouts} workout${card.workouts === 1 ? '' : 's'} in the books this week`]
      if (card.adherencePct >= 100) bits.push('100% of what I planned. 💯')
      else if (card.adherencePct >= 80) bits.push(`${card.adherencePct}% schedule adherence.`)
      if (card.topExercise && card.topDeltaLbs) bits.push(`${card.topExercise} up ${card.topDeltaLbs} lbs.`)
      bits.push('Showing up even on the busy days. 💪')
      return bits.join(' ')
    }
    case 'streak':
      return `${card.days}-day streak and still going. ${card.workouts} workouts, ${card.hours}h of work. Didn't always feel like it — showed up anyway. 🔥`
    case 'pr':
      return card.deltaLbs
        ? `New ${card.exercise} PR: ${fmtNum(card.weight)} lbs (+${card.deltaLbs} from my last best). Next stop: ${fmtNum(card.weight + 10)}. 🏆`
        : `First ${card.exercise} at ${fmtNum(card.weight)} lbs logged. Building from here. 🏆`
    case 'goal':
      return `${card.pct}% of the way to my goal with ${card.weeksRemaining} week${card.weeksRemaining === 1 ? '' : 's'} to go. ${card.workoutsCompleted} workouts down. Locked in. 🎯`
    case 'monthVolume':
      return `${fmtNum(card.lbs)} lbs moved this month across ${card.workouts} workout${card.workouts === 1 ? '' : 's'}. The work adds up. 🏋️`
    case 'topLifts': {
      const top = card.lifts[0]
      return `Top lifts this month — ${card.lifts.map(l => `${l.name} ${fmtNum(l.weight)}`).join(', ')}.${top ? ` ${top.name} leading the way. 💪` : ''}`
    }
    case 'weightTrend': {
      const diff = Math.round((card.nowLbs - card.startLbs) * 10) / 10
      const dir = diff < 0 ? 'down' : 'up'
      return `${card.startLbs} → ${card.nowLbs} lbs over ${card.weeks} week${card.weeks === 1 ? '' : 's'} (${dir} ${Math.abs(diff)}). Trusting the process. 📉`
    }
  }
}

// Short helpers reused by the card UI.
export const wrappedFmt = { num: fmtNum, minutes: fmtMinutes }
