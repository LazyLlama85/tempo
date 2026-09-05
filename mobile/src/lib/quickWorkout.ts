// Tempo — Quick Workout engine.
//
// The core promise: "No matter how busy your day gets, Tempo finds a way to keep
// you moving." This turns an amount of free time (5–60 min) + who the user is
// (goal, experience, equipment, injuries) + what they've trained recently into a
// purposeful session — not a random exercise list.
//
// Every Quick Workout has a *purpose* and an explanation of *why* it was picked
// and *how* it moves the user's long-term goal forward. Selection is sized to the
// available time by a simple time-cost model, and biased toward the highest-impact
// (compound, multi-muscle) movements that fit.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience } from '@/types'
import { effectiveEquipment } from '@/lib/travelMode'
import { expandEquipment, canPerform } from '@/lib/equipmentMatch'
import {
  loadFamiliarity, byFamiliarity, noveltySlotIndex,
  NO_HISTORY, type FamiliarityIndex,
} from '@/lib/exerciseFamiliarity'
import { resyncMovedWorkout } from '@/lib/moveWorkout'
import { captureApiError } from '@/lib/crashReporting'
import { BRAND_NAME } from '@/constants/brand'
import { toDateStr } from '@/lib/dates'
import { fetchExcludedExerciseIds } from '@/lib/exerciseExclusions'
import { SETUP_SEC } from '@/lib/durationEstimate'

// ── Public types ────────────────────────────────────────────────────────────

export type QuickPurpose =
  | 'strength_maintenance'
  | 'muscle_growth'
  | 'recovery'
  | 'mobility'
  | 'conditioning'
  | 'athletic'

export type QuickMinutes = 5 | 10 | 15 | 20 | 30 | 40 | 50 | 60

export const QUICK_DURATIONS: QuickMinutes[] = [5, 10, 15, 20, 30, 40, 50, 60]

export type MovementPattern =
  | 'push' | 'pull' | 'hinge' | 'squat' | 'carry' | 'core' | 'cardio' | 'mobility'

export interface QuickRestrictions {
  avoidMuscles: string[]
  avoidPatterns: MovementPattern[]
}

export interface QuickExercise {
  id: string
  name: string
  movement_pattern: string
  primary_muscles: string[]
  sets: number
  repLow: number
  repHigh: number
  repUnit: 'reps' | 'sec'
  restSeconds: number
}

export interface QuickWorkout {
  minutes: QuickMinutes
  purpose: QuickPurpose
  title: string          // "15-Minute Legs Strength" / "15-Minute Full Body Muscle"
  why: string            // why this was recommended right now
  contribution: string   // how it moves the long-term goal forward
  structure: 'straight_sets' | 'circuit'
  exercises: QuickExercise[]
  estimatedMinutes: number
  focusLabel: string      // short tag shown on the schedule, e.g. "Quick · Push/Pull"
}

export interface QuickContext {
  minutes: QuickMinutes
  purpose?: QuickPurpose          // defaults from the user's goal
  targetPattern?: MovementPattern // e.g. a missed "leg day" → bias squat/hinge (route-driven)
  targetMuscles?: string[]        // e.g. "Arms" tapped in the Quick Workout screen (user-driven)
  /** "Legs" / "Chest & Back" — the human-readable Target Area selection, for
   *  the title only (buildTitle below). The screen computes this from
   *  TARGET_AREA_OPTIONS' own labels, since targetMuscles alone (raw muscle
   *  names) can't be reconstructed back into a clean label reliably. */
  targetAreaLabel?: string | null
  daysSinceTrained?: number       // colours the "why" copy
  fromCalendarGap?: boolean       // "you have N free minutes" framing
  restrictions?: QuickRestrictions
}

// ── Target Area — beginner-friendly body-part picks (quick-workout.tsx) ─────────
// Distinct from targetPattern above (route-driven, e.g. a missed "leg day"
// suggestion): this is what the screen's own chips set when a user taps
// "Arms." Muscle-based, not movement-pattern-based, because that's how a
// beginner actually thinks about it — "push"/"pull" is training jargon.
// Muscle names below are exactly what's in exercises.primary_muscles (grep the
// live table before adding a new one; a name that doesn't match anything
// silently filters to nothing).
const ARM_MUSCLES = ['biceps', 'triceps', 'forearms']
const CHEST_MUSCLES = ['chest', 'upper_chest']
// Split so "Upper Body" can exclude the lower back. Lumping `lower_back` /
// `erectors` in with the lats meant Conventional Deadlift (primary
// hamstrings/glutes/erectors) and Hyperextension (primary lower_back) both
// counted as UPPER body — which is how a real "60-Minute Upper Body" request
// came back as deadlifts, hyperextensions and back extensions with no pressing
// in it at all (founder, 2026-09-04).
const UPPER_BACK_MUSCLES = ['lats', 'upper_back', 'traps', 'rhomboids', 'teres_major', 'mid_traps', 'back']
const LOWER_BACK_MUSCLES = ['lower_back', 'erectors', 'spine']
const BACK_MUSCLES = [...UPPER_BACK_MUSCLES, ...LOWER_BACK_MUSCLES]
const SHOULDER_MUSCLES = ['shoulders', 'lateral_deltoids', 'rear_delts', 'rotator_cuff']
// `hip_flexors` used to live here. In this catalogue every exercise that lists it
// as a PRIMARY muscle is an ab exercise (Hollow Body Hold and Hanging Leg Raise
// are both `['abs','hip_flexors']`), so having it under Legs meant a Legs request
// matched ab holds — the founder's "I asked for 40 minutes of legs and got a
// 5-minute ab workout" (2026-09-04). It belongs with the core group.
const LEG_MUSCLES = ['quads', 'quadriceps', 'hamstrings', 'calves', 'glutes', 'abductors', 'adductors', 'inner_thighs', 'legs', 'hips']
const CORE_MUSCLES = ['abs', 'obliques', 'core', 'transverse_abdominis', 'hip_flexors']

