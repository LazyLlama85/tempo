// Tempo — workout-level difficulty feedback ("that was too easy / too hard").
// This is the coarse, human signal that sits on top of the per-set RPE
// progression: when a whole session felt off, we bias the next one's volume so
// the plan visibly responds instead of marching on regardless.
//
// Persisted in the existing adaptation_events audit table (no migration needed).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Experience } from '@/types'
import { weekProgression, type AdaptationMode } from '@/lib/periodization'

export type WorkoutFeel = 'too_easy' | 'just_right' | 'too_hard'

// -1 trims volume next session, +1 adds it, 0 leaves it alone.
export type IntensityBias = -1 | 0 | 1

export function feelToBias(feel: WorkoutFeel): IntensityBias {
  return feel === 'too_easy' ? 1 : feel === 'too_hard' ? -1 : 0
}

export async function recordWorkoutFeedback(
  client: SupabaseClient,
  userId: string,
  feel: WorkoutFeel,
): Promise<void> {
  const bias = feelToBias(feel)
  const action = feel === 'too_easy' ? 'intensity_up' : feel === 'too_hard' ? 'volume_down' : 'maintain'
  try {
    await client.from('adaptation_events').insert({
      user_id: userId,
      trigger: 'workout_feedback',
      trigger_details: { feel, bias },
      action_taken: action,
    })
  } catch {
    // Best-effort — feedback should never block finishing a workout.
  }
}

// The most recent feedback the user gave. Drives the next session's volume until
// they give a new signal. Never throws (table/RLS issues degrade to 'no bias').
export async function getIntensityBias(client: SupabaseClient, userId: string): Promise<IntensityBias> {
  try {
    const { data } = await client
      .from('adaptation_events')
      .select('trigger_details')
      .eq('user_id', userId)
      .eq('trigger', 'workout_feedback')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const bias = (data?.trigger_details as { bias?: number } | null)?.bias
    return bias === 1 || bias === -1 ? bias : 0
  } catch {
    return 0
  }
}

// ── Mesocycle-level adaptation ────────────────────────────────────────────────
// The per-session bias above tunes a single workout. This decides the *mode* the
// whole block runs in (normal / recovery / deload) from accumulated signals, and
// re-stamps the progression on every future plan workout so the coming weeks
// actually change — this is what makes adaptation_mode a live input, not a label.

function dateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
// Monday (ISO) of the week containing `d`, as 'YYYY-MM-DD'.
function mondayOf(d: Date): string {
  const monBased = (d.getDay() + 6) % 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - monBased)
  monday.setHours(0, 0, 0, 0)
  return dateStr(monday)
}
function weeksBetween(fromStr: string, toStr: string): number {
  const ms = Date.parse(toStr + 'T00:00:00Z') - Date.parse(fromStr + 'T00:00:00Z')
  return Math.floor(ms / (7 * 86_400_000))
}
function stripDeload(focus: string): string {
  return focus.replace(/\s*\(Deload\)\s*$/i, '')
}

/**
 * Decide the adaptation mode from recent behaviour:
 *   - lots of missed sessions or repeated "too hard" → the user is overreached:
 *     'deload' (a hard reset now) or 'recovery' (reduced-volume rebuild).
 *   - otherwise 'normal'.
 * Reads at most a couple of small queries; never throws.
 */
