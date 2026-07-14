// Tempo — social badges (consistency-first).
//
// These are the accountability/consistency badges shown on profiles. Strength/
// volume badges (Ton Club, 225 Bench…) stay in lib/achievements.ts — nothing here
// rewards how much you lift, only how reliably you show up.
//
//   • Derived badges (Perfect Week, 30-Day Streak, Consistency Champion) light up
//     purely from the user's own session history — nothing to store.
//   • Competitive badges (Weekly Winner, Top 3 Monthly) are relative + time-bound,
//     so they're recorded in user_badges the moment they're earned (see the
//     claim_competitive_badges RPC), and read back from there.
//   • Workout Partner is a social badge, awarded when a workout scheduled WITH a
//     friend is completed (activates in the social-scheduling stage).

import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionStreak, longestSessionStreak, type StreakRow } from './streak'
import { clampGoal } from './tempoScore'

export type BadgeCategory = 'consistency' | 'competitive' | 'social'
export type BadgeTier = 'bronze' | 'silver' | 'gold'

/** Everything the derived badges need, computed from a session history. */
export interface BadgeStats {
  currentStreak: number
  longestStreak: number
  /** Clean ISO weeks (every due session completed) in the last 12 weeks. */
  perfectWeeks: number
  /** Consecutive recent weeks hitting the weekly goal (current week gets grace). */
  weeksMetGoalRun: number
}

export interface BadgeDef {
  key: string
  label: string
  icon: string // Ionicons name (matches the Achievements section)
  tier: BadgeTier
  description: string
  category: BadgeCategory
  /** Derived badges compute earned/progress from stats; competitive/social omit these. */
  earned?: (s: BadgeStats) => boolean
  progress?: (s: BadgeStats) => { current: number; target: number }
}

const clamp = (current: number, target: number) => ({ current: Math.min(current, target), target })

export const BADGES: BadgeDef[] = [
  {
    key: 'perfect_week',
    label: 'Perfect Week',
    icon: 'checkmark-done-circle',
    tier: 'silver',
    description: 'Complete every workout you scheduled in a week',
    category: 'consistency',
    earned: (s) => s.perfectWeeks >= 1,
    progress: (s) => clamp(s.perfectWeeks, 1),
  },
  {
    key: 'consistency_champion',
    label: 'Consistency Champion',
    icon: 'calendar',
    tier: 'gold',
    description: 'Hit your weekly goal 4 weeks in a row',
    category: 'consistency',
    earned: (s) => s.weeksMetGoalRun >= 4,
    progress: (s) => clamp(s.weeksMetGoalRun, 4),
  },
  {
    key: 'streak_30',
    label: '30-Day Streak',
    icon: 'flame',
    tier: 'gold',
    description: '30 completed sessions in a row — no misses',
    category: 'consistency',
    earned: (s) => s.longestStreak >= 30,
    progress: (s) => clamp(s.longestStreak, 30),
  },
  {
    key: 'weekly_winner',
    label: 'Weekly Winner',
    icon: 'trophy',
    tier: 'silver',
    description: 'Finish #1 on your weekly leaderboard',
    category: 'competitive',
  },
  {
    key: 'top3_monthly',
    label: 'Top 3 Monthly',
    icon: 'medal',
    tier: 'silver',
    description: 'Finish top 3 among your friends for a month',
    category: 'competitive',
  },
  {
    key: 'workout_partner',
    label: 'Workout Partner',
    icon: 'people',
    tier: 'bronze',
    description: 'Complete a workout you scheduled with a friend',
    category: 'social',
  },
]

export const BADGE_BY_KEY: Record<string, BadgeDef> = Object.fromEntries(BADGES.map((b) => [b.key, b]))

/** Union of derived-earned badges and any stored (competitive/social) keys. */
export function computeEarnedBadges(stats: BadgeStats, storedKeys: Set<string>): Set<string> {
  const earned = new Set<string>()
  for (const b of BADGES) {
    if (b.earned) {
      if (b.earned(stats)) earned.add(b.key)
    } else if (storedKeys.has(b.key)) {
      earned.add(b.key)
    }
  }
  return earned
}

// ── Deriving BadgeStats from a session history ──────────────────────────────────

const DAY_MS = 86_400_000
const shift = (dateStr: string, days: number) =>
  new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)

/** Monday (ISO) of the week containing todayStr. */
function isoMonday(todayStr: string): string {
  const d = new Date(`${todayStr}T00:00:00Z`)
  return shift(todayStr, -((d.getUTCDay() + 6) % 7))
}

const isSettled = (s: StreakRow) => s.status === 'completed' || s.status === 'missed' || s.status === 'skipped'

export function badgeStatsFromSessions(sessions: StreakRow[], goalPerWeek: number, todayStr: string): BadgeStats {
  const goal = clampGoal(goalPerWeek)
  const monday = isoMonday(todayStr)

  const inWeek = (s: StreakRow, w: number) => {
    const start = shift(monday, -w * 7)
    const end = shift(start, 6)
    return s.planned_date >= start && s.planned_date <= end
  }

  let perfectWeeks = 0
  for (let w = 0; w < 12; w++) {
    const wk = sessions.filter((s) => inWeek(s, w))
    const due = wk.filter(isSettled).length
    const completed = wk.filter((s) => s.status === 'completed').length
    if (due > 0 && completed === due) perfectWeeks++
  }

  let weeksMetGoalRun = 0
  for (let w = 0; w < 12; w++) {
    const completed = sessions.filter((s) => inWeek(s, w) && s.status === 'completed').length
    if (completed >= goal) weeksMetGoalRun++
    else if (w === 0) continue // current week is still in progress — don't break the run
    else break
  }

  return {
    currentStreak: sessionStreak(sessions, todayStr),
    longestStreak: longestSessionStreak(sessions, todayStr),
    perfectWeeks,
    weeksMetGoalRun,
  }
}

/** Distinct badge keys the user has been awarded (competitive/social). */
export async function fetchStoredBadges(client: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await client.from('user_badges').select('badge_key').eq('user_id', userId)
  return [...new Set(((data ?? []) as { badge_key: string }[]).map((r) => r.badge_key))]
}