export interface TargetAreaOption {
  key: string
  label: string
  icon: string
  /** Filters the candidate pool to these muscles. Mutually exclusive with `pattern`. */
  muscles?: string[]
  /** Cardio isn't a muscle group — reuses the existing pattern-priority mechanism. */
  pattern?: MovementPattern
  /** "Pick for me" — no filter at all, Tempo's normal purpose-driven pick. Always first. */
  surprise?: boolean
}

export const TARGET_AREA_OPTIONS: TargetAreaOption[] = [
  { key: 'surprise', label: 'Pick for me', icon: 'shuffle-outline', surprise: true },
  { key: 'arms', label: 'Arms', icon: 'barbell-outline', muscles: ARM_MUSCLES },
  { key: 'chest', label: 'Chest', icon: 'shirt-outline', muscles: CHEST_MUSCLES },
  { key: 'back', label: 'Back', icon: 'body-outline', muscles: BACK_MUSCLES },
  { key: 'shoulders', label: 'Shoulders', icon: 'triangle-outline', muscles: SHOULDER_MUSCLES },
  { key: 'upper_body', label: 'Upper Body', icon: 'man-outline', muscles: [...CHEST_MUSCLES, ...UPPER_BACK_MUSCLES, ...SHOULDER_MUSCLES, ...ARM_MUSCLES] },
  { key: 'legs', label: 'Legs', icon: 'walk-outline', muscles: LEG_MUSCLES },
  { key: 'core', label: 'Core', icon: 'disc-outline', muscles: CORE_MUSCLES },
  { key: 'cardio', label: 'Cardio', icon: 'heart-outline', pattern: 'cardio' },
]

// ── Purpose schemes ───────────────────────────────────────────────────────────
// setSeconds = est. time to perform one working set; used only for time-budgeting.

interface PurposeScheme {
  sets: number
  repLow: number
  repHigh: number
  repUnit: 'reps' | 'sec'
  restSeconds: number
  setSeconds: number
  structure: 'straight_sets' | 'circuit'
  patternPriority: MovementPattern[]
  lowImpact: boolean
}

const PURPOSE_SCHEME: Record<QuickPurpose, PurposeScheme> = {
  muscle_growth: {
    sets: 3, repLow: 8, repHigh: 12, repUnit: 'reps', restSeconds: 70, setSeconds: 40,
    structure: 'straight_sets', patternPriority: ['squat', 'hinge', 'push', 'pull', 'core'], lowImpact: false,
  },
  strength_maintenance: {
    sets: 3, repLow: 4, repHigh: 6, repUnit: 'reps', restSeconds: 120, setSeconds: 35,
    structure: 'straight_sets', patternPriority: ['hinge', 'squat', 'push', 'pull'], lowImpact: false,
  },
  athletic: {
    sets: 3, repLow: 5, repHigh: 8, repUnit: 'reps', restSeconds: 90, setSeconds: 35,
    structure: 'straight_sets', patternPriority: ['squat', 'hinge', 'push', 'pull', 'cardio', 'core'], lowImpact: false,
  },
  conditioning: {
    sets: 3, repLow: 12, repHigh: 20, repUnit: 'reps', restSeconds: 30, setSeconds: 45,
    structure: 'circuit', patternPriority: ['cardio', 'squat', 'push', 'pull', 'core'], lowImpact: false,
  },
  recovery: {
    sets: 2, repLow: 10, repHigh: 15, repUnit: 'reps', restSeconds: 45, setSeconds: 40,
    structure: 'circuit', patternPriority: ['mobility', 'core', 'cardio', 'pull', 'push', 'squat', 'hinge'], lowImpact: true,
  },
  mobility: {
    sets: 2, repLow: 30, repHigh: 45, repUnit: 'sec', restSeconds: 25, setSeconds: 45,
    structure: 'circuit', patternPriority: ['mobility', 'core', 'hinge', 'squat', 'pull'], lowImpact: true,
  },
}

export const PURPOSE_META: Record<QuickPurpose, { label: string; icon: string; blurb: string }> = {
  strength_maintenance: { label: 'Strength', icon: 'barbell-outline', blurb: 'Keep your top-end strength sharp.' },
  muscle_growth:        { label: 'Muscle',   icon: 'fitness-outline', blurb: 'Hypertrophy-focused volume.' },
  recovery:             { label: 'Recovery', icon: 'leaf-outline',    blurb: 'Light blood flow, easy on the joints.' },
  mobility:             { label: 'Mobility', icon: 'body-outline',    blurb: 'Move well, loosen up, reset posture.' },
  conditioning:         { label: 'Conditioning', icon: 'flame-outline', blurb: 'Heart rate up, calories burning.' },
  athletic:             { label: 'Athletic', icon: 'flash-outline',   blurb: 'Power and explosiveness.' },
}

