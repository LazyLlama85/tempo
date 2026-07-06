// Tempo — starter templates (workouts + splits).
//
// App-provided starting points so a user never faces a blank builder. Workout
// presets reference the seeded built-in exercises (fixed UUIDs); split presets
// reference workout presets by id — so the two layers correspond: building a split
// from a preset also saves each of its workouts into the user's library.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Exercise } from '@/types'
import { EXERCISE_COLUMNS, metricsFor } from './customExercises'
import { type DraftItem, makeDraftItem, itemToConfig, estimateDurationMin } from './workoutBuilder'

const UUID = (s: string) => `00000000-0000-0000-0000-0000000000${s}`

export interface PresetExercise { uuid: string; sets: number; repLow: number; repHigh: number }
export interface WorkoutPreset { id: string; name: string; focus: string; exercises: PresetExercise[] }
export interface SplitPreset {
  id: string
  name: string
  description: string
  // 7 entries, Mon(1)…Sun(7). presetId null = rest day.
  days: { weekday: number; presetId: string | null }[]
}

const e = (uuid: string, sets: number, repLow: number, repHigh: number): PresetExercise => ({ uuid, sets, repLow, repHigh })

// ── Workout presets ────────────────────────────────────────────────────────────
export const WORKOUT_PRESETS: WorkoutPreset[] = [
  {
    id: 'push', name: 'Push Day', focus: 'Push',
    exercises: [e(UUID('18'), 4, 6, 8), e(UUID('20'), 3, 8, 10), e(UUID('33'), 3, 8, 10), e(UUID('15'), 3, 12, 15), e(UUID('13'), 3, 10, 12), e(UUID('31'), 3, 8, 12)],
  },
  {
    id: 'pull', name: 'Pull Day', focus: 'Pull',
    exercises: [e(UUID('21'), 4, 6, 8), e(UUID('30'), 3, 6, 10), e(UUID('22'), 3, 8, 12), e(UUID('23'), 3, 8, 12), e(UUID('28'), 3, 12, 15), e(UUID('12'), 3, 10, 12)],
  },
  {
    id: 'legs', name: 'Leg Day', focus: 'Legs',
    exercises: [e(UUID('17'), 4, 6, 8), e(UUID('41'), 3, 8, 10), e(UUID('24'), 3, 10, 12), e(UUID('25'), 3, 10, 12), e(UUID('26'), 3, 12, 15), e(UUID('45'), 3, 12, 15)],
  },
  {
    id: 'upper', name: 'Upper Body', focus: 'Upper',
    exercises: [e(UUID('18'), 4, 6, 8), e(UUID('21'), 4, 6, 8), e(UUID('20'), 3, 8, 10), e(UUID('22'), 3, 8, 12), e(UUID('12'), 3, 10, 12), e(UUID('13'), 3, 10, 12)],
  },
  {
    id: 'lower', name: 'Lower Body', focus: 'Lower',
    exercises: [e(UUID('17'), 4, 6, 8), e(UUID('41'), 3, 8, 10), e(UUID('24'), 3, 10, 12), e(UUID('25'), 3, 10, 12), e(UUID('05'), 3, 12, 15), e(UUID('04'), 3, 10, 12)],
  },
  {
    id: 'fullbody_a', name: 'Full Body A', focus: 'Full Body A',
    exercises: [e(UUID('17'), 3, 6, 8), e(UUID('18'), 3, 6, 8), e(UUID('21'), 3, 8, 10), e(UUID('20'), 3, 8, 10), e(UUID('04'), 3, 10, 12)],
  },
  {
    id: 'fullbody_b', name: 'Full Body B', focus: 'Full Body B',
    exercises: [e(UUID('19'), 3, 5, 5), e(UUID('16'), 3, 8, 12), e(UUID('30'), 3, 6, 10), e(UUID('09'), 3, 10, 12), e(UUID('45'), 3, 12, 15)],
  },
  {
    id: 'home_bw', name: 'Home / No Equipment', focus: 'Bodyweight',
    exercises: [e(UUID('01'), 3, 10, 20), e(UUID('02'), 3, 15, 25), e(UUID('03'), 3, 10, 12), e(UUID('30'), 3, 5, 10), e(UUID('04'), 3, 10, 12), e(UUID('06'), 3, 20, 30)],
  },
]

export const workoutPresetById = (id: string): WorkoutPreset | undefined => WORKOUT_PRESETS.find((p) => p.id === id)

