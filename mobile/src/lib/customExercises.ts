// Tempo — custom exercises.
//
// User-created exercises live in the same `exercises` table as the built-in library
// (with user_id set + is_custom = true), so they work everywhere an exercise_id is
// used: workout building, scheduling, logging, PRs, progress, and analytics. RLS
// keeps each user's custom exercises private; built-ins (user_id IS NULL) stay public.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Exercise, MovementPattern, MetricKey, Equipment } from '@/types'

// Every column the app reads for an exercise (built-in or custom).
export const EXERCISE_COLUMNS =
  'id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, video_url, instructions, substitute_ids, user_id, is_custom, category, notes, tracking_metrics, is_core, popularity, muscle_group'

// Categories shown in the custom-exercise creator. Each maps to a movement_pattern
// the engine already understands (so custom exercises slot into substitutions etc.).
export const EXERCISE_CATEGORIES: { id: MovementPattern; label: string; icon: string }[] = [
  { id: 'push', label: 'Push', icon: 'arrow-up-outline' },
  { id: 'pull', label: 'Pull', icon: 'arrow-down-outline' },
  { id: 'squat', label: 'Squat / Legs', icon: 'barbell-outline' },
  { id: 'hinge', label: 'Hinge', icon: 'body-outline' },
  { id: 'core', label: 'Core', icon: 'fitness-outline' },
  { id: 'carry', label: 'Carry', icon: 'walk-outline' },
  { id: 'cardio', label: 'Cardio', icon: 'heart-outline' },
  { id: 'mobility', label: 'Mobility', icon: 'accessibility-outline' },
]

export const METRIC_OPTIONS: { id: MetricKey; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'reps', label: 'Reps' },
  { id: 'duration', label: 'Duration' },
  { id: 'distance', label: 'Distance' },
  { id: 'rpe', label: 'RPE / effort' },
]

export interface CustomExerciseInput {
  name: string
  movement_pattern: MovementPattern
  category?: string | null
  notes?: string | null
  required_equipment?: Equipment[]
  primary_muscles?: string[]
  tracking_metrics?: MetricKey[]
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: 'has_history' | 'error' }

// Default metrics when the user doesn't pick any — strength-style logging.
const DEFAULT_METRICS: MetricKey[] = ['weight', 'reps']

export async function createCustomExercise(
  client: SupabaseClient,
  userId: string,
  input: CustomExerciseInput,
): Promise<Exercise | null> {
  const name = input.name.trim()
  if (!name) return null
  const { data, error } = await client
    .from('exercises')
    .insert({
      user_id: userId,
      is_custom: true,
      name,
      movement_pattern: input.movement_pattern,
      category: input.category ?? null,
      notes: input.notes?.trim() || null,
      required_equipment: input.required_equipment?.length ? input.required_equipment : ['bodyweight'],
      primary_muscles: input.primary_muscles ?? [],
      secondary_muscles: [],
      experience_level: 'beginner',
      instructions: input.notes?.trim() ? [input.notes.trim()] : [],
      tracking_metrics: input.tracking_metrics?.length ? input.tracking_metrics : DEFAULT_METRICS,
    })
    .select(EXERCISE_COLUMNS)
    .single()
  if (error) return null
  return data as Exercise
}

export async function updateCustomExercise(
  client: SupabaseClient,
  exerciseId: string,
  input: CustomExerciseInput,
): Promise<boolean> {
  const name = input.name.trim()
  if (!name) return false
  const { error } = await client
    .from('exercises')
    .update({
      name,
      movement_pattern: input.movement_pattern,
      category: input.category ?? null,
      notes: input.notes?.trim() || null,
      required_equipment: input.required_equipment?.length ? input.required_equipment : ['bodyweight'],
      primary_muscles: input.primary_muscles ?? [],
      instructions: input.notes?.trim() ? [input.notes.trim()] : [],
      tracking_metrics: input.tracking_metrics?.length ? input.tracking_metrics : DEFAULT_METRICS,
    })
    .eq('id', exerciseId)
  return !error
}

// Deleting is blocked by the set_logs FK once an exercise has logged history, so we
// surface that as a typed reason instead of a raw error.
export async function deleteCustomExercise(client: SupabaseClient, exerciseId: string): Promise<DeleteResult> {
  const { error } = await client.from('exercises').delete().eq('id', exerciseId)
  if (!error) return { ok: true }
  if ((error.code === '23503') || /foreign key/i.test(error.message)) return { ok: false, reason: 'has_history' }
  return { ok: false, reason: 'error' }
}

export async function fetchCustomExercises(client: SupabaseClient, userId: string): Promise<Exercise[]> {
  const { data } = await client
    .from('exercises')
    .select(EXERCISE_COLUMNS)
    .eq('user_id', userId)
    .order('name')
  return (data ?? []) as Exercise[]
}

// A movement done with only your own body has no external load — logging it in
// POUNDS is meaningless. Such moves track reps (or, for isometric holds, seconds),
// never weight.
function isBodyweightOnly(ex: Pick<Exercise, 'required_equipment'>): boolean {
  const eq = ex.required_equipment
  return Array.isArray(eq) && eq.length === 1 && eq[0] === 'bodyweight'
}

// Isometric holds are timed, not counted. Detected by name and deliberately
// conservative: dynamic variants (a Handstand PUSH-UP, "Front Lever Reps", plank
// taps) are excluded first, so they fall through to reps rather than seconds.
const HOLD_RE = /\bplank\b|\bhold\b|wall\s*sit|sit\s*\(wall\)|dead\s*hang|\bl[\s-]?sit\b|handstand|planche|\blever\b|\bflag\b|maltese|iron\s*cross|hollow\s*body/i
const HOLD_EXCLUDE_RE = /push[\s-]?up|\breps?\b|climber|\btap\b|\braise\b|\bto\s+(side|lower|cobra|overhead)\b/i

function isIsometricHold(name: string | null | undefined): boolean {
  const n = name ?? ''
  if (!n || HOLD_EXCLUDE_RE.test(n)) return false
  return HOLD_RE.test(n)
}

// The metrics a given exercise logs (defaults to weight+reps for built-ins).
export function metricsFor(exercise: Pick<Exercise, 'tracking_metrics' | 'movement_pattern' | 'required_equipment' | 'name'>): MetricKey[] {
  if (exercise.tracking_metrics && exercise.tracking_metrics.length) return exercise.tracking_metrics
  if (exercise.movement_pattern === 'cardio') return ['duration', 'distance']
  if (exercise.movement_pattern === 'mobility') return ['duration']
  if (isBodyweightOnly(exercise)) return isIsometricHold(exercise.name) ? ['duration'] : ['reps']
  return DEFAULT_METRICS
}