export function goalToPurpose(goal: Goal): QuickPurpose {
  switch (goal) {
    case 'muscle_gain': return 'muscle_growth'
    case 'strength': return 'strength_maintenance'
    case 'athletic': return 'athletic'
    case 'fat_loss': return 'conditioning'
    case 'general_fitness': return 'muscle_growth'
    default: return 'muscle_growth'
  }
}

const GOAL_NOUN: Record<Goal, string> = {
  muscle_gain: 'muscle-building',
  fat_loss: 'fat-loss',
  strength: 'strength',
  general_fitness: 'fitness',
  athletic: 'athletic',
}

// High-impact moves that are a poor fit for a quick, low-setup, low-impact session.
const HIGH_IMPACT_NAMES = new Set([
  'Box Jump', 'Burpee', 'Power Clean', 'Sumo Deadlift', 'Pause Squat', 'Weighted Pull-Up',
])

// Real resistance-training patterns — always fair game for a Target Area's
// forced-pattern list (see generateQuickWorkout below), regardless of which
// purpose is active. 'cardio' and 'mobility' are deliberately excluded here:
// they should only get force-included when the CURRENT purpose's own scheme
// already wants them (conditioning/athletic want cardio; recovery/mobility
// want mobility) — otherwise a muscle that happens to overlap with a cardio
// or stretch-pattern exercise (e.g. Jump Rope trains calves, a real leg
// muscle) drags an off-purpose exercise into an otherwise strength-focused
// session. Fixed 2026-08-02, founder-reported: picking "Legs" for a
// muscle-growth/strength session recommended Jump Rope purely because its
// primary_muscles include 'calves'.
const RESISTANCE_PATTERNS: MovementPattern[] = ['push', 'pull', 'squat', 'hinge', 'core', 'carry']

// ── Exercise model used internally ──────────────────────────────────────────

interface ExerciseRow {
  id: string
  name: string
  movement_pattern: string
  primary_muscles: string[]
  secondary_muscles: string[]
  required_equipment: string[]
  experience_level: string
  is_core?: boolean | null
  popularity?: number | null
}

const EXPERIENCE_ORDER: Experience[] = ['beginner', 'intermediate', 'advanced']

function dayOfYear(d = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d.getTime() - start.getTime()) / 86400000)
}

// One exercise's wall-clock cost in seconds (setup + sets + rest).
//
// This MUST agree with lib/durationEstimate.estimateSessionSec, because that is
// what the runner shows the user the moment the session opens. It previously
// didn't, in two ways that both flattered the builder: setup was 30s against the
// shared SETUP_SEC of 90, and rest was counted only BETWEEN sets (`sets - 1`)
// where the estimator counts one per set. On a 5-exercise session that is ~5
// minutes of unbudgeted setup plus 4 uncounted rest periods — which is why a
// "15-Minute Muscle Builder" opened reading "EST. 21 MINS" (observed 2026-07-22).
// Quick Workout's entire promise is that the session fits the window you gave it,
// so the budget now uses the shared constants and the same per-set accounting.
// `durationEstimate.ts` exists precisely because the optimistic maths was, in its
// own words, fantasy; this file simply hadn't adopted it.
//
// `scheme.setSeconds` is kept for work time (it is per-purpose — a cardio set is
// not a strength set) where the estimator falls back to a generic WORK_SEC.
function exerciseCostSeconds(scheme: PurposeScheme): number {
  return SETUP_SEC + scheme.sets * (scheme.setSeconds + scheme.restSeconds)
}

// Pick the highest-impact unused exercise of a pattern, rotated by `seed` for variety.
//
// `fam` puts movements the user has actually trained before ahead of ones they
// have never seen; `preferNew` inverts that for the single novelty slot (see
// exerciseFamiliarity.noveltySlotIndex). With no history every candidate ties on
// the familiarity key and the original impact/popularity/name ordering below is
// preserved exactly, so nothing changes for a new user.
function pickBest(
  pool: ExerciseRow[], used: Set<string>, seed: number,
  fam: FamiliarityIndex = NO_HISTORY, preferNew = false,
): ExerciseRow | null {
  const avail = pool.filter(e => !used.has(e.id))
  if (!avail.length) return null
  // Impact ≈ total muscles worked; staples beat long-tail variants; ties broken
  // stably by name.
  const sorted = [...avail].sort((a, b) => {
    const fm = byFamiliarity(a.id, b.id, fam, preferNew)
    if (fm !== 0) return fm
    const am = a.primary_muscles.length + a.secondary_muscles.length
    const bm = b.primary_muscles.length + b.secondary_muscles.length
    if (bm !== am) return bm - am
    const pop = (b.popularity ?? 30) - (a.popularity ?? 30)
    if (pop !== 0) return pop
    return a.name.localeCompare(b.name)
  })
  // Rotate the starting index so the same time/purpose doesn't always return the
  // identical lift day-to-day, while still favouring the top of the impact list.
  //
  // The rotation is confined to ONE familiarity tier. Rotating across the whole
  // sorted list would step straight past a lift the user knows onto one they have
  // never done — the "variety" knob quietly undoing the "familiar" one, which is
  // exactly what the first version of this did. Within a tier, rotation is
  // untouched, so day-to-day variety still works. With no history every candidate
  // is in the same tier and this is the original behaviour exactly.
  const knownTier = fam.sessions(sorted[0].id) > 0
  const tier = sorted.filter(e => (fam.sessions(e.id) > 0) === knownTier)
  const head = tier.slice(0, Math.min(3, tier.length))
  return head[seed % head.length]
}