export async function evaluateAdaptationMode(
  client: SupabaseClient,
  userId: string,
): Promise<AdaptationMode> {
  try {
    const today = new Date()
    const twoWeeksAgo = dateStr(new Date(today.getTime() - 14 * 86_400_000))

    const [{ data: feedback }, { count: missed }] = await Promise.all([
      client
        .from('adaptation_events')
        .select('trigger_details')
        .eq('user_id', userId)
        .eq('trigger', 'workout_feedback')
        .order('created_at', { ascending: false })
        .limit(4),
      client
        .from('scheduled_workouts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'missed')
        .eq('source', 'plan')
        .gte('planned_date', twoWeeksAgo),
    ])

    const tooHard = (feedback ?? []).filter(
      (f) => (f.trigger_details as { bias?: number } | null)?.bias === -1,
    ).length
    const missedCount = missed ?? 0

    if (missedCount >= 3 || tooHard >= 3) return 'deload'
    if (missedCount >= 2 || tooHard >= 2) return 'recovery'
    return 'normal'
  } catch {
    return 'normal'
  }
}

/**
 * Apply an adaptation mode to the user's active plan: persist it and re-stamp the
 * progression + week_index (and deload focus/duration) on every *future* plan
 * workout. Recovery/deload modes anchor week 0 of the new mesocycle to the coming
 * week so relief starts immediately; normal/maintenance keep the original cadence
 * anchored to the plan's start date.
 */
export async function applyAdaptationMode(
  client: SupabaseClient,
  userId: string,
  mode: AdaptationMode,
): Promise<void> {
  const { data: plan } = await client
    .from('user_plans')
    .select('id, start_date')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!plan) return

  const { data: profile } = await client
    .from('user_profiles')
    .select('experience, preferred_duration_min')
    .eq('user_id', userId)
    .maybeSingle()
  const experience = (profile?.experience ?? 'beginner') as Experience
  const baseDuration = profile?.preferred_duration_min ?? 45

  const today = dateStr(new Date())
  const { data: future } = await client
    .from('scheduled_workouts')
    .select('id, planned_date, focus')
    .eq('user_id', userId)
    .eq('user_plan_id', plan.id)
    .eq('status', 'scheduled')
    .gte('planned_date', today)
    .order('planned_date', { ascending: true })
  if (!future?.length) {
    await client.from('user_plans').update({ adaptation_mode: mode }).eq('id', plan.id)
    return
  }

  // Anchor the mesocycle: recovery/deload restart from the coming week so the
  // lighter weeks land now; normal/maintenance preserve the plan's own week grid.
  const anchorMonday =
    mode === 'normal' || mode === 'maintenance'
      ? mondayOf(new Date(plan.start_date + 'T00:00:00'))
      : mondayOf(new Date(future[0].planned_date + 'T00:00:00'))

  for (const w of future) {
    const weekIndex = Math.max(0, weeksBetween(anchorMonday, mondayOf(new Date(w.planned_date + 'T00:00:00'))))
    const progression = weekProgression(weekIndex, experience, mode)
    const focus = progression.isDeload
      ? `${stripDeload(w.focus)} (Deload)`
      : stripDeload(w.focus)
    await client
      .from('scheduled_workouts')
      .update({
        week_index: weekIndex,
        progression,
        focus,
        planned_duration_min: progression.isDeload ? Math.round(baseDuration * 0.85) : baseDuration,
      })
      .eq('id', w.id)
  }

  await client.from('user_plans').update({ adaptation_mode: mode }).eq('id', plan.id)
  await client.from('adaptation_events').insert({
    user_id: userId,
    trigger: 'auto_periodization',
    trigger_details: { mode, restamped: future.length },
    action_taken: mode,
  }).then(undefined, () => {})
}

/**
 * Evaluate signals and, if the mode should change, apply it. Best-effort entry
 * point to call after a workout / on app open. A user who manually chose
 * 'maintenance' is left alone (we don't auto-override an explicit choice).
 */
export async function refreshAdaptation(
  client: SupabaseClient,
  userId: string,
): Promise<AdaptationMode | null> {
  try {
    const { data: plan } = await client
      .from('user_plans')
      .select('adaptation_mode')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return null
    const current = (plan.adaptation_mode ?? 'normal') as AdaptationMode

    const next = current === 'maintenance'
      ? current                                   // respect an explicit user choice
      : await evaluateAdaptationMode(client, userId)

    if (next !== current) {
      await applyAdaptationMode(client, userId, next)
      return next
    }

    // Mode unchanged — but older plans (generated before periodization) may still
    // have unstamped future workouts. Stamp them once with the current mode.
    const { count: unstamped } = await client
      .from('scheduled_workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'plan')
      .eq('status', 'scheduled')
      .gte('planned_date', dateStr(new Date()))
      .is('progression', null)
    if (unstamped && unstamped > 0) await applyAdaptationMode(client, userId, current)
    return current
  } catch {
    return null
  }
}