// ── Split presets ──────────────────────────────────────────────────────────────
const R = null
export const SPLIT_PRESETS: SplitPreset[] = [
  {
    id: 'ppl6', name: 'Push Pull Legs', description: '6 days/week · the classic high-volume hypertrophy split',
    days: [
      { weekday: 1, presetId: 'push' }, { weekday: 2, presetId: 'pull' }, { weekday: 3, presetId: 'legs' },
      { weekday: 4, presetId: 'push' }, { weekday: 5, presetId: 'pull' }, { weekday: 6, presetId: 'legs' },
      { weekday: 7, presetId: R },
    ],
  },
  {
    id: 'ppl3', name: 'Push Pull Legs (3-day)', description: '3 days/week · one of each, plenty of recovery',
    days: [
      { weekday: 1, presetId: 'push' }, { weekday: 2, presetId: R }, { weekday: 3, presetId: 'pull' },
      { weekday: 4, presetId: R }, { weekday: 5, presetId: 'legs' }, { weekday: 6, presetId: R }, { weekday: 7, presetId: R },
    ],
  },
  {
    id: 'upper_lower', name: 'Upper / Lower', description: '4 days/week · trains each half twice',
    days: [
      { weekday: 1, presetId: 'upper' }, { weekday: 2, presetId: 'lower' }, { weekday: 3, presetId: R },
      { weekday: 4, presetId: 'upper' }, { weekday: 5, presetId: 'lower' }, { weekday: 6, presetId: R }, { weekday: 7, presetId: R },
    ],
  },
  {
    id: 'fullbody3', name: 'Full Body', description: '3 days/week · efficient, great for beginners',
    days: [
      { weekday: 1, presetId: 'fullbody_a' }, { weekday: 2, presetId: R }, { weekday: 3, presetId: 'fullbody_b' },
      { weekday: 4, presetId: R }, { weekday: 5, presetId: 'fullbody_a' }, { weekday: 6, presetId: R }, { weekday: 7, presetId: R },
    ],
  },
]

export const splitPresetById = (id: string): SplitPreset | undefined => SPLIT_PRESETS.find((p) => p.id === id)

// ── Hydration ──────────────────────────────────────────────────────────────────

// Fetch the exercise rows a preset references, once.
async function fetchExerciseMap(client: SupabaseClient, uuids: string[]): Promise<Map<string, Exercise>> {
  if (!uuids.length) return new Map()
  const { data } = await client.from('exercises').select(EXERCISE_COLUMNS).in('id', [...new Set(uuids)])
  return new Map((data ?? []).map((x: any) => [x.id, x as Exercise]))
}

function presetToItems(preset: WorkoutPreset, byId: Map<string, Exercise>): DraftItem[] {
  const items: DraftItem[] = []
  for (const pe of preset.exercises) {
    const ex = byId.get(pe.uuid)
    if (!ex) continue
    const base = makeDraftItem(ex)
    base.sets = pe.sets
    if (metricsFor(ex).includes('reps')) { base.repLow = pe.repLow; base.repHigh = pe.repHigh }
    items.push(base)
  }
  return items
}

// Turn a workout preset into editable draft items (for the builder's "start from
// template"). Drops any exercise that's missing from the library.
export async function hydrateWorkoutPreset(client: SupabaseClient, preset: WorkoutPreset): Promise<DraftItem[]> {
  const byId = await fetchExerciseMap(client, preset.exercises.map((x) => x.uuid))
  return presetToItems(preset, byId)
}

export interface PresetSplitResult {
  name: string
  // One per weekday 1..7; null = rest.
  days: { weekday: number; label: string; items: DraftItem[] }[]
}

// Apply a split preset: build the 7-day pattern with hydrated workouts AND save each
// distinct workout into the user's library (workout_templates) so it's reusable.
// Returns the data the split editor needs to render the filled week.
export async function applySplitPreset(
  client: SupabaseClient,
  userId: string,
  preset: SplitPreset,
): Promise<PresetSplitResult> {
  const usedPresetIds = [...new Set(preset.days.map((d) => d.presetId).filter((x): x is string => !!x))]
  const allUuids = usedPresetIds.flatMap((pid) => workoutPresetById(pid)?.exercises.map((x) => x.uuid) ?? [])
  const byId = await fetchExerciseMap(client, allUuids)

  // Hydrate each distinct workout once, and save it to the library (skip duplicates
  // the user may already have by name).
  const itemsByPreset = new Map<string, DraftItem[]>()
  for (const pid of usedPresetIds) {
    const wp = workoutPresetById(pid)
    if (!wp) continue
    const items = presetToItems(wp, byId)
    itemsByPreset.set(pid, items)
    if (items.length) {
      try {
        const { data: existing } = await client
          .from('workout_templates').select('id').eq('user_id', userId).eq('name', wp.name).maybeSingle()
        if (!existing) {
          await client.from('workout_templates').insert({
            user_id: userId,
            name: wp.name,
            exercise_ids: items.map((i) => i.exercise.id),
            config: items.map(itemToConfig),
            est_duration_min: estimateDurationMin(items),
            updated_at: new Date().toISOString(),
          })
        }
      } catch { /* library save is best-effort — the split still works */ }
    }
  }

  const days = preset.days.map((d) => {
    if (!d.presetId) return { weekday: d.weekday, label: 'Rest', items: [] as DraftItem[] }
    const wp = workoutPresetById(d.presetId)
    return { weekday: d.weekday, label: wp?.focus ?? 'Workout', items: itemsByPreset.get(d.presetId) ?? [] }
  })
  return { name: preset.name, days }
}
