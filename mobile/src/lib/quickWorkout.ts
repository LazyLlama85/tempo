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
  | 'push' | 'pull' | 'hinge' | 'squat' | 'carry' | 'core' | 'cardio'

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
  title: string          // "15-Minute Strength Primer"
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
  targetPattern?: MovementPattern // e.g. a missed "leg day" → bias squat/hinge
  daysSinceTrained?: number       // colours the "why" copy
  fromCalendarGap?: boolean       // "you have N free minutes" framing
  restrictions?: QuickRestrictions
}

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
    structure: 'circuit', patternPriority: ['core', 'cardio', 'pull', 'push', 'squat', 'hinge'], lowImpact: true,
  },
  mobility: {
    sets: 2, repLow: 30, repHigh: 45, repUnit: 'sec', restSeconds: 25, setSeconds: 45,
    structure: 'circuit', patternPriority: ['core', 'hinge', 'squat', 'pull'], lowImpact: true,
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

// ── Exercise model used internally ──────────────────────────────────────────

interface ExerciseRow {
  id: string
  name: string
  movement_pattern: string
  primary_muscles: string[]
  secondary_muscles: string[]
  required_equipment: string[]
  experience_level: string
}

const EXPERIENCE_ORDER: Experience[] = ['beginner', 'intermediate', 'advanced']

function dayOfYear(d = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d.getTime() - start.getTime()) / 86400000)
}

// One exercise's wall-clock cost in seconds (setup + sets + inter-set rest).
function exerciseCostSeconds(scheme: PurposeScheme): number {
  const SETUP = 30
  return SETUP + scheme.sets * scheme.setSeconds + Math.max(0, scheme.sets - 1) * scheme.restSeconds
}

// Pick the highest-impact unused exercise of a pattern, rotated by `seed` for variety.
function pickBest(pool: ExerciseRow[], used: Set<string>, seed: number): ExerciseRow | null {
  const avail = pool.filter(e => !used.has(e.id))
  if (!avail.length) return null
  // Impact ≈ total muscles worked; ties broken stably by name.
  const sorted = [...avail].sort((a, b) => {
    const am = a.primary_muscles.length + a.secondary_muscles.length
    const bm = b.primary_muscles.length + b.secondary_muscles.length
    if (bm !== am) return bm - am
    return a.name.localeCompare(b.name)
  })
  // Rotate the starting index so the same time/purpose doesn't always return the
  // identical lift day-to-day, while still favouring the top of the impact list.
  const head = sorted.slice(0, Math.min(3, sorted.length))
  return head[seed % head.length]
}

interface BuiltSelection {
  exercises: QuickExercise[]
  estimatedSeconds: number
}

function selectExercises(
  pool: ExerciseRow[],
  scheme: PurposeScheme,
  minutes: QuickMinutes,
  targetPattern: MovementPattern | undefined,
  seed: number,
): BuiltSelection {
  const budget = minutes * 60
  const MAX = minutes <= 10 ? 4 : minutes <= 20 ? 5 : 8

  // Short sessions get denser: fewer sets, shorter rest so the time is all work.
  const tuned: PurposeScheme = minutes <= 10
    ? { ...scheme, sets: Math.min(scheme.sets, 2), restSeconds: Math.min(scheme.restSeconds, 40), structure: 'circuit' }
    : scheme

  const byPattern: Record<string, ExerciseRow[]> = {}
  for (const ex of pool) {
    (byPattern[ex.movement_pattern] ??= []).push(ex)
  }

  // A missed "leg day" (targetPattern) jumps to the front of the priority list.
  const priority: MovementPattern[] = targetPattern
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
      const cand = pickBest(byPattern[pattern] ?? [], used, seed + round)
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

function buildTitle(minutes: number, purpose: QuickPurpose): string {
  const map: Record<QuickPurpose, string> = {
    strength_maintenance: 'Strength Primer',
    muscle_growth: 'Muscle Builder',
    recovery: 'Recovery Flush',
    mobility: 'Mobility Reset',
    conditioning: 'Conditioning Burst',
    athletic: 'Power Session',
  }
  return `${minutes}-Minute ${map[purpose]}`
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
    return `Tempo spotted a ${minutes}-minute gap in your day. This session is sized to fit it exactly — in and done before your next event.`
  }
  if (daysSinceTrained && daysSinceTrained >= 3) {
    return `It's been ${daysSinceTrained} days. A short, easy ${minutes}-minute restart beats waiting for the "perfect" session — momentum first.`
  }
  return `You've got ${minutes} minutes. Tempo picked the highest-impact movements that fit, so none of it is wasted.`
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

  return {
    goal: (data?.goal ?? 'general_fitness') as Goal,
    experience: (data?.experience ?? 'beginner') as Experience,
    equipment: (data?.equipment ?? []) as string[],
    injuries,
  }
}

// Map free-text injury/area keywords to muscles + patterns to avoid. Best-effort
// and forgiving — an unknown keyword simply matches on muscle-name contains().
function injuriesToRestrictions(injuries: string[] | undefined): QuickRestrictions {
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

  // Candidate exercises: match equipment + experience, then drop anything that
  // hits a restricted area, plus high-impact moves on low-impact purposes.
  const { data: allRaw } = await client
    .from('exercises')
    .select('id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level')

  const all = (allRaw ?? []) as ExerciseRow[]
  const userExpIdx = EXPERIENCE_ORDER.indexOf(profile.experience)
  const validExp = new Set(EXPERIENCE_ORDER.slice(0, userExpIdx + 1))
  const equipment = new Set<string>([...profile.equipment, 'bodyweight'])
  const avoidMuscle = new Set(restrictions.avoidMuscles)
  const avoidPattern = new Set(restrictions.avoidPatterns)

  const pool = all.filter(ex => {
    if (!validExp.has(ex.experience_level as Experience)) return false
    if (!ex.required_equipment.some(eq => equipment.has(eq))) return false
    if (avoidPattern.has(ex.movement_pattern as MovementPattern)) return false
    const muscles = [...ex.primary_muscles, ...ex.secondary_muscles]
    if (muscles.some(m => avoidMuscle.has(m))) return false
    if (scheme.lowImpact && (ex.experience_level === 'advanced' || HIGH_IMPACT_NAMES.has(ex.name))) return false
    return true
  })

  const seed = dayOfYear() + ctx.minutes
  const { exercises, estimatedSeconds } = selectExercises(pool, scheme, ctx.minutes, ctx.targetPattern, seed)

  return {
    minutes: ctx.minutes,
    purpose,
    title: buildTitle(ctx.minutes, purpose),
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
  const planned_date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const planned_start_time = `${pad(now.getHours())}:${pad(now.getMinutes())}:00`

  // Check for an existing plan-based workout today
  try {
    const { data: todayPlanned } = await client
      .from('scheduled_workouts')
      .select('id, focus')
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
        // Move the planned workout to the day after tomorrow (skip tomorrow to avoid back-to-back)
        const nextSlot = new Date(now)
        nextSlot.setDate(now.getDate() + 2)
        const nextDate = `${nextSlot.getFullYear()}-${pad(nextSlot.getMonth() + 1)}-${pad(nextSlot.getDate())}`
        await client
          .from('scheduled_workouts')
          .update({ planned_date: nextDate, status: 'scheduled' })
          .eq('id', todayPlanned[0].id)
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
      exercise_ids: workout.exercises.map(e => e.id),
    })
    .select('id')
    .single()

  if (error || !data) return null
  return data.id as string
}
