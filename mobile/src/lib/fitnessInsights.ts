// Tempo — Fitness Intelligence engine.
//
// The Progress "coach that explains behaviour" runs on this. Every function is a
// PURE derivation over data Tempo already stores — scheduled_workouts (plan +
// status), workout_logs.started_at (when you actually train), and set_logs
// (volume / muscle group). Nothing here talks to the network; callers pass the
// rows in (the same ones useProgressStats already fetches), so this stays unit-
// testable and cheap to re-run on focus.
//
// It COMPOSES the existing engines rather than re-implementing them:
//   • tempoScore.ts       — the 0–1000 commitment score + components
//   • streak.ts           — session streak + longest run
//   • trainingLoad.ts     — consecutive-training-day fatigue signal + regions
//   • recovery.ts         — the daily check-in readiness (used when present)
//
// Design rule (from the brief): every number must drive a decision. Each output
// carries a human message, and functions return low-confidence/empty states
// honestly instead of inventing claims when there isn't enough data yet.

import { sessionStreak, longestSessionStreak, type StreakRow } from './streak'
import { tempoScoreInputFromSessions, clampGoal } from './tempoScore'
import { consecutiveTrainingDays } from './trainingLoad'
import { toDateStr as ymd, addDays } from './dates'

// ── Date helpers (local, dependency-free) ───────────────────────────────────────