interface BuiltSelection {
  exercises: QuickExercise[]
  estimatedSeconds: number
}

// How many unique exercises a session of this length can actually hold. Shared
// between selectExercises (which spends the budget) and generateQuickWorkout
// (which decides whether the curated candidate pool is even big enough to try).
function maxExercisesFor(minutes: QuickMinutes): number {
  return minutes <= 10 ? 4 : minutes <= 20 ? 5 : 8
}

function selectExercises(
  pool: ExerciseRow[],
  scheme: PurposeScheme,
  minutes: QuickMinutes,
  targetPattern: MovementPattern | undefined,
  seed: number,
  // A muscle-based Target Area (e.g. Arms) can land a pool that's ALL one
  // movement pattern — Arms' beginner/bodyweight matches are entirely
  // 'push' (dips, push-ups), and Mobility's own patternPriority doesn't
  // include 'push' at all (mobility work is stretch-pattern by design).
  // Without this, an explicit "give me an Arms workout" request could
  // silently produce ZERO exercises even though matches genuinely exist,
  // just because the current training style's pattern list doesn't cover
  // them. When set, this REPLACES the purpose's own priority so a real
  // muscle-targeted pick always surfaces something.
  forcePatterns: MovementPattern[] | undefined,
  fam: FamiliarityIndex = NO_HISTORY,
): BuiltSelection {
  const budget = minutes * 60
  const MAX = maxExercisesFor(minutes)
  // Which pick, if any, deliberately goes to something the user has never done.
  const noveltyAt = noveltySlotIndex(fam, MAX)

  // Short sessions get denser: fewer sets, shorter rest so the time is all work.
  //
  // The ≤20 tier is new (2026-07-22) and is the direct consequence of making
  // exerciseCostSeconds honest above. Under the old optimistic budget a 15-minute
  // request fit 3 full-rest exercises that actually ran ~20 minutes; under correct
  // accounting the same scheme fits only TWO, which reads as a thin workout rather
  // than a tight one. The real problem was never the exercise count — it was
  // spending 70s of a 15-minute window resting between every set. So a mid-length
  // window now trims rest and sets the way the ≤10 tier already did, just less
  // aggressively: ~3 exercises of genuine work, and an estimate the runner agrees
  // with. Trading rest for movements is the right call at this length; it is not
  // at 45+, where the full scheme still applies untouched.
  const tuned: PurposeScheme = minutes <= 10
    ? { ...scheme, sets: Math.min(scheme.sets, 2), restSeconds: Math.min(scheme.restSeconds, 40), structure: 'circuit' }
    : minutes <= 20
    ? { ...scheme, sets: Math.min(scheme.sets, 2), restSeconds: Math.min(scheme.restSeconds, 50) }
    : scheme

  const byPattern: Record<string, ExerciseRow[]> = {}
  for (const ex of pool) {
    (byPattern[ex.movement_pattern] ??= []).push(ex)
  }

  // A missed "leg day" (targetPattern) jumps to the front of the priority list.
  const priority: MovementPattern[] = forcePatterns?.length
    ? forcePatterns
    : targetPattern
    ? [targetPattern, ...tuned.patternPriority.filter(p => p !== targetPattern)]
    : tuned.patternPriority

  const cost = exerciseCostSeconds(tuned)
  const chosen: QuickExercise[] = []
  const used = new Set<string>()
  let spent = 0

  for (let round = 0; round < 4 && chosen.length < MAX; round++) {
    let addedThisRound = false
    for (const pattern of priority) {
      if (chosen.length >= MAX) break
      const cand = pickBest(
        byPattern[pattern] ?? [], used, seed + round,
        fam, chosen.length === noveltyAt,
      )
      if (!cand) continue
      // Always allow the first pick so even a 5-minute window yields a workout.
      if (chosen.length > 0 && spent + cost > budget) continue
      chosen.push({
        id: cand.id,
        name: cand.name,
        movement_pattern: cand.movement_pattern,
        primary_muscles: cand.primary_muscles,
        sets: tuned.sets,
        repLow: tuned.repLow,
        repHigh: tuned.repHigh,
        repUnit: tuned.repUnit,
        restSeconds: tuned.restSeconds,
      })
      used.add(cand.id)
      spent += cost
      addedThisRound = true
    }
    if (!addedThisRound) break
  }

  return { exercises: chosen, estimatedSeconds: spent }
}

// ── Copy generation ──────────────────────────────────────────────────────────

// Fixed 2026-08-02, founder-requested: "15-Minute Muscle Builder" read as a
// generic, uninformative label once Target Area picking existed — a workout
// actually targeting Legs deserves to say so. Format is body-part(s) +
// training-style noun ("Legs Strength", "Chest & Back Muscle"), falling back
// to "Full Body" when no Target Area is selected (Pick for me / Cardio-only).
function buildTitle(minutes: number, purpose: QuickPurpose, areaLabel?: string | null): string {
  const styleNoun = PURPOSE_META[purpose].label
  return `${minutes}-Minute ${areaLabel || 'Full Body'} ${styleNoun}`
}

