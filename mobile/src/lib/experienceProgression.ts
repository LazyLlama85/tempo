// Tempo — automatic experience progression ("the plan grows with you").
//
// Onboarding asks the user to self-rate beginner / intermediate / advanced, and
// that one answer shapes everything: which exercise variations are programmed and
// how aggressive the periodization is (a beginner gets a gentle linear wave and a
// shallow deload; an intermediate earns a real overload peak — see periodization.ts
// and generatePlan.ts). But people don't stay beginners. A brand-new lifter who
// trains consistently for a month has out-grown push-ups and goblet squats.
//
// The reactive layers already move the plan DOWN when someone is overreached
// (`adaptation.ts` flips the block into recovery/deload). This module is the
// missing UP direction: it graduates the user's experience level as they earn it,
// so the app starts beginner-friendly and then advances — quickly to intermediate,
// then more deliberately to advanced — instead of freezing them at whatever they
// tapped on day one.
//
// Signals (all cheap, all best-effort — this must never block a workout):
//   • completed sessions      → movement competency ("I've done the reps to handle
//                                harder variations"). The main driver.
//   • recent "too easy" feedback → the programming is under-challenging me. Pulls
//                                the promotion forward.
//   • NOT in recovery/deload, and no recent "too hard" → don't promote someone the
//                                reactive layer is actively backing off. Safety gate.
//
// Promotions are one tier at a time so each is a discrete, celebrated moment
// (see workout-complete.tsx). We never demote here — struggling is handled by
// adaptation_mode, not by knocking the user's self-image back down.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Experience } from '@/types'
import { restampFuturePlanForExperience } from '@/lib/generatePlan'

const ORDER: Experience[] = ['beginner', 'intermediate', 'advanced']

export interface ExperiencePromotion {
  from: Experience
  to: Experience
}

// Celebration copy for a level-up, keyed by the level just reached.
export const LEVEL_UP_COPY: Record<Exclude<Experience, 'beginner'>, { title: string; body: string }> = {
  intermediate: {
    title: "You've leveled up to Intermediate",
    body: 'You put in the reps — your plan just grew with you. Expect tougher exercise variations and a real overload week built into the block.',
  },
  advanced: {
    title: "You've leveled up to Advanced",
    body: "You've earned it. Your programming shifts to advanced variations and periodized peaks tuned for a seasoned lifter.",
  },
}

function nextLevel(e: Experience): Exclude<Experience, 'beginner'> | null {
  const i = ORDER.indexOf(e)
  if (i < 0 || i >= ORDER.length - 1) return null
  return ORDER[i + 1] as Exclude<Experience, 'beginner'>
}

// The level the user has EARNED, given how they've performed. Never more than one
// tier above `current` per call, so a level-up is always a single clean step.
//   beginner → intermediate: ~3–4 weeks of consistent work (10 sessions), or sooner
//     (6) if they keep reporting sessions as "too easy" — the "advance quickly" case.
//   intermediate → advanced: a real training age (36 sessions), or 24 with a
//     sustained "too easy" signal. Deliberately slower — advanced is earned.
export function earnedLevel(current: Experience, completed: number, tooEasy: number): Experience {
  if (current === 'beginner') {
    if (completed >= 10 || (completed >= 6 && tooEasy >= 2)) return 'intermediate'
    return current
  }
  if (current === 'intermediate') {
    if (completed >= 36 || (completed >= 24 && tooEasy >= 3)) return 'advanced'
    return current
  }
  return current
}

/**
 * Evaluate promotion signals and, if the user has earned the next level, apply it:
 * persist the new experience, re-stamp the coming plan weeks so the change is
 * visible immediately, and audit it. Returns the promotion (for the celebration)
 * or null. Never throws — a failure here silently leaves the user where they were.
 *
 * Call this at the natural "you earned it" moment: after a completed session (see
 * workout-complete.tsx). Not wired into silent app-open refreshes on purpose, so a
 * promotion is always paired with its celebration.
 */
export async function maybePromoteExperience(
  client: SupabaseClient,
  userId: string,
): Promise<ExperiencePromotion | null> {
  try {
    const { data: profile } = await client
      .from('user_profiles')
      .select('experience')
      .eq('user_id', userId)
      .maybeSingle()
    const current = (profile?.experience ?? 'beginner') as Experience
    const target = nextLevel(current)
    if (!target) return null // already advanced — nothing above it

    // Don't promote a user the reactive layer is actively backing off.
    const { data: plan } = await client
      .from('user_plans')
      .select('adaptation_mode')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const mode = plan?.adaptation_mode ?? 'normal'
    if (mode === 'recovery' || mode === 'deload') return null

    const [{ count: completedCount }, { data: feedback }] = await Promise.all([
      client
        .from('scheduled_workouts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'completed'),
      client
        .from('adaptation_events')
        .select('trigger_details')
        .eq('user_id', userId)
        .eq('trigger', 'workout_feedback')
        .order('created_at', { ascending: false })
        .limit(6),
    ])

    const completed = completedCount ?? 0
    let tooEasy = 0
    let tooHard = 0
    for (const f of feedback ?? []) {
      const bias = (f.trigger_details as { bias?: number } | null)?.bias
      if (bias === 1) tooEasy++
      else if (bias === -1) tooHard++
    }
    // Recent strain is a hold signal even before it trips the recovery threshold.
    if (tooHard >= 2) return null

    const earned = earnedLevel(current, completed, tooEasy)
    if (earned === current) return null

    // If this write fails, the celebration + restamp below must NOT fire —
    // otherwise the user sees "LEVEL UP" and gets tomorrow's session restamped
    // against a level the profile was never actually updated to, and the whole
    // promotion evaporates the next time the profile is read from the server.
    const { error } = await client.from('user_profiles').update({ experience: earned }).eq('user_id', userId)
    if (error) return null

    // Best-effort audit; mirrors how adaptation.ts records its decisions.
    client
      .from('adaptation_events')
      .insert({
        user_id: userId,
        trigger: 'experience_promotion',
        trigger_details: { from: current, to: earned, completed, tooEasy },
        action_taken: `promote_${earned}`,
      })
      .then(undefined, () => {})

    // Make the level-up land on tomorrow's session, not a month from now.
    await restampFuturePlanForExperience(client, userId).catch(() => 0)

    return { from: current, to: earned }
  } catch {
    return null
  }
}
