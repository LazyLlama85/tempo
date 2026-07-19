// Tempo — returning-user detection (audit §5.1).
//
// The moment a lapsing user reopens Tempo — after 3, 7, or 30 days away — is the
// single highest-leverage screen in the whole retention story, yet today it looks
// identical to a daily user's Home. This computes the absence tier from data that
// already exists (last completed session), so Home can swap in a "welcome back"
// off-ramp instead of the guilt that usually causes the next, permanent lapse.
//
// Reads only existing rows (no new tables/functions). A user who has never
// completed a session isn't "returning" — they get the normal first-run experience.

import type { SupabaseClient } from '@supabase/supabase-js'
import { toDateStr as dateStr } from '@/lib/dates'

export type AbsenceTier = 'd3' | 'd7' | 'd30'

export interface ReturningState {
  tier: AbsenceTier
  days: number
  /** The next scheduled session to resume, if any (drives the 3-day "pick up" CTA). */
  nextWorkoutId: string | null
  nextFocus: string | null
}

// Longest-absence tier the day count qualifies for, or null when < 3 days (a daily
// / near-daily user is not "returning").
export function tierForDays(days: number): AbsenceTier | null {
  if (days >= 30) return 'd30'
  if (days >= 7) return 'd7'
  if (days >= 3) return 'd3'
  return null
}

export async function getReturningState(
  client: SupabaseClient,
  userId: string,
): Promise<ReturningState | null> {
  if (!userId) return null
  try {
    const today = dateStr(new Date())
    const [{ data: lastDone }, { data: next }] = await Promise.all([
      client
        .from('scheduled_workouts')
        .select('planned_date')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('planned_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from('scheduled_workouts')
        .select('id, focus')
        .eq('user_id', userId)
        .eq('status', 'scheduled')
        .gte('planned_date', today)
        .order('planned_date', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    if (!lastDone) return null // never trained → not a returning user

    const last = new Date((lastDone.planned_date as string) + 'T00:00:00')
    const days = Math.floor((Date.now() - last.getTime()) / 86_400_000)
    const tier = tierForDays(days)
    if (!tier) return null

    return {
      tier,
      days,
      nextWorkoutId: (next?.id as string | undefined) ?? null,
      nextFocus: (next?.focus as string | undefined) ?? null,
    }
  } catch {
    return null
  }
}