function buildFocusLabel(exs: QuickExercise[]): string {
  const patterns = Array.from(new Set(exs.map(e => e.movement_pattern)))
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
  return `Quick · ${patterns.slice(0, 3).join('/') || 'Full Body'}`
}

function buildWhy(ctx: QuickContext, purpose: QuickPurpose): string {
  const { minutes, fromCalendarGap, daysSinceTrained, targetPattern } = ctx
  if (targetPattern && purpose === 'recovery') {
    return `You missed ${targetPattern} day — this is a lighter ${minutes}-minute version so you stay on track without overreaching.`
  }
  if (targetPattern) {
    return `Built around ${targetPattern} so the work you missed doesn't slip — condensed to fit your ${minutes} minutes.`
  }
  if (fromCalendarGap) {
    return `${BRAND_NAME} spotted a ${minutes}-minute gap in your day. This session is sized to fit it exactly — in and done before your next event.`
  }
  if (daysSinceTrained && daysSinceTrained >= 3) {
    return `It's been ${daysSinceTrained} days. A short, easy ${minutes}-minute restart beats waiting for the "perfect" session — momentum first.`
  }
  return `You've got ${minutes} minutes. ${BRAND_NAME} picked the highest-impact movements that fit, so none of it is wasted.`
}

function buildContribution(purpose: QuickPurpose, goal: Goal): string {
  const goalNoun = GOAL_NOUN[goal]
  switch (purpose) {
    case 'strength_maintenance':
      return `Even a few heavy sets tell your body to keep the strength you've built — protecting your ${goalNoun} progress between full sessions.`
    case 'muscle_growth':
      return `Short bouts of quality volume still drive growth. This keeps your weekly ${goalNoun} volume from dropping on a busy day.`
    case 'recovery':
      return `Light movement boosts blood flow and recovery, so you come back to your next full ${goalNoun} session fresher.`
    case 'mobility':
      return `Better range of motion means cleaner, safer lifts — directly improving the quality of your ${goalNoun} training.`
    case 'conditioning':
      return `A quick conditioning hit keeps your engine and calorie burn up, supporting your ${goalNoun} goal even on a packed day.`
    case 'athletic':
      return `Explosive work maintains power output, so your ${goalNoun} performance doesn't fade between full training days.`
  }
}

// ── Main entry: generate a Quick Workout ──────────────────────────────────────

export interface ProfileForQuick {
  goal: Goal
  experience: Experience
  equipment: string[]
  injuries?: string[]
}

// Fetch the bits of profile the engine needs. Degrades to sane defaults so a
// Quick Workout can always be produced (the whole point of the feature).
export async function getProfileForQuick(
  client: SupabaseClient,
  userId: string,
): Promise<ProfileForQuick> {
  // Core columns are guaranteed by schema.sql.
  const { data } = await client
    .from('user_profiles')
    .select('goal, experience, equipment')
    .eq('user_id', userId)
    .maybeSingle()

  // injuries is an optional column (add_injuries_to_user_profiles.sql). Read it
  // separately so a missing migration can never wipe out the real profile above.
  let injuries: string[] | undefined
  try {
    const { data: inj } = await client
      .from('user_profiles')
      .select('injuries')
      .eq('user_id', userId)
      .maybeSingle()
    injuries = (inj?.injuries as string[] | null) ?? undefined
  } catch {
    injuries = undefined
  }

  // If the user is travelling, program with the equipment they have right now
  // instead of their home setup — so a Quick Workout in a hotel uses the dumbbells
  // there, not the barbell at home.
  const { equipment } = await effectiveEquipment(client, userId, (data?.equipment ?? []) as string[])

  return {
    goal: (data?.goal ?? 'general_fitness') as Goal,
    experience: (data?.experience ?? 'beginner') as Experience,
    equipment,
    injuries,
  }
}

// Map free-text injury/area keywords to muscles + patterns to avoid. Best-effort
// and forgiving — an unknown keyword simply matches on muscle-name contains().
// Exported so plan generation applies the SAME safety filter as Quick Workouts.
export function injuriesToRestrictions(injuries: string[] | undefined): QuickRestrictions {
  const avoidMuscles: string[] = []
  const avoidPatterns: MovementPattern[] = []
  for (const raw of injuries ?? []) {
    const k = raw.toLowerCase()
    if (k.includes('knee')) { avoidMuscles.push('quads'); avoidPatterns.push('squat') }
    if (k.includes('back') || k.includes('spine')) { avoidMuscles.push('lower_back', 'erectors'); avoidPatterns.push('hinge') }
    if (k.includes('shoulder')) { avoidMuscles.push('shoulders', 'lateral_deltoids', 'rear_delts') }
    if (k.includes('elbow')) { avoidMuscles.push('triceps', 'biceps') }
    if (k.includes('wrist')) { avoidMuscles.push('forearms') }
    if (k.includes('hip')) { avoidMuscles.push('hip_flexors', 'glutes') }
    if (k.includes('hamstring')) { avoidMuscles.push('hamstrings') }
    if (k.includes('ankle') || k.includes('calf')) { avoidMuscles.push('calves') }
    // Always also treat the raw token as a muscle keyword.
    avoidMuscles.push(k)
  }
  return { avoidMuscles: Array.from(new Set(avoidMuscles)), avoidPatterns: Array.from(new Set(avoidPatterns)) }
}

