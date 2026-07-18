// Tempo — free-tier limits (the capped side of the Free/Pro line).
//
// The core training loop is NEVER capped (unlimited logging, the adaptive plan, the
// full exercise library, quick workouts, history). What's capped for free users is
// how much CUSTOM CONTENT they can create — the Hevy/Strong "routines" lever. Pro
// removes all of it. See MONETIZATION_PLAN.md §4.
//
// Like every gate in the app, this is inert while Pro is dormant: `useCreateLimit`
// reads `useProAccess().locked` (proEnabled && !isPro), so until the remote flag is
// flipped, `canCreate` always returns true and nothing is blocked. Free users only
// meet a cap once Pro is live AND they haven't subscribed.

import { useRouter } from 'expo-router'
import { useProAccess } from '@/stores/entitlements'
import { track } from '@/lib/analytics'

// The free ceilings (founder decision 2026-07-18). Changing a number here changes
// the cap everywhere it's enforced — single source of truth.
export const FREE_LIMITS = {
  custom_plans: 1,      // hand-built splits (the auto "By Tempo" program never counts)
  custom_exercises: 5,  // user-created exercises (the 1,300-move library stays free)
  custom_workouts: 5,   // saved workout templates
} as const

export type LimitKey = keyof typeof FREE_LIMITS

export function freeLimitFor(key: LimitKey): number {
  return FREE_LIMITS[key]
}

/**
 * Gate the CREATION of a capped free-tier item.
 *
 *   const { canCreate } = useCreateLimit()
 *   if (!canCreate('custom_workouts', currentCount)) return  // paywall was shown
 *   ...actually create it...
 *
 * Returns true when creation may proceed — Pro is dormant, the user is Pro/comped,
 * or they're still under the free limit. When they're at/over the limit and Pro is
 * live, it routes to the paywall (context = the limit key) and returns false.
 * `count` is how many of that item the user already has.
 */
export function useCreateLimit(): {
  locked: boolean
  canCreate: (key: LimitKey, count: number) => boolean
  /** Remaining free slots, or null when unlimited (Pro / dormant). For optional UI. */
  remaining: (key: LimitKey, count: number) => number | null
} {
  const { locked } = useProAccess()
  const router = useRouter()

  const canCreate = (key: LimitKey, count: number): boolean => {
    if (!locked) return true
    if (count < FREE_LIMITS[key]) return true
    track('paywall_shown', { context: key })
    router.push({ pathname: '/paywall', params: { context: key } } as never)
    return false
  }

  const remaining = (key: LimitKey, count: number): number | null => {
    if (!locked) return null
    return Math.max(0, FREE_LIMITS[key] - count)
  }

  return { locked, canCreate, remaining }
}
