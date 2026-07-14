// Tempo Score — a proprietary 0–1000 commitment/consistency score.
//
// MISSION RULE (enforced by tempoScore.test.ts): a beginner who consistently
// completes their sessions must be able to out-score an advanced lifter who skips.
// So there is DELIBERATELY **no** strength / bodyweight / volume / genetics input —
// every component measures showing up, not how much you lift. The frequency term
// counts *completed* sessions (never merely scheduled), so you cannot inflate the
// score by over-scheduling easy workouts you don't do.
//
// The formula lives here in JS (not SQL) so it can be tuned via an OTA update
// without a migration; the leaderboard RPC returns only the raw components below.

import { sessionStreak, type StreakRow } from './streak'

/** Raw, strength-free inputs. All counts are over a rolling 28-day window. */
export interface TempoScoreInput {
  /** Sessions that came DUE in the window (completed + missed + skipped). */
  dueSessions: number
  /** Of those, the ones actually completed. */
  completedSessions: number
  /** How many of the last 4 weeks hit ≥60% of the weekly goal (0–4). */
  weeksMetGoal: number
  /** Current consecutive-completed-session streak. */
  currentStreak: number
  /** The user's chosen weekly target (`user_profiles.days_per_week`). */
  goalPerWeek: number
}

export interface TempoScoreBreakdown {
  /** 0–1000. */
  score: number
  /** Each 0–1, for the "why" breakdown bars on the score card. */
  components: {
    completion: number
    goal: number
    consistency: number
    streak: number
    frequency: number
  }
}

/** Component weights — single source of truth. Sum = 1.0. Tune here, ships via OTA. */
export const TEMPO_SCORE_WEIGHTS = {
  completion: 0.35, // finish what you commit to (completed ÷ due)
  goal: 0.25, // hit your chosen weekly frequency
  consistency: 0.15, // show up EVERY week, not in bursts
  streak: 0.15, // current momentum
  frequency: 0.1, // absolute completed cadence (capped, non-gameable)
} as const

/** A 3-week perfect streak maxes the streak term — keeps momentum from dominating. */
const STREAK_CAP = 21
/** Absolute cadence caps at 4 completed/week, so raw volume can't swamp consistency. */
const FREQUENCY_CAP = 4

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)
/** Guard a sane weekly goal (profiles allow 1–6; default 3 when missing/garbage). */
export const clampGoal = (g: number | null | undefined) =>
  Number.isFinite(g as number) && (g as number) > 0 ? Math.min(7, Math.max(1, Math.round(g as number))) : 3

export function computeTempoScore(input: TempoScoreInput): TempoScoreBreakdown {
  const goalPerWeek = clampGoal(input.goalPerWeek)
  const avgWeeklyCompleted = input.completedSessions / 4

  const completion = input.dueSessions > 0 ? clamp01(input.completedSessions / input.dueSessions) : 0
  const goal = clamp01(avgWeeklyCompleted / goalPerWeek)
  const consistency = clamp01(input.weeksMetGoal / 4)
  const streak = clamp01(input.currentStreak / STREAK_CAP)
  const frequency = clamp01(avgWeeklyCompleted / FREQUENCY_CAP)

  const w = TEMPO_SCORE_WEIGHTS
  const raw =
    w.completion * completion +
    w.goal * goal +
    w.consistency * consistency +
    w.streak * streak +
    w.frequency * frequency

  return { score: Math.round(1000 * raw), components: { completion, goal, consistency, streak, frequency } }
}

// ── Deriving inputs from a session history (client-side; mirrors the RPC) ────────
// Lets Tempo compute your own score locally from the same StreakRow[] the profile
// already loads, and gives the score engine an end-to-end unit test.

const DAY_MS = 86_400_000

function daysAgoStr(todayStr: string, days: number): string {
  const d = new Date(`${todayStr}T00:00:00Z`)
  return new Date(d.getTime() - days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Derive a TempoScoreInput from settled/scheduled sessions over the last 28 days.
 * `dueSessions` counts only sessions that came due (completed/missed/skipped) —
 * future 'scheduled' rows never penalise completion. Weeks are the last 4 rolling
 * 7-day buckets ending today.
 */
export function tempoScoreInputFromSessions(
  sessions: StreakRow[],
  goalPerWeek: number,
  todayStr: string,
): TempoScoreInput {
  const windowStart = daysAgoStr(todayStr, 27)
  const inWindow = sessions.filter((s) => s.planned_date >= windowStart && s.planned_date <= todayStr)
  const settled = (s: StreakRow) => s.status === 'completed' || s.status === 'missed' || s.status === 'skipped'

  const due = inWindow.filter(settled)
  const dueSessions = due.length
  const completedSessions = due.filter((s) => s.status === 'completed').length

  const goal = clampGoal(goalPerWeek)
  const weekThreshold = Math.max(1, Math.ceil(0.6 * goal))
  let weeksMetGoal = 0
  for (let w = 0; w < 4; w++) {
    const end = daysAgoStr(todayStr, w * 7)
    const start = daysAgoStr(todayStr, w * 7 + 6)
    const completedThatWeek = inWindow.filter(
      (s) => s.status === 'completed' && s.planned_date >= start && s.planned_date <= end,
    ).length
    if (completedThatWeek >= weekThreshold) weeksMetGoal++
  }

  return {
    dueSessions,
    completedSessions,
    weeksMetGoal,
    currentStreak: sessionStreak(sessions, todayStr),
    goalPerWeek: goal,
  }
}