// The movement patterns a plan "focus" label trains — used to avoid pre-empting a
// scheduled session (leg day tomorrow → don't burn legs on a Quick Workout today).
function focusToPatterns(focus: string): MovementPattern[] {
  const f = focus.toLowerCase()
  if (f.includes('leg') || f.includes('lower')) return ['squat', 'hinge']
  if (f.includes('upper')) return ['push', 'pull']
  if (f.includes('push') || f.includes('chest') || f.includes('shoulder')) return ['push']
  if (f.includes('pull') || f.includes('back')) return ['pull']
  return []
}

/**
 * Schedule-aware restrictions: avoid the movement patterns that are coming up SOON
 * (a session scheduled today→+2 days — don't pre-empt it) or were just trained
 * (completed since yesterday — still recovering), so a Quick Workout targets the next
 * READY thing instead. The caller merges this with injury restrictions. Best-effort:
 * any failure returns no restrictions (a workout is always produced).
 */
export async function getScheduleRestrictions(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<QuickRestrictions> {
  const avoid = new Set<MovementPattern>()
  try {
    const todayStr = toDateStr(now)
    const soon = new Date(now); soon.setDate(now.getDate() + 2)
    const yest = new Date(now); yest.setDate(now.getDate() - 1)
    const { data } = await client
      .from('scheduled_workouts')
      .select('focus, planned_date, status')
      .eq('user_id', userId)
      .gte('planned_date', toDateStr(yest))
      .lte('planned_date', toDateStr(soon))
    for (const row of (data ?? []) as { focus: string | null; planned_date: string; status: string }[]) {
      const upcoming = row.status === 'scheduled' && row.planned_date >= todayStr  // don't pre-empt it
      const recent = row.status === 'completed' && row.planned_date >= toDateStr(yest)   // still recovering
      if (!upcoming && !recent) continue
      for (const p of focusToPatterns(row.focus ?? '')) avoid.add(p)
    }
  } catch { /* best-effort — a Quick Workout must always be producible */ }
  return { avoidMuscles: [], avoidPatterns: [...avoid] }
}

export async function generateQuickWorkout(
  client: SupabaseClient,
  userId: string,
  ctx: QuickContext,
  profileOverride?: ProfileForQuick,
): Promise<QuickWorkout> {
  const profile = profileOverride ?? await getProfileForQuick(client, userId)
  const purpose = ctx.purpose ?? goalToPurpose(profile.goal)
  const scheme = PURPOSE_SCHEME[purpose]

  const restrictions = ctx.restrictions ?? injuriesToRestrictions(profile.injuries)

  // Candidate exercises: the curated core pool is tried FIRST (the full library
  // is mainly for search/manual building — a generated session prefers staples
  // for quality), matched to equipment + experience, then drop anything that
  // hits a restricted area, plus high-impact moves on low-impact purposes.
  const [{ data: allRaw }, excludedExerciseIds] = await Promise.all([
    client
      .from('exercises')
      .select('id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, is_core, popularity')
      .is('user_id', null),
    fetchExcludedExerciseIds(client, userId),
  ])

  const allRows = ((allRaw ?? []) as ExerciseRow[]).filter(ex => !excludedExerciseIds.has(ex.id))
  const coreRows = allRows.filter(e => e.is_core === true)
  const userExpIdx = EXPERIENCE_ORDER.indexOf(profile.experience)
  const validExp = new Set(EXPERIENCE_ORDER.slice(0, userExpIdx + 1))
  const equipment = expandEquipment(profile.equipment)
  const avoidMuscle = new Set(restrictions.avoidMuscles)
  const avoidPattern = new Set(restrictions.avoidPatterns)

  const matchesConstraints = (ex: ExerciseRow) => {
    if (!validExp.has(ex.experience_level as Experience)) return false
    if (!canPerform(ex, equipment)) return false
    if (avoidPattern.has(ex.movement_pattern as MovementPattern)) return false
    const muscles = [...ex.primary_muscles, ...ex.secondary_muscles]
    if (muscles.some(m => avoidMuscle.has(m))) return false
    if (scheme.lowImpact && (ex.experience_level === 'advanced' || HIGH_IMPACT_NAMES.has(ex.name))) return false
    return true
  }
  const corePool = (coreRows.length ? coreRows : allRows).filter(matchesConstraints)
  // Only computed from — and used against — the full 1300+ imported library, so
  // a well-stocked curated hit (the common case) never pays this extra pass.
  const fullPool = () => allRows.filter(matchesConstraints)

  // Target Area (Arms/Chest/Back/…): a hard filter to that muscle group, not
  // just a priority nudge — this is a direct "give me an X workout" request.
  const targetMuscles = ctx.targetMuscles?.length ? new Set(ctx.targetMuscles) : null

  // Match on the exercise's DOMINANT muscle — `primary_muscles[0]`, which this
  // catalogue orders most-worked-first — not on "any listed primary muscle".
  //
  // Matching any primary is far too loose, and produced three separate wrong
  // sessions the founder actually received on 2026-09-04. Barbell Bench Press is
  // `['chest','triceps']`, so it satisfied an ARMS request; Push-Up is
  // `['chest','triceps','shoulders']`, same. Conventional Deadlift is
  // `['hamstrings','glutes','erectors']`, so it satisfied a BACK request. In each
  // case the exercise's actual purpose is the first muscle and the rest are
  // along for the ride.
  //
  // `pickBest` ranks by how many muscles an exercise works, so a compound will
  // always outrank a true isolation for the target — which is exactly why this
  // has to be a filter and cannot be a sort preference. The loose rule is kept
  // only as a last resort, for when NOTHING in the catalogue dominantly trains
  // the requested area, so a target still never returns an empty pool.
  const dominantlyMatches = (ex: ExerciseRow) =>
    !!targetMuscles && targetMuscles.has(ex.primary_muscles[0] ?? '')
  const looselyMatches = (ex: ExerciseRow) =>
    !!targetMuscles && ex.primary_muscles.some(m => targetMuscles.has(m))

  const filterByMuscle = (rows: ExerciseRow[]) => {
    if (!targetMuscles) return rows
    const dominant = rows.filter(dominantlyMatches)
    return dominant.length ? dominant : rows.filter(looselyMatches)
  }

  const coreMusclePool = filterByMuscle(corePool)
  // The 60-exercise curated set is deliberately small (is_core's own comment:
  // "the plan/quick-workout engines only program from this pool") and is
  // sometimes too thin for a specific muscle group + equipment combo — e.g. it
  // has ZERO genuinely no-equipment "pull" exercise at all, so a no-equipment
  // "Back" or "Arms" request used to come up empty against it and silently drop
  // the muscle target entirely (falling through to an unfiltered full-body pick,
  // which for no-equipment users skews heavily toward Core/Plank-type moves —
  // the reported "it always gives me Core no matter what I pick" bug). Widen to
  // the full imported library — muscle-filtered the SAME way — whenever the
  // curated pool alone can't fill the requested session length. This only ever
  // ADDS candidates, and only when a real target is active, so a well-equipped
  // user hitting the curated set fully still gets the higher-quality staples only.
  const wideMusclePool = targetMuscles && coreMusclePool.length < maxExercisesFor(ctx.minutes)
    ? filterByMuscle(fullPool())
    : coreMusclePool
  const musclePool = wideMusclePool.length > coreMusclePool.length ? wideMusclePool : coreMusclePool
  const muscleTargetHit = !!targetMuscles && musclePool.length > 0
  // Nothing anywhere (curated OR full library) matches this muscle target given
  // the user's equipment/experience/restrictions — fall back to a full-body pick
  // so a workout is always produced, preferring the wider library over just the
  // 60 staples since it's strictly more likely to have something usable.
  const finalPool = musclePool.length ? musclePool : (corePool.length ? corePool : fullPool())
  // When the muscle filter actually landed exercises, guarantee every REAL
  // RESISTANCE pattern present among THEM gets picked from, regardless of the
  // purpose's own pattern list — a muscle-targeted request must never come
  // back empty just because e.g. Mobility's priority doesn't include 'push'.
  // 'cardio'/'mobility' are only force-included when the ACTIVE purpose's own
  // scheme already wants them — see RESISTANCE_PATTERNS' comment for why.
  const forcePatterns = muscleTargetHit
    ? [...new Set(musclePool.map(ex => ex.movement_pattern as MovementPattern))]
        .filter(p => RESISTANCE_PATTERNS.includes(p) || scheme.patternPriority.includes(p))
    : undefined

  const seed = dayOfYear() + ctx.minutes
  // What this user has actually trained before, so the session is built from
  // movements they know rather than whatever ranks highest in the abstract.
  const familiarity = await loadFamiliarity(client, userId)
  const { exercises, estimatedSeconds } = selectExercises(
    finalPool, scheme, ctx.minutes, ctx.targetPattern, seed, forcePatterns, familiarity,
  )

  return {
    minutes: ctx.minutes,
    purpose,
    title: buildTitle(ctx.minutes, purpose, ctx.targetAreaLabel),
    why: buildWhy(ctx, purpose),
    contribution: buildContribution(purpose, profile.goal),
    structure: scheme.structure,
    exercises,
    estimatedMinutes: Math.max(1, Math.round(estimatedSeconds / 60)),
    focusLabel: buildFocusLabel(exercises),
  }
}

// Persist a generated Quick Workout as a scheduled_workout for *today, now*, so it
// flows through the existing session player + counts toward streak/consistency.
// user_plan_id is left null — these ad-hoc sessions are intentionally excluded
// from the "missed workout" sweep (see lib/missedWorkouts).
//
// If a plan-based workout exists for today and covers similar movement patterns as
// the quick session, it's rescheduled to tomorrow so the day doesn't show two
// conflicting entries. A wholly different pattern pair (e.g. quick=push, plan=legs)
// is kept — both sessions are genuinely useful.
export async function persistQuickWorkout(
  client: SupabaseClient,
  userId: string,
  workout: QuickWorkout,
): Promise<string | null> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const planned_date = toDateStr(now)
  const planned_start_time = `${pad(now.getHours())}:${pad(now.getMinutes())}:00`

  // Check for an existing plan-based workout today
  try {
    const { data: todayPlanned } = await client
      .from('scheduled_workouts')
      .select('id, focus, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider')
      .eq('user_id', userId)
      .eq('planned_date', planned_date)
      .eq('status', 'scheduled')
      .not('user_plan_id', 'is', null)
      .limit(1)

    if (todayPlanned?.length) {
      const quickPatterns = new Set(workout.exercises.map(e => e.movement_pattern))
      const plannedFocus = (todayPlanned[0].focus as string).toLowerCase()
      // Detect rough overlap: planned focus label contains a pattern the quick session uses
      const overlaps = Array.from(quickPatterns).some(p => plannedFocus.includes(p) || plannedFocus.includes('full body'))

      if (overlaps) {
        const planned = todayPlanned[0] as {
          id: string; focus: string; planned_start_time: string; planned_duration_min: number
          calendar_event_id: string | null; calendar_provider: 'google' | 'device' | null
        }
        // Move the planned workout out — day after tomorrow by default (skip
        // tomorrow to avoid back-to-back), but the one-plan-per-day partial
        // unique index means that date might already hold another 'scheduled'
        // plan row. Try a few candidate dates rather than letting the move
        // fail silently and leave the planned workout stranded on today.
        let moved: { date: string } | null = null
        for (let offset = 2; offset <= 9; offset++) {
          const candidate = new Date(now)
          candidate.setDate(now.getDate() + offset)
          const candidateDate = toDateStr(candidate)
          const { data: occupied } = await client
            .from('scheduled_workouts')
            .select('id')
            .eq('user_id', userId)
            .eq('planned_date', candidateDate)
            .eq('status', 'scheduled')
            .not('user_plan_id', 'is', null)
            .limit(1)
          if (occupied?.length) continue
          const { error } = await client
            .from('scheduled_workouts')
            .update({ planned_date: candidateDate, status: 'scheduled' })
            .eq('id', planned.id)
          if (!error) moved = { date: candidateDate }
          break
        }
        if (moved) {
          // Keep the calendar event + pre-workout reminder pointed at wherever
          // the plan workout actually landed — the move used to skip this
          // entirely, leaving a "ghost" calendar event on today and a
          // reminder buzz for a session that's no longer there.
          resyncMovedWorkout(client, userId, {
            id: planned.id,
            focus: planned.focus,
            planned_date: moved.date,
            planned_start_time: planned.planned_start_time,
            planned_duration_min: planned.planned_duration_min,
            calendar_event_id: planned.calendar_event_id,
            calendar_provider: planned.calendar_provider,
          }).catch(() => {})
        } else {
          captureApiError('persistQuickWorkout.moveConflictingPlan', new Error('no open date found'), { userId })
        }
      }
    }
  } catch {
    // Adjustment is best-effort — never block the quick workout from starting
  }

  const { data, error } = await client
    .from('scheduled_workouts')
    .insert({
      user_id: userId,
      user_plan_id: null,
      planned_date,
      planned_start_time,
      planned_duration_min: workout.minutes,
      focus: workout.title,
      status: 'scheduled',
      source: 'quick',
      exercise_ids: workout.exercises.map(e => e.id),
    })
    .select('id')
    .single()

  // Throw the real failure — the caller's copy distinguishes offline from an
  // expired session, which a bare null can't.
  if (error) throw error
  if (!data) return null
  return data.id as string
}

