// Tempo — achievements + player level.
// Single source of truth for badges so the Profile and Progress screens never
// drift. Achievements are derived purely from stats, so there's nothing to store
// or sync — they light up the moment the underlying numbers cross the line.

export interface AchievementStats {
  totalWorkouts: number
  streak: number
  totalVolumeNum: number
  benchMax: number
}

export type AchievementTier = 'bronze' | 'silver' | 'gold'

export interface AchievementDef {
  key: string
  label: string
  icon: string // Ionicons name
  description: string
  tier: AchievementTier
  isUnlocked: (s: AchievementStats) => boolean
  /** For locked badges: how close the user is. */
  progress: (s: AchievementStats) => { current: number; target: number }
}

const clamp = (current: number, target: number) => ({ current: Math.min(current, target), target })

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: 'first_workout',
    label: 'First Workout',
    icon: 'footsteps',
    description: 'Complete your very first session',
    tier: 'bronze',
    isUnlocked: (s) => s.totalWorkouts >= 1,
    progress: (s) => clamp(s.totalWorkouts, 1),
  },
  {
    key: 'week_streak',
    label: '7-Day Streak',
    icon: 'flame',
    description: 'Train 7 days in a row',
    tier: 'silver',
    isUnlocked: (s) => s.streak >= 7,
    progress: (s) => clamp(s.streak, 7),
  },
  {
    key: 'ton_club',
    label: 'Ton Club',
    icon: 'barbell',
    description: 'Lift 10,000 lbs total',
    tier: 'silver',
    isUnlocked: (s) => s.totalVolumeNum >= 10000,
    progress: (s) => clamp(s.totalVolumeNum, 10000),
  },
  {
    key: 'thirty_sessions',
    label: '30 Sessions',
    icon: 'calendar',
    description: 'Complete 30 workouts',
    tier: 'silver',
    isUnlocked: (s) => s.totalWorkouts >= 30,
    progress: (s) => clamp(s.totalWorkouts, 30),
  },
  {
    key: 'bench_225',
    label: '225 Bench',
    icon: 'trophy',
    description: 'Bench press 225 lbs',
    tier: 'gold',
    isUnlocked: (s) => s.benchMax >= 225,
    progress: (s) => clamp(s.benchMax, 225),
  },
  {
    key: 'century',
    label: '100 Sessions',
    icon: 'ribbon',
    description: 'Complete 100 workouts',
    tier: 'gold',
    isUnlocked: (s) => s.totalWorkouts >= 100,
    progress: (s) => clamp(s.totalWorkouts, 100),
  },
  {
    key: 'iron_tonne',
    label: '100K Club',
    icon: 'medal',
    description: 'Lift 100,000 lbs total',
    tier: 'gold',
    isUnlocked: (s) => s.totalVolumeNum >= 100000,
    progress: (s) => clamp(s.totalVolumeNum, 100000),
  },
]

export function unlockedCount(s: AchievementStats): number {
  return ACHIEVEMENTS.filter((a) => a.isUnlocked(s)).length
}

// ── Player level ────────────────────────────────────────────────────────────
// Legible, gaming-style progression: one level per 5 completed workouts, with a
// title band so the profile reads like a character sheet.

export interface PlayerLevel {
  level: number
  title: string
  intoLevel: number // workouts completed toward the current level (0-4)
  perLevel: number // workouts needed per level
  toNext: number // workouts remaining to next level
}

const TITLES = ['Rookie', 'Regular', 'Committed', 'Grinder', 'Athlete', 'Beast', 'Elite']

export function computeLevel(totalWorkouts: number): PlayerLevel {
  const perLevel = 5
  const level = Math.floor(totalWorkouts / perLevel) + 1
  const intoLevel = totalWorkouts % perLevel
  const titleIdx = Math.min(TITLES.length - 1, Math.floor((level - 1) / 3))
  return {
    level,
    title: TITLES[titleIdx],
    intoLevel,
    perLevel,
    toNext: perLevel - intoLevel,
  }
}
