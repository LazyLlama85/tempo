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

export type BadgeCategory = 'consistency' | 'milestone' | 'competitive' | 'social'
export type BadgeTier = 'bronze' | 'silver' | 'gold'

/** Everything the derived badges need. Consistency fields come from a session
 *  history; the milestone totals are passed in (all-time). */
export interface BadgeStats {
  currentStreak: number
  longestStreak: number
  /** Clean ISO weeks (every due session completed) in the last 12 weeks. */
  perfectWeeks: number
  /** Consecutive recent weeks hitting the weekly goal (current week gets grace). */
  weeksMetGoalRun: number
  /** All-time completed sessions. */
  totalWorkouts: number
  /** All-time volume lifted (lbs). */
  totalVolume: number
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
  /**
   * Unit suffix for the progress line (e.g. 'lbs'). Only set where the number is
   * NOT self-evident from the badge label — sessions and streaks read fine bare.
   *
   * The volume badges need it because their thresholds are deliberately fixed in
   * POUNDS (they're branded round numbers: "Ton Club" = 10,000 lbs, "100K Club" =
   * 100,000) and are not converted to the user's display unit. A locked tile shows
   * only label + progress, so a kg user saw "1,320/10,000" with no unit anywhere,
   * immediately after every other screen showed their volume as 599 kg — two
   * different numbers for the same thing and no way to tell why.
   */
  progressUnit?: string
}

const clamp = (current: number, target: number) => ({ current: Math.min(current, target), target })

export const BADGES: BadgeDef[] = [
  {
    key: 'first_workout',
    label: 'First Workout',
    icon: 'footsteps',
    tier: 'bronze',
    description: 'Complete your very first session',
    category: 'milestone',
    earned: (s) => s.totalWorkouts >= 1,
    progress: (s) => clamp(s.totalWorkouts, 1),
  },
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
    key: 'streak_7',
    label: '7-Session Streak',
    icon: 'flame-outline',
    tier: 'bronze',
    description: 'Complete 7 sessions in a row',
    category: 'milestone',
    earned: (s) => s.longestStreak >= 7,
    progress: (s) => clamp(s.longestStreak, 7),
  },
  {
    key: 'thirty_sessions',
    label: '30 Sessions',
    icon: 'barbell',
    tier: 'silver',
    description: 'Complete 30 workouts',
    category: 'milestone',
    earned: (s) => s.totalWorkouts >= 30,
    progress: (s) => clamp(s.totalWorkouts, 30),
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
    key: 'ton_club',
    label: 'Ton Club',
    icon: 'barbell-outline',
    tier: 'silver',
    description: 'Lift 10,000 lbs total',
    category: 'milestone',
    earned: (s) => s.totalVolume >= 10000,
    progress: (s) => clamp(s.totalVolume, 10000),
    progressUnit: 'lbs',
  },
  {
    key: 'century',
    label: '100 Sessions',
    icon: 'ribbon',
    tier: 'gold',
    description: 'Complete 100 workouts',
    category: 'milestone',
    earned: (s) => s.totalWorkouts >= 100,
    progress: (s) => clamp(s.totalWorkouts, 100),
  },
  {
    key: 'iron_tonne',
    label: '100K Club',
    icon: 'medal',
    tier: 'gold',
    description: 'Lift 100,000 lbs total',
    category: 'milestone',
    earned: (s) => s.totalVolume >= 100000,
    progress: (s) => clamp(s.totalVolume, 100000),
    progressUnit: 'lbs',
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
    icon: 'star',
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

export function badgeStatsFromSessions(
  sessions: StreakRow[],
  goalPerWeek: number,
  todayStr: string,
  totals?: { totalWorkouts?: number; totalVolume?: number },
): BadgeStats {
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
    // All-time totals come from the caller (progress stats / friend_overview); fall
    // back to the completed count in the given window when not provided.
    totalWorkouts: totals?.totalWorkouts ?? sessions.filter((s) => s.status === 'completed').length,
    totalVolume: totals?.totalVolume ?? 0,
  }
}

/** Distinct badge keys the user has been awarded (competitive/social). */
export async function fetchStoredBadges(client: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await client.from('user_badges').select('badge_key').eq('user_id', userId)
  return [...new Set(((data ?? []) as { badge_key: string }[]).map((r) => r.badge_key))]
}

// ── "New badge" indicator (device-local) ────────────────────────────────────────
// The count on the Profile badges button is UNVIEWED badges: earned but not yet
// opened in the trophy case. Opening /badges marks them seen and clears the number.

const seenKey = (userId: string) => `tempo.badges.seen.${userId}`

export function getSeenBadges(userId: string): Set<string> {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(seenKey(userId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

// Distinguishes "never recorded anything" from "recorded, currently empty" —
// getSeenBadges collapses both to an empty Set, which isn't enough to answer
// "is this the very first time we've looked at this user's badges?" (see
// workout-complete.tsx's unlock-celebration bootstrap, where that distinction
// is what stops an existing user's already-earned badges from all appearing to
// unlock at once the first time the celebration code runs for them).
export function hasSeenRecord(userId: string): boolean {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage?.getItem(seenKey(userId)) != null
  } catch { return false }
}

export function markBadgesSeen(userId: string, keys: Iterable<string>): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return
    const merged = getSeenBadges(userId)
    for (const k of keys) merged.add(k)
    ls.setItem(seenKey(userId), JSON.stringify([...merged]))
  } catch { /* best-effort */ }
}

/** How many earned badges the user hasn't opened the trophy case for yet. */
export function unviewedBadgeCount(earned: Set<string> | string[], userId: string): number {
  const seen = getSeenBadges(userId)
  let n = 0
  for (const k of earned) if (!seen.has(k)) n++
  return n
}