const DAY_MS = 86_400_000
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00`)
}
function mondayOf(s: string): string {
  const d = parseYmd(s)
  const monBased = (d.getDay() + 6) % 7
  return ymd(new Date(d.getTime() - monBased * DAY_MS))
}
function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:00 ${period}`
}
function completedDateSet(sessions: StreakRow[], todayStr: string): Set<string> {
  return new Set(sessions.filter((s) => s.status === 'completed' && s.planned_date <= todayStr).map((s) => s.planned_date))
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. MOMENTUM — is the user building a sustainable habit?
// ═══════════════════════════════════════════════════════════════════════════════

export interface Momentum {
  score: number            // 0–100
  label: string
  trendUp: boolean
  message: string
  currentStreak: number
  bestStreak: number
  isBest: boolean
}

export function computeMomentum(sessions: StreakRow[], goalPerWeek: number, todayStr: string): Momentum {
  const goal = clampGoal(goalPerWeek)
  const input = tempoScoreInputFromSessions(sessions, goal, todayStr)
  const currentStreak = input.currentStreak
  const bestStreak = longestSessionStreak(sessions, todayStr)

  // last-14-day completion of settled sessions
  const from14 = addDays(todayStr, -13)
  const settled = sessions.filter(
    (s) => s.planned_date >= from14 && s.planned_date <= todayStr &&
      (s.status === 'completed' || s.status === 'missed' || s.status === 'skipped'),
  )
  const recentRate = settled.length ? settled.filter((s) => s.status === 'completed').length / settled.length : 0

  // week-over-week trend (completed this 7d vs prior 7d)
  const thisWeek = sessions.filter((s) => s.status === 'completed' && s.planned_date >= addDays(todayStr, -6) && s.planned_date <= todayStr).length
  const priorWeek = sessions.filter((s) => s.status === 'completed' && s.planned_date >= addDays(todayStr, -13) && s.planned_date <= addDays(todayStr, -7)).length
  const trendUp = thisWeek >= priorWeek && (thisWeek > 0 || currentStreak > 0)

  const streakTerm = clamp01(currentStreak / 14)      // ~2 perfect weeks maxes it
  const consistencyTerm = clamp01(input.weeksMetGoal / 4)
  const recentTerm = clamp01(recentRate)
  const score = Math.round(100 * (0.45 * streakTerm + 0.35 * consistencyTerm + 0.20 * recentTerm))

  const isBest = currentStreak > 0 && currentStreak >= bestStreak
  const label = score >= 80 ? 'Soaring' : score >= 60 ? 'Building' : score >= 40 ? 'Warming up' : 'Restarting'

  let message: string
  if (isBest && currentStreak >= 3) message = `You're on your longest streak yet — ${currentStreak} sessions in a row.`
  else if (currentStreak >= 3) message = `${currentStreak} sessions in a row. Keep the chain alive.`
  else if (trendUp && thisWeek > 0) message = `You trained ${thisWeek}× this week — momentum is picking up.`
  else if (score >= 40) message = `Steady work. One more session tightens the habit.`
  else message = `A single workout restarts your momentum. Today's a good day.`

  return { score, label, trendUp, message, currentStreak, bestStreak, isBest }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. READINESS (history-based) — is today a good day to train hard?
//    Used when there's no daily recovery check-in (recovery.ts covers that case).
// ═══════════════════════════════════════════════════════════════════════════════

export interface ReadinessComponent { label: string; detail: string; tone: 'good' | 'ok' | 'low' }
export interface Readiness {
  score: number            // 0–100
  label: string
  headline: string
  recovery: ReadinessComponent
  load: ReadinessComponent
  source: 'history'
}

function readinessWord(score: number): string {
  if (score >= 80) return 'Primed'
  if (score >= 60) return 'Ready'
  if (score >= 45) return 'Moderate'
  return 'Take it easy'
}

/** `logTimes` are ISO started_at strings from workout_logs; `now` defaults to real now. */
export function readinessFromHistory(sessions: StreakRow[], logTimes: string[], now: Date = new Date()): Readiness {
  const todayStr = ymd(now)

  // Recovery: hours since the most recent logged session.
  const lastMs = logTimes
    .map((t) => new Date(t).getTime())
    .filter((ms) => Number.isFinite(ms) && ms <= now.getTime())
    .sort((a, b) => b - a)[0]
  const hoursSince = lastMs != null ? Math.round((now.getTime() - lastMs) / 3_600_000) : null

  let recoveryTerm: number
  let recovery: ReadinessComponent
  if (hoursSince == null) {
    recoveryTerm = 0.75
    recovery = { label: 'Fresh', detail: 'No recent sessions logged — ease back in.', tone: 'ok' }
  } else if (hoursSince < 12) {
    recoveryTerm = 0.4
    recovery = { label: 'Short rest', detail: `Only ${hoursSince}h since your last session.`, tone: 'low' }
  } else if (hoursSince < 20) {
    recoveryTerm = 0.6
    recovery = { label: 'Building', detail: `${hoursSince}h since your last session.`, tone: 'ok' }
  } else if (hoursSince < 36) {
    // ~a day out: still recovering — deliberately NOT full readiness (that was the bug).
    recoveryTerm = 0.75
    recovery = { label: 'Recovering', detail: `${hoursSince}h since your last session — about a day in.`, tone: 'ok' }
  } else if (hoursSince < 60) {
    recoveryTerm = 0.9
    recovery = { label: 'Recovered', detail: `You rested ${hoursSince}h after your last session.`, tone: 'good' }
  } else if (hoursSince <= 168) {
    const days = Math.round(hoursSince / 24)
    recoveryTerm = 1.0
    recovery = { label: 'Well rested', detail: `${days} days since your last session.`, tone: 'good' }
  } else {
    recoveryTerm = 0.82
    recovery = { label: 'Refreshed', detail: `It's been a while — start moderate.`, tone: 'ok' }
  }

  // Load: consecutive training days (fatigue) + recent 7-day cadence.
  const trained = completedDateSet(sessions, todayStr)
  const consecutive = consecutiveTrainingDays(trained, now) + (trained.has(todayStr) ? 1 : 0)
  const recent7 = sessions.filter((s) => s.status === 'completed' && s.planned_date >= addDays(todayStr, -6) && s.planned_date <= todayStr).length

  let loadTerm: number
  let load: ReadinessComponent
  if (consecutive >= 4) {
    loadTerm = 0.42
    load = { label: 'High', detail: `${consecutive} days in a row — a lighter or recovery session is smart.`, tone: 'low' }
  } else if (consecutive === 3) {
    loadTerm = 0.62
    load = { label: 'Elevated', detail: `3 straight training days — watch fatigue.`, tone: 'ok' }
  } else if (consecutive === 2) {
    loadTerm = 0.8
    load = { label: 'Moderate', detail: `Back-to-back training days.`, tone: 'ok' }
  } else if (recent7 >= 4) {
    loadTerm = 0.82
    load = { label: 'Busy week', detail: `${recent7} sessions in the last 7 days.`, tone: 'ok' }
  } else if (recent7 === 0) {
    loadTerm = 0.95
    load = { label: 'Light', detail: `Fresh week — plenty in the tank.`, tone: 'good' }
  } else {
    loadTerm = 0.9
    load = { label: 'Balanced', detail: `Your recent training matches your usual pattern.`, tone: 'good' }
  }

  const score = Math.round(100 * (0.55 * recoveryTerm + 0.45 * loadTerm))
  const headline =
    score >= 80 ? 'You are in an optimal state for a challenging workout.' :
    score >= 60 ? 'Good to train — push if you feel it, ease off if not.' :
    score >= 45 ? 'Consider a lighter workout or a recovery session.' :
    'Prioritise recovery today. A short, easy session at most.'

  return { score, label: readinessWord(score), headline, recovery, load, source: 'history' }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. OPTIMAL WORKOUT WINDOW — when does this user actually train successfully?
// ═══════════════════════════════════════════════════════════════════════════════

export interface OptimalWindow {
  hasData: boolean
  windowLabel: string      // e.g. "5:00 PM – 7:00 PM"
  reason: string
  weekdayInsight: string | null
}

export function optimalWindow(logTimes: string[]): OptimalWindow {
  const dates = logTimes.map((t) => new Date(t)).filter((d) => !isNaN(d.getTime()))
  if (dates.length < 5) {
    return {
      hasData: false,
      windowLabel: '',
      reason: 'Complete a few more workouts and Tempo will learn your best training window.',
      weekdayInsight: null,
    }
  }

  const byHour = Array<number>(24).fill(0)
  let weekday = 0
  let weekend = 0
  for (const d of dates) {
    byHour[d.getHours()]++
    const wd = d.getDay()
    if (wd === 0 || wd === 6) weekend++
    else weekday++
  }

  // Best 2-hour window by summed count.
  let bestStart = 0
  let bestSum = -1
  for (let h = 0; h < 23; h++) {
    const sum = byHour[h] + byHour[h + 1]
    if (sum > bestSum) { bestSum = sum; bestStart = h }
  }
  const windowLabel = `${hourLabel(bestStart)} – ${hourLabel(bestStart + 2)}`

  const total = weekday + weekend
  const weekdayShare = total ? Math.round((weekday / total) * 100) : 0
  const weekdayInsight =
    weekdayShare >= 70 ? `Most of your workouts (${weekdayShare}%) happen on weekdays.` :
    weekdayShare <= 30 ? `You train mostly on weekends (${100 - weekdayShare}%).` :
    null

  return {
    hasData: true,
    windowLabel,
    reason: `Your most successful workouts happen around ${hourLabel(bestStart)}.`,
    weekdayInsight,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CONSISTENCY PREDICTOR — will they hit this week's goal?
// ═══════════════════════════════════════════════════════════════════════════════

export interface Predictor {
  completed: number
  goal: number
  remainingScheduled: number
  projected: number
  onTrack: boolean
  message: string
}

export function consistencyPredictor(sessions: StreakRow[], goalPerWeek: number, todayStr: string): Predictor {
  const goal = clampGoal(goalPerWeek)
  const weekStart = mondayOf(todayStr)
  const weekEnd = addDays(weekStart, 6)

  const completed = sessions.filter((s) => s.status === 'completed' && s.planned_date >= weekStart && s.planned_date <= weekEnd).length
  const remainingScheduled = sessions.filter(
    (s) => s.status === 'scheduled' && s.planned_date >= todayStr && s.planned_date <= weekEnd,
  ).length
  const projected = Math.min(goal + 2, completed + remainingScheduled)
  const onTrack = projected >= goal

  let message: string
  if (completed >= goal) message = `Goal hit — ${completed}/${goal} done this week. 🔥`
  else if (onTrack) message = `You're on track for ${projected}/${goal} workouts this week.`
  else {
    const short = goal - projected
    message = `Schedule ${short} more session${short > 1 ? 's' : ''} to reach ${goal}/${goal} this week.`
  }
  return { completed, goal, remainingScheduled, projected, onTrack, message }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. SUCCESS PATTERNS — real, data-backed observations (never invented).
// ═══════════════════════════════════════════════════════════════════════════════

export function successPatterns(sessions: StreakRow[], logTimes: string[], todayStr: string): string[] {
  const out: string[] = []
  const times = logTimes.map((t) => new Date(t)).filter((d) => !isNaN(d.getTime()))

  // a) time-of-day concentration
  if (times.length >= 8) {
    const before7 = times.filter((d) => d.getHours() < 19).length
    const share = Math.round((before7 / times.length) * 100)
    if (share >= 65) out.push(`${share}% of your workouts happen before 7 PM.`)
    else if (share <= 35) out.push(`${100 - share}% of your workouts happen in the evening.`)
  }

  // b) weekday vs weekend completion rate
  const settled = sessions.filter((s) => s.planned_date <= todayStr && (s.status === 'completed' || s.status === 'missed' || s.status === 'skipped'))
  const bucket = (weekendWanted: boolean) => {
    const rows = settled.filter((s) => {
      const wd = parseYmd(s.planned_date).getDay()
      const isWeekend = wd === 0 || wd === 6
      return isWeekend === weekendWanted
    })
    return rows.length ? { rate: Math.round((rows.filter((r) => r.status === 'completed').length / rows.length) * 100), n: rows.length } : null
  }
  const wkday = bucket(false)
  const wkend = bucket(true)
  if (wkday && wkend && wkday.n >= 4 && wkend.n >= 3 && Math.abs(wkday.rate - wkend.rate) >= 15) {
    out.push(wkday.rate > wkend.rate
      ? `You complete ${wkday.rate}% of weekday workouts vs ${wkend.rate}% on weekends.`
      : `Weekends are your strength — ${wkend.rate}% completed vs ${wkday.rate}% on weekdays.`)
  }

  // c) best day of week
  if (settled.length >= 10) {
    const perDayDone = Array<number>(7).fill(0)
    const perDayTot = Array<number>(7).fill(0)
    for (const s of settled) {
      const wd = parseYmd(s.planned_date).getDay()
      perDayTot[wd]++
      if (s.status === 'completed') perDayDone[wd]++
    }
    let bestWd = -1
    let bestRate = -1
    for (let d = 0; d < 7; d++) {
      if (perDayTot[d] >= 2) {
        const r = perDayDone[d] / perDayTot[d]
        if (r > bestRate) { bestRate = r; bestWd = d }
      }
    }
    if (bestWd >= 0 && bestRate >= 0.8) out.push(`${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][bestWd]} are your most reliable training day.`)
  }

  return out.slice(0, 3)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CONSISTENCY HEATMAP — GitHub-style plan adherence grid.
// ═══════════════════════════════════════════════════════════════════════════════

export type HeatKind = 'none' | 'completed' | 'missed'
export interface HeatCell { date: string; kind: HeatKind }
export interface Heatmap { weeks: HeatCell[][]; totalCompleted: number; bestWeekCount: number; activeWeeks: number }

export function consistencyHeatmap(sessions: StreakRow[], todayStr: string, weeks = 17): Heatmap {
  const byDate = new Map<string, HeatKind>()
  for (const s of sessions) {
    if (s.planned_date > todayStr) continue
    const prev = byDate.get(s.planned_date)
    if (s.status === 'completed') byDate.set(s.planned_date, 'completed')
    else if ((s.status === 'missed' || s.status === 'skipped') && prev !== 'completed') byDate.set(s.planned_date, 'missed')
  }

  const end = mondayOf(todayStr)
  const start = addDays(end, -(weeks - 1) * 7)
  const cols: HeatCell[][] = []
  let totalCompleted = 0
  let bestWeekCount = 0
  let activeWeeks = 0

  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    let weekCompleted = 0
    let weekActive = false
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d)
      const kind = date <= todayStr ? (byDate.get(date) ?? 'none') : 'none'
      if (kind === 'completed') { weekCompleted++; totalCompleted++; weekActive = true }
      if (kind === 'missed') weekActive = true
      col.push({ date, kind })
    }
    if (weekActive) activeWeeks++
    bestWeekCount = Math.max(bestWeekCount, weekCompleted)
    cols.push(col)
  }
  return { weeks: cols, totalCompleted, bestWeekCount, activeWeeks }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. TRAINING FREQUENCY — completed workouts/week over a range.
// ═══════════════════════════════════════════════════════════════════════════════

export type FreqRange = '1M' | '3M' | '6M' | '1Y'
const RANGE_WEEKS: Record<FreqRange, number> = { '1M': 4, '3M': 13, '6M': 26, '1Y': 52 }

export interface FrequencySeries {
  points: { label: string; value: number }[]
  avgPerWeek: number
  prevAvgPerWeek: number | null
  deltaMessage: string
}

export function frequencySeries(sessions: StreakRow[], todayStr: string, range: FreqRange): FrequencySeries {
  const nWeeks = RANGE_WEEKS[range]
  const end = mondayOf(todayStr)
  const start = addDays(end, -(nWeeks - 1) * 7)
  const completed = sessions.filter((s) => s.status === 'completed')

  const perWeek = Array<number>(nWeeks).fill(0)
  let prevTotal = 0
  const prevStart = addDays(start, -nWeeks * 7)
  for (const s of completed) {
    if (s.planned_date >= start && s.planned_date <= addDays(end, 6)) {
      const wi = Math.floor((parseYmd(s.planned_date).getTime() - parseYmd(start).getTime()) / (7 * DAY_MS))
      if (wi >= 0 && wi < nWeeks) perWeek[wi]++
    } else if (s.planned_date >= prevStart && s.planned_date < start) {
      prevTotal++
    }
  }

  // Bucket labels: weekly for short ranges, monthly-ish tick for long ones.
  const points = perWeek.map((value, i) => {
    const wkStart = parseYmd(addDays(start, i * 7))
    const label = nWeeks <= 13 ? `${wkStart.getMonth() + 1}/${wkStart.getDate()}` : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][wkStart.getMonth()]
    return { label, value }
  })

  const avgPerWeek = Math.round((perWeek.reduce((a, b) => a + b, 0) / nWeeks) * 10) / 10
  const prevAvgPerWeek = prevTotal > 0 ? Math.round((prevTotal / nWeeks) * 10) / 10 : null

  let deltaMessage: string
  if (prevAvgPerWeek == null) deltaMessage = `You're averaging ${avgPerWeek} workouts/week.`
  else if (avgPerWeek > prevAvgPerWeek) deltaMessage = `You're averaging ${avgPerWeek} workouts/week, up from ${prevAvgPerWeek}.`
  else if (avgPerWeek < prevAvgPerWeek) deltaMessage = `You're averaging ${avgPerWeek} workouts/week, down from ${prevAvgPerWeek}.`
  else deltaMessage = `Holding steady at ${avgPerWeek} workouts/week.`

  return { points, avgPerWeek, prevAvgPerWeek, deltaMessage }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. MUSCLE BALANCE — are all regions getting worked?
// ═══════════════════════════════════════════════════════════════════════════════

export interface MuscleSlice { group: string; sets: number; pct: number }
export interface MuscleBalance { slices: MuscleSlice[]; insight: string | null }

const CANONICAL_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']

/** `sets` = one entry per working set with its exercise's coarse muscle_group. */
export function muscleBalance(sets: { group: string | null }[]): MuscleBalance {
  const counts = new Map<string, number>()
  for (const g of CANONICAL_GROUPS) counts.set(g, 0)
  let total = 0
  for (const s of sets) {
    const g = (s.group ?? '').toLowerCase()
    if (counts.has(g)) { counts.set(g, (counts.get(g) ?? 0) + 1); total++ }
  }
  const slices: MuscleSlice[] = CANONICAL_GROUPS.map((group) => {
    const n = counts.get(group) ?? 0
    return { group, sets: n, pct: total ? Math.round((n / total) * 100) : 0 }
  })

  let insight: string | null = null
  if (total >= 12) {
    const worked = slices.filter((s) => s.sets > 0)
    const min = slices.reduce((a, b) => (b.pct < a.pct ? b : a))
    const untouched = slices.filter((s) => s.sets === 0)
    if (untouched.length && untouched.length <= 3) {
      insight = `No ${untouched.map((u) => u.group).join(' or ')} sets logged lately — consider adding one.`
    } else if (worked.length >= 4 && min.pct > 0 && min.pct < 10) {
      insight = `Your ${min.group} is getting less work than the rest — a dedicated session would even it out.`
    } else {
      insight = `Well balanced across all muscle groups — nice.`
    }
  }
  return { slices, insight }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. STRENGTH TRENDS — "am I getting stronger?" top movers (start → now).
// ═══════════════════════════════════════════════════════════════════════════════

export interface StrengthSet { id: string; name: string; weight: number | null; at: string | null }
export interface StrengthTrend { id: string; name: string; from: number; to: number; pct: number; sessions: number }

/** Per exercise: max weight on the earliest logged day vs the latest, with % gain.
 *  Only lifts with ≥2 distinct training days and a positive baseline qualify. */
export function strengthTrends(sets: StrengthSet[], limit = 4): StrengthTrend[] {
  const byEx = new Map<string, { name: string; days: Map<string, number> }>()
  for (const s of sets) {
    if (s.weight == null || s.weight <= 0 || !s.at) continue
    const day = s.at.slice(0, 10)
    let e = byEx.get(s.id)
    if (!e) { e = { name: s.name, days: new Map() }; byEx.set(s.id, e) }
    e.days.set(day, Math.max(e.days.get(day) ?? 0, s.weight))
  }

  const trends: StrengthTrend[] = []
  for (const [id, e] of byEx) {
    const days = [...e.days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    if (days.length < 2) continue
    const from = days[0][1]
    const to = days[days.length - 1][1]
    if (from <= 0 || to <= from) continue
    trends.push({ id, name: e.name, from, to, pct: Math.round(((to - from) / from) * 1000) / 10, sessions: days.length })
  }
  return trends.sort((a, b) => b.pct - a.pct).slice(0, limit)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. WORKOUT READINESS HELPERS (Training tab — "what should I do today?")
//     Distinct from the Progress dashboard: these drive workout SELECTION, not
//     analytics. `intensityFromReadiness` maps a 0–100 readiness to a training
//     intensity; `muscleRecovery` reports per-muscle-group recovery from set logs.
// ═══════════════════════════════════════════════════════════════════════════════

export interface Intensity { label: 'Easy' | 'Moderate' | 'Hard'; blurb: string }

export function intensityFromReadiness(score: number): Intensity {
  if (score >= 75) return { label: 'Hard', blurb: 'Good day to push — heavier loads or higher intensity.' }
  if (score >= 50) return { label: 'Moderate', blurb: 'Train as planned; adjust by feel.' }
  return { label: 'Easy', blurb: 'Keep it light — technique work or a shorter session.' }
}

export type RecoveryStatus = 'recovered' | 'recovering' | 'fatigued' | 'untrained'
export interface MuscleRecovery { group: string; hours: number | null; status: RecoveryStatus; label: string }
export interface MuscleRecoveryResult { groups: MuscleRecovery[]; recommendedFocus: string; recommendedReason: string }

// The five coarse groups Tempo's exercises bucket into (core is trained implicitly).
const RECOVERY_GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms'] as const
// Which "day" trains a recovered group first — maps a group to a split label.
const DAY_FOR_GROUP: Record<string, string> = { chest: 'Push', shoulders: 'Push', arms: 'Push', back: 'Pull', legs: 'Legs' }

/** `sets` = working sets with the exercise's coarse muscle_group + completed_at. */
export function muscleRecovery(sets: { group: string | null; at: string | null }[], now: Date = new Date()): MuscleRecoveryResult {
  const lastAt = new Map<string, number>()
  for (const s of sets) {
    if (!s.group || !s.at) continue
    const g = s.group.toLowerCase()
    const t = new Date(s.at).getTime()
    if (!Number.isFinite(t) || t > now.getTime()) continue
    if (!lastAt.has(g) || t > (lastAt.get(g) as number)) lastAt.set(g, t)
  }

  const groups: MuscleRecovery[] = RECOVERY_GROUPS.map((group) => {
    const t = lastAt.get(group)
    if (t == null) return { group, hours: null, status: 'untrained' as RecoveryStatus, label: 'Ready' }
    const hours = Math.round((now.getTime() - t) / 3_600_000)
    const status: RecoveryStatus = hours >= 48 ? 'recovered' : hours >= 24 ? 'recovering' : 'fatigued'
    const label = status === 'recovered' ? 'Fully recovered' : status === 'recovering' ? 'Recovering' : 'Needs rest'
    return { group, hours, status, label }
  })

  // Recommend a focus for the most-recovered (untrained ranks highest) region.
  const rank = (g: MuscleRecovery) => (g.status === 'untrained' ? Number.MAX_SAFE_INTEGER : (g.hours ?? 0))
  const top = [...groups].sort((a, b) => rank(b) - rank(a))[0]
  const recommendedFocus = DAY_FOR_GROUP[top.group] ?? 'Full Body'
  const recommendedReason = top.status === 'untrained'
    ? `Your ${top.group} hasn't been trained recently.`
    : `Your ${top.group} is ${top.label.toLowerCase()}.`

  return { groups, recommendedFocus, recommendedReason }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12b. MUSCLE INTELLIGENCE — the Body Map's per-group status, recovery, trend,
//      and an overall balance score. Built only on the coarse muscle_group Tempo
//      actually stores (chest/back/shoulders/arms/legs/core), so every number is
//      real — no fabricated per-fine-muscle stats.
// ═══════════════════════════════════════════════════════════════════════════════

export type MuscleStatus = 'optimal' | 'attention' | 'fatigued' | 'growing'
export interface MuscleGroupIntel {
  group: string
  status: MuscleStatus
  weeklySets: number
  sessionsPerWeek: number
  recoveryPct: number
  lastTrainedHours: number | null
  volumeTrendPct: number | null
  balance: number            // 0–100 vs an even share of your volume
}
export interface MuscleIntelResult {
  groups: MuscleGroupIntel[]
  overallBalance: number
  insights: { kind: 'balanced' | 'weak' | 'recovery' | 'growth'; text: string }[]
  hasData: boolean
}

export function muscleIntelligence(sets: { group: string | null; at: string | null }[], now: Date = new Date()): MuscleIntelResult {
  const nowMs = now.getTime()
  const times = new Map<string, number[]>()
  for (const g of CANONICAL_GROUPS) times.set(g, [])
  for (const s of sets) {
    if (!s.group || !s.at) continue
    const g = s.group.toLowerCase()
    if (!times.has(g)) continue
    const t = new Date(s.at).getTime()
    if (Number.isFinite(t) && t <= nowMs) times.get(g)!.push(t)
  }

  const raw = CANONICAL_GROUPS.map((group) => {
    const ts = times.get(group)!
    const last = ts.length ? Math.max(...ts) : null
    const lastTrainedHours = last != null ? Math.round((nowMs - last) / 3_600_000) : null
    const weeklySets = ts.filter((t) => nowMs - t <= 7 * DAY_MS).length
    const sets28 = ts.filter((t) => nowMs - t <= 28 * DAY_MS).length
    const prev28 = ts.filter((t) => nowMs - t > 28 * DAY_MS && nowMs - t <= 56 * DAY_MS).length
    const daysSet = new Set(ts.filter((t) => nowMs - t <= 28 * DAY_MS).map((t) => Math.floor(t / DAY_MS)))
    const sessionsPerWeek = Math.round((daysSet.size / 4) * 10) / 10
    const volumeTrendPct = prev28 > 0 ? Math.round(((sets28 - prev28) / prev28) * 100) : null
    const recoveryPct = lastTrainedHours == null ? 100 : Math.max(0, Math.min(100, Math.round((lastTrainedHours / 48) * 100)))
    return { group, lastTrainedHours, weeklySets, sets28, sessionsPerWeek, volumeTrendPct, recoveryPct }
  })

  const totalSets28 = raw.reduce((a, b) => a + b.sets28, 0)
  const meanShare = 1 / CANONICAL_GROUPS.length

  const groups: MuscleGroupIntel[] = raw.map((r) => {
    const share = totalSets28 > 0 ? r.sets28 / totalSets28 : 0
    const balance = totalSets28 > 0 ? Math.max(0, Math.min(100, Math.round((share / meanShare) * 100))) : 0
    let status: MuscleStatus
    if (r.lastTrainedHours != null && r.lastTrainedHours < 36) status = 'fatigued'
    else if (r.volumeTrendPct != null && r.volumeTrendPct >= 30) status = 'growing'
    else if (totalSets28 > 0 && (balance < 60 || (r.lastTrainedHours != null && r.lastTrainedHours > 14 * 24) || r.lastTrainedHours == null)) status = 'attention'
    else status = 'optimal'
    return {
      group: r.group, status, weeklySets: r.weeklySets, sessionsPerWeek: r.sessionsPerWeek,
      recoveryPct: r.recoveryPct, lastTrainedHours: r.lastTrainedHours, volumeTrendPct: r.volumeTrendPct, balance,
    }
  })

  const overallBalance = totalSets28 > 0 ? Math.round(groups.reduce((a, b) => a + b.balance, 0) / groups.length) : 0

  const insights: MuscleIntelResult['insights'] = []
  if (totalSets28 >= 8) {
    const weakest = [...groups].sort((a, b) => a.balance - b.balance)[0]
    if (weakest && weakest.balance < 70) insights.push({ kind: 'weak', text: `Your ${weakest.group} is undertrained compared to your other muscle groups.` })
    const fatigued = groups.find((g) => g.status === 'fatigued')
    if (fatigued && fatigued.lastTrainedHours != null) insights.push({ kind: 'recovery', text: `Your ${fatigued.group} is still recovering — trained ${fatigued.lastTrainedHours}h ago (~${fatigued.recoveryPct}% recovered).` })
    const growing = groups.filter((g) => g.status === 'growing').sort((a, b) => (b.volumeTrendPct ?? 0) - (a.volumeTrendPct ?? 0))[0]
    if (growing) insights.push({ kind: 'growth', text: `Your ${growing.group} volume is trending up (+${growing.volumeTrendPct}% vs last month).` })
    if (overallBalance >= 80 && insights.length < 3) insights.push({ kind: 'balanced', text: 'Your training is well balanced across all muscle groups.' })
  }

  return { groups, overallBalance, insights: insights.slice(0, 4), hasData: totalSets28 > 0 }
}

// ── Muscle RANK — a gamified "how developed is my training here" tier per group,
//    for the Progress body map (most→least trained). Derived from cumulative logged
//    volume, so it's an honest training-development signal (NOT a strength standard).
export type MuscleTier = 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'elite' | 'world_class'
export const MUSCLE_TIERS: MuscleTier[] = ['beginner', 'novice', 'intermediate', 'advanced', 'elite', 'world_class']
export const MUSCLE_TIER_LABEL: Record<MuscleTier, string> = {
  beginner: 'Beginner', novice: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced', elite: 'Elite', world_class: 'World Class',
}
function tierForSets(n: number): MuscleTier {
  if (n < 10) return 'beginner'
  if (n < 30) return 'novice'
  if (n < 80) return 'intermediate'
  if (n < 160) return 'advanced'
  if (n < 320) return 'elite'
  return 'world_class'
}
export interface MuscleRankGroup { group: string; tier: MuscleTier; totalSets: number }
export interface MuscleRankResult { groups: MuscleRankGroup[]; mostTrained: string | null; leastTrained: string | null; hasData: boolean }

export function muscleRank(sets: { group: string | null }[]): MuscleRankResult {
  const counts = new Map<string, number>()
  for (const g of CANONICAL_GROUPS) counts.set(g, 0)
  for (const s of sets) {
    const g = (s.group ?? '').toLowerCase()
    if (counts.has(g)) counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  const groups: MuscleRankGroup[] = CANONICAL_GROUPS.map((group) => ({ group, tier: tierForSets(counts.get(group) ?? 0), totalSets: counts.get(group) ?? 0 }))
  const total = groups.reduce((a, b) => a + b.totalSets, 0)
  const trained = groups.filter((g) => g.totalSets > 0)
  const most = trained.length ? trained.reduce((a, b) => (b.totalSets > a.totalSets ? b : a)).group : null
  const least = trained.length ? trained.reduce((a, b) => (b.totalSets < a.totalSets ? b : a)).group : null
  return { groups, mostTrained: most, leastTrained: least, hasData: total > 0 }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12c. FINE MUSCLE INTELLIGENCE — per individual muscle (biceps vs triceps, quads
//      vs hamstrings…) for the upgraded Body Map. Maps the exercise's stored fine
//      `primary_muscles` onto the body figure's anatomical regions and computes each
//      one's own recovery/status. ADDITIVE — the coarse `muscleIntelligence` above is
//      untouched (the Progress-tab inline still reads it).
// ═══════════════════════════════════════════════════════════════════════════════

// The individual regions the body figure (react-native-body-highlighter) can shade.
export type BodyMuscle =
  | 'chest' | 'deltoids' | 'biceps' | 'triceps' | 'forearm' | 'trapezius'
  | 'upper-back' | 'lower-back' | 'abs' | 'obliques' | 'quadriceps'
  | 'hamstring' | 'gluteal' | 'calves' | 'adductors'

export const BODY_MUSCLES: BodyMuscle[] = [
  'chest', 'deltoids', 'biceps', 'triceps', 'forearm', 'trapezius', 'upper-back',
  'lower-back', 'abs', 'obliques', 'quadriceps', 'hamstring', 'gluteal', 'calves', 'adductors',
]

// Tempo's stored primary_muscles vocabulary → the body figure's regions. Anything
// not listed (full_body, legs — too coarse to attribute to one region) is ignored.
const MUSCLE_TO_BODY: Record<string, BodyMuscle> = {
  chest: 'chest', upper_chest: 'chest', pectorals: 'chest',
  shoulders: 'deltoids', deltoids: 'deltoids', lateral_deltoids: 'deltoids', rear_delts: 'deltoids', front_delts: 'deltoids', rotator_cuff: 'deltoids',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm', forearm: 'forearm',
  lats: 'upper-back', upper_back: 'upper-back', teres_major: 'upper-back', rhomboids: 'upper-back', back: 'upper-back',
  traps: 'trapezius', mid_traps: 'trapezius', trapezius: 'trapezius',
  lower_back: 'lower-back', erectors: 'lower-back', spine: 'lower-back',
  abs: 'abs', transverse_abdominis: 'abs', core: 'abs',
  obliques: 'obliques',
  quads: 'quadriceps', quadriceps: 'quadriceps', hip_flexors: 'quadriceps',
  hamstrings: 'hamstring', hamstring: 'hamstring',
  glutes: 'gluteal', hips: 'gluteal', gluteal: 'gluteal',
  calves: 'calves', ankles: 'calves',
  adductors: 'adductors', inner_thighs: 'adductors',
}

export const BODY_MUSCLE_LABEL: Record<BodyMuscle, string> = {
  chest: 'Chest', deltoids: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  forearm: 'Forearms', trapezius: 'Traps', 'upper-back': 'Back', 'lower-back': 'Lower back',
  abs: 'Abs', obliques: 'Obliques', quadriceps: 'Quads', hamstring: 'Hamstrings',
  gluteal: 'Glutes', calves: 'Calves', adductors: 'Adductors',
}

/** Map one stored primary-muscle name to a body region, or null if unmapped. */
export function bodyMuscleOf(name: string): BodyMuscle | null {
  return MUSCLE_TO_BODY[name.trim().toLowerCase()] ?? null
}

export interface FineMuscleIntel {
  muscle: BodyMuscle
  label: string
  status: MuscleStatus
  recoveryPct: number
  lastTrainedHours: number | null
  weeklySets: number
}
export interface FineMuscleResult { muscles: FineMuscleIntel[]; hasData: boolean }

/** Per-individual-muscle recovery/status from logged sets. `muscles` on each set is
 *  the exercise's fine primary_muscles list. A set counts once per body region it
 *  maps to (so "biceps + forearms" credits both, but not twice for two lat slugs). */
export function fineMuscleIntelligence(
  sets: { muscles: string[] | null; at: string | null }[],
  now: Date = new Date(),
): FineMuscleResult {
  const nowMs = now.getTime()
  const times = new Map<BodyMuscle, number[]>()
  for (const s of sets) {
    if (!s.at) continue
    const t = new Date(s.at).getTime()
    if (!Number.isFinite(t) || t > nowMs) continue
    const seen = new Set<BodyMuscle>()
    for (const raw of s.muscles ?? []) {
      const bm = bodyMuscleOf(raw)
      if (!bm || seen.has(bm)) continue
      seen.add(bm)
      let arr = times.get(bm)
      if (!arr) { arr = []; times.set(bm, arr) }
      arr.push(t)
    }
  }

  const muscles: FineMuscleIntel[] = []
  for (const m of BODY_MUSCLES) {
    const ts = times.get(m)
    if (!ts || !ts.length) continue
    const last = Math.max(...ts)
    const lastTrainedHours = Math.round((nowMs - last) / 3_600_000)
    const weeklySets = ts.filter((t) => nowMs - t <= 7 * DAY_MS).length
    const recoveryPct = Math.max(0, Math.min(100, Math.round((lastTrainedHours / 48) * 100)))
    // Fatigued < 36h; long-neglected (>2 weeks) needs attention; otherwise optimal.
    const status: MuscleStatus = lastTrainedHours < 36 ? 'fatigued' : lastTrainedHours > 14 * 24 ? 'attention' : 'optimal'
    muscles.push({ muscle: m, label: BODY_MUSCLE_LABEL[m], status, recoveryPct, lastTrainedHours, weeklySets })
  }
  // Least-recovered first — the most actionable ("train what's ready, rest what's not").
  muscles.sort((a, b) => a.recoveryPct - b.recoveryPct)
  return { muscles, hasData: muscles.length > 0 }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. JOURNEY TIMELINE — the emotional "how far you've come" story.
// ═══════════════════════════════════════════════════════════════════════════════

export interface JourneyEvent { date: string; title: string; detail: string; icon: string }

export function journeyTimeline(sessions: StreakRow[], todayStr: string): JourneyEvent[] {
  const completed = sessions
    .filter((s) => s.status === 'completed' && s.planned_date <= todayStr)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date))
  if (!completed.length) return []

  const events: JourneyEvent[] = []
  const fmt = (d: string) => parseYmd(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  events.push({ date: completed[0].planned_date, title: 'Started your Tempo journey', detail: `First workout on ${fmt(completed[0].planned_date)}.`, icon: 'flag' })

  for (const milestone of [10, 25, 50, 100, 200]) {
    if (completed.length >= milestone) {
      const d = completed[milestone - 1].planned_date
      events.push({ date: d, title: `${milestone} workouts completed`, detail: `Hit ${milestone} sessions on ${fmt(d)}.`, icon: 'barbell' })
    }
  }

  const best = longestSessionStreak(sessions, todayStr)
  if (best >= 5) events.push({ date: todayStr, title: `${best}-session streak`, detail: `Your longest run of consecutive sessions.`, icon: 'flame' })

  // De-dupe by title, keep chronological.
  const seen = new Set<string>()
  return events
    .filter((e) => (seen.has(e.title) ? false : (seen.add(e.title), true)))
    .sort((a, b) => a.date.localeCompare(b.date))
}
