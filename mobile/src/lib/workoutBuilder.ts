// Tempo — user workout builder.
//
// Turns a user-assembled list of exercises (with per-exercise sets/reps/weight/
// duration/distance) into a saved template and/or a scheduled session. Scheduled
// custom workouts are normal `scheduled_workouts` rows (source='custom') with the
// chosen prescription stored in `exercise_config`, so they render in the calendar
// feed and the workout player honors the targets the user set.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Exercise, MetricKey, WorkoutExerciseConfig, WorkoutTemplate } from '@/types'
import { EXERCISE_COLUMNS, metricsFor } from './customExercises'
import { estimateSessionMin } from './durationEstimate'

export interface DraftItem {
  exercise: Exercise
  sets: number
  repLow: number
  repHigh: number
  weightLbs: number | null
  durationSec: number | null
  distanceM: number | null
  metrics: MetricKey[]
}

export function makeDraftItem(exercise: Exercise): DraftItem {
  const metrics = metricsFor(exercise)
  return {
    exercise,
    sets: 3,
    // A single rep target reads cleanly in both the builder and the runner; the
    // user can change it. (Plan/Quick workouts still use ranges via their own logic.)
    repLow: 10,
    repHigh: 10,
    weightLbs: null,
    durationSec: metrics.includes('duration') ? 60 : null,
    distanceM: null,
    metrics,
  }
}

export function itemToConfig(item: DraftItem): WorkoutExerciseConfig {
  return {
    exercise_id: item.exercise.id,
    sets: item.sets,
    rep_low: item.repLow,
    rep_high: item.repHigh,
    weight_lbs: item.weightLbs,
    duration_sec: item.durationSec,
    distance_m: item.distanceM,
    metrics: item.metrics,
  }
}

// Realistic session length so the calendar block + reminders are honest — rests
// at real lengths plus setup/transition time per exercise (see lib/durationEstimate;
// the old "40s work + 75s rest" formula under-shot hour-long sessions by ~40%).
export function estimateDurationMin(items: DraftItem[]): number {
  return estimateSessionMin(items.map((it) => ({
    sets: it.sets,
    workSec: it.metrics.includes('duration') && it.durationSec ? it.durationSec : null,
    restSec: null, // default rest — the builder doesn't prescribe rests
  })))
}

// ── Templates ────────────────────────────────────────────────────────────────

export async function fetchTemplates(client: SupabaseClient, userId: string): Promise<WorkoutTemplate[]> {
  const { data } = await client
    .from('workout_templates')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  return (data ?? []) as WorkoutTemplate[]
}

// How many saved workout templates this user has (for the free-tier cap — proLimits).
export async function countTemplates(client: SupabaseClient, userId: string): Promise<number> {
  const { count } = await client
    .from('workout_templates')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}

export async function saveTemplate(
  client: SupabaseClient,
  userId: string,
  args: { name: string; items: DraftItem[]; notes?: string | null; templateId?: string | null },
): Promise<string | null> {
  const name = args.name.trim()
  if (!name || args.items.length === 0) return null
  const row = {
    user_id: userId,
    name,
    exercise_ids: args.items.map((i) => i.exercise.id),
    config: args.items.map(itemToConfig),
    notes: args.notes?.trim() || null,
    est_duration_min: estimateDurationMin(args.items),
    updated_at: new Date().toISOString(),
  }
  if (args.templateId) {
    const { error } = await client.from('workout_templates').update(row).eq('id', args.templateId)
    return error ? null : args.templateId
  }
  const { data, error } = await client.from('workout_templates').insert(row).select('id').single()
  return error ? null : (data?.id ?? null)
}

export async function deleteTemplate(client: SupabaseClient, templateId: string): Promise<boolean> {
  const { error } = await client.from('workout_templates').delete().eq('id', templateId)
  return !error
}

export async function duplicateTemplate(
  client: SupabaseClient,
  userId: string,
  template: WorkoutTemplate,
): Promise<string | null> {
  const { data, error } = await client
    .from('workout_templates')
    .insert({
      user_id: userId,
      name: `${template.name} (copy)`,
      exercise_ids: template.exercise_ids,
      config: template.config,
      notes: template.notes,
      est_duration_min: template.est_duration_min,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  return error ? null : (data?.id ?? null)
}

// Re-hydrate a saved template into editable draft items (fetches the exercise rows,
// preserving the template's exercise order and dropping any that were deleted).
export async function templateToItems(client: SupabaseClient, template: WorkoutTemplate): Promise<DraftItem[]> {
  if (!template.exercise_ids.length) return []
  const { data } = await client.from('exercises').select(EXERCISE_COLUMNS).in('id', template.exercise_ids)
  const byId = new Map((data ?? []).map((e: any) => [e.id, e as Exercise]))
  const items: DraftItem[] = []
  for (const cfg of template.config) {
    const ex = byId.get(cfg.exercise_id)
    if (!ex) continue
    items.push({
      exercise: ex,
      sets: cfg.sets,
      repLow: cfg.rep_low,
      repHigh: cfg.rep_high,
      weightLbs: cfg.weight_lbs,
      durationSec: cfg.duration_sec,
      distanceM: cfg.distance_m,
      metrics: cfg.metrics?.length ? cfg.metrics : metricsFor(ex),
    })
  }
  return items
}

// ── Scheduling ───────────────────────────────────────────────────────────────

export async function scheduleWorkout(
  client: SupabaseClient,
  userId: string,
  args: {
    name: string
    items: DraftItem[]
    plannedDate: string       // 'YYYY-MM-DD'
    plannedStartTime: string  // 'HH:MM:SS'
    durationMin?: number
  },
): Promise<string | null> {
  const name = args.name.trim()
  if (!name || args.items.length === 0) return null
  const { data, error } = await client
    .from('scheduled_workouts')
    .insert({
      user_id: userId,
      planned_date: args.plannedDate,
      planned_start_time: args.plannedStartTime,
      planned_duration_min: args.durationMin ?? estimateDurationMin(args.items),
      focus: name,
      status: 'scheduled',
      source: 'custom',
      exercise_ids: args.items.map((i) => i.exercise.id),
      exercise_config: args.items.map(itemToConfig),
    })
    .select('id')
    .single()
  return error ? null : (data?.id ?? null)
}