// Largest preset duration that fits within `target` minutes — lets the smart
// scheduler reuse the Quick engine for, say, a 45-min slot (→ a 40-min session).
export function snapToQuickMinutes(target: number): QuickMinutes {
  let best: QuickMinutes = QUICK_DURATIONS[0]
  for (const d of QUICK_DURATIONS) if (d <= target) best = d
  return best
}

// Persist a generated session to a SPECIFIC date/time (used by the Smart
// Scheduler), optionally linking the Google Calendar event it was synced to.
// Same shape as persistQuickWorkout but you control when it lands, the duration
// shown, and the focus label. user_plan_id stays null — these are ad-hoc
// sessions, excluded from the "missed workout" sweep like Quick Workouts.
export async function persistPlannedWorkout(
  client: SupabaseClient,
  userId: string,
  workout: QuickWorkout,
  opts: {
    plannedDate: string         // 'YYYY-MM-DD'
    plannedStartTime: string    // 'HH:MM:SS'
    durationMin: number
    focus?: string
    calendarEventId?: string | null
    calendarProvider?: 'google' | 'device' | null
    source?: 'plan' | 'quick' | 'smart'
  },
): Promise<string | null> {
  const { data, error } = await client
    .from('scheduled_workouts')
    .insert({
      user_id: userId,
      user_plan_id: null,
      planned_date: opts.plannedDate,
      planned_start_time: opts.plannedStartTime,
      planned_duration_min: opts.durationMin,
      focus: opts.focus ?? workout.title,
      status: 'scheduled',
      // Defaults to 'smart' — the Smart Scheduler is this function's only caller.
      source: opts.source ?? 'smart',
      exercise_ids: workout.exercises.map(e => e.id),
      calendar_event_id: opts.calendarEventId ?? null,
      // Default to 'google' when an event was created but provider wasn't given —
      // the Smart Scheduler (the caller) syncs to Google Calendar.
      calendar_provider: opts.calendarProvider ?? (opts.calendarEventId ? 'google' : null),
    })
    .select('id')
    .single()

  if (error || !data) return null
  return data.id as string
}
