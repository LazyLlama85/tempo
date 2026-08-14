// Tempo — persist travel-mode equipment adaptation onto the schedule.
//
// The in-session runner already adapts a workout to travel equipment on the fly,
// but that leaves the schedule cards, durations and previews showing gear the user
// can't touch. This module makes the adaptation REAL and reversible: while travel
// mode is on, every upcoming plan/split session has its exercises swapped for ones
// the current equipment supports, with the original stashed in `travel_restore`.
// When travel mode ends (toggled off or the end date passes), the originals are put
// back exactly. Called on app open and right after the user saves/clears travel mode.
//
// "No equipment" always means bodyweight — expandEquipment adds bodyweight to every
// selection, and the library has a bodyweight option for every movement pattern, so
// a swap can always be found.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkoutExerciseConfig } from '@/types'
import { expandEquipment, canPerform } from './equipmentMatch'
import { getActiveTravelMode } from './travelMode'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface PoolRow {
  id: string
  name: string
  movement_pattern: string
  required_equipment: string[]
  primary_muscles: string[] | null
  is_core: boolean | null
  popularity: number | null
  substitute_ids: string[] | null
}

interface TravelRestore {
  exercise_ids: string[]
  exercise_config: WorkoutExerciseConfig[] | null
}

interface ScheduledRow {
  id: string
  exercise_ids: string[] | null
  exercise_config: WorkoutExerciseConfig[] | null
  travel_restore: TravelRestore | null
}

// Best same-pattern replacement for an exercise the user can't do right now:
// the exercise's own curated substitutes first, then core staples, then closest
// muscle overlap and popularity. `used` avoids putting the same lift in twice.
function pickReplacement(
  original: PoolRow,
  pool: PoolRow[],
  have: Set<string>,
  used: Set<string>,
): PoolRow | null {
  const curated = new Set(original.substitute_ids ?? [])
  const origMuscles = new Set(original.primary_muscles ?? [])
  const overlap = (m: string[] | null) => (m ?? []).reduce((n, x) => n + (origMuscles.has(x) ? 1 : 0), 0)

  const doable = pool.filter(
    p => p.id !== original.id && !used.has(p.id) &&
      p.movement_pattern === original.movement_pattern &&
      canPerform(p, have),
  )
  if (!doable.length) return null

  doable.sort((a, b) =>
    Number(curated.has(b.id)) - Number(curated.has(a.id)) ||
    Number(!!b.is_core) - Number(!!a.is_core) ||
    overlap(b.primary_muscles) - overlap(a.primary_muscles) ||
    (b.popularity ?? 30) - (a.popularity ?? 30),
  )
  return doable[0]
}

// Remap a workout's exercise ids to fit the available equipment. Keeps anything
// already doable; swaps the rest. Returns the new ids + whether anything changed.
function remapIds(
  ids: string[],
  exById: Map<string, PoolRow>,
  pool: PoolRow[],
  have: Set<string>,
): { ids: string[]; changed: boolean } {
  const used = new Set<string>(ids)
  let changed = false
  const out = ids.map(id => {
    const ex = exById.get(id)
    if (!ex) return id // unknown (custom) — leave it
    if (canPerform(ex, have)) return id
    const pick = pickReplacement(ex, pool, have, used)
    if (!pick) return id // nothing fits — keep; the user can skip
    used.delete(id)
    used.add(pick.id)
    changed = true
    return pick.id
  })
  return { ids: out, changed }
}

// Re-key a split's per-exercise config to the swapped ids (preserves sets/reps).
function remapConfig(
  config: WorkoutExerciseConfig[] | null,
  oldIds: string[],
  newIds: string[],
): WorkoutExerciseConfig[] | null {
  if (!config?.length) return config
  const idMap = new Map<string, string>()
  oldIds.forEach((id, i) => { if (newIds[i]) idMap.set(id, newIds[i]) })
  return config.map(c => ({ ...c, exercise_id: idMap.get(c.exercise_id) ?? c.exercise_id }))
}

// The single entry point. Idempotent — safe to call on every app open. Adapts (or
// restores) every upcoming plan/split session to match the active travel equipment.
// Returns how many workout rows changed (so callers can refresh the feed only when
// something actually moved).
// Same ids, same order? Used to detect a row that is ALREADY adapted exactly the
// way this run would adapt it, so a repeat app-open writes nothing at all.
function sameIds(a: readonly string[] | null | undefined, b: readonly string[]): boolean {
  const x = a ?? []
  if (x.length !== b.length) return false
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false
  return true
}

export async function syncTravelSchedule(client: SupabaseClient, userId: string): Promise<number> {
  let changedRows = 0
  try {
    // Travel status FIRST — it's one tiny row, and when travel is off (the common
    // case) it lets the whole expensive path below be skipped. Previously the
    // upcoming-workout list was always fetched before this check even when there
    // was provably nothing to do.
    const travel = await getActiveTravelMode(client, userId)

    const { data: rowsRaw } = await client
      .from('scheduled_workouts')
      .select('id, exercise_ids, exercise_config, travel_restore, status, planned_date, source')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('planned_date', todayStr())
      .in('source', ['plan', 'split'])
    const rows = (rowsRaw ?? []) as ScheduledRow[]
    if (!rows.length) return 0

    // ── Travel OFF / expired → restore anything we adjusted ─────────────────────
    if (!travel) {
      const toRestore = rows.filter(r => r.travel_restore)
      if (!toRestore.length) return 0
      // Parallel, not one-at-a-time: these are independent single-row updates on
      // disjoint ids, so awaiting each in sequence only added round trips.
      await Promise.all(toRestore.map(r =>
        client
          .from('scheduled_workouts')
          .update({
            exercise_ids: r.travel_restore!.exercise_ids,
            exercise_config: r.travel_restore!.exercise_config ?? null,
            travel_restore: null,
          })
          .eq('id', r.id),
      ))
      return toRestore.length
    }

    // ── Travel ON → adapt every upcoming session ────────────────────────────────
    const have = expandEquipment(travel.equipment)
    const { data: poolRaw } = await client
      .from('exercises')
      .select('id, name, movement_pattern, required_equipment, primary_muscles, is_core, popularity, substitute_ids')
      .is('user_id', null)
    const pool = (poolRaw ?? []) as PoolRow[]
    const exById = new Map(pool.map(p => [p.id, p]))

    // Collect the writes, then fire them together — same reasoning as the restore
    // path above.
    const writes: PromiseLike<unknown>[] = []

    for (const r of rows) {
      // Always adapt from the ORIGINAL (stored) version so re-runs with changed
      // equipment don't compound swaps.
      const base: TravelRestore = r.travel_restore ?? {
        exercise_ids: r.exercise_ids ?? [],
        exercise_config: r.exercise_config ?? null,
      }
      const { ids: newIds, changed } = remapIds(base.exercise_ids, exById, pool, have)

      if (!changed) {
        // Original already fits the current gear — undo any prior adjustment.
        if (r.travel_restore) {
          writes.push(client
            .from('scheduled_workouts')
            .update({
              exercise_ids: base.exercise_ids,
              exercise_config: base.exercise_config ?? null,
              travel_restore: null,
            })
            .eq('id', r.id))
          changedRows++
        }
        continue
      }

      // Already adapted to exactly this set — writing it again would store the
      // identical value. This is the whole reason app open was slow while travel
      // mode was on: with no such check, EVERY upcoming session was rewritten on
      // EVERY launch (~25 sequential round trips, several seconds of network,
      // every time), even though nothing about the row actually changed. Now a
      // steady-state open writes nothing.
      if (r.travel_restore && sameIds(r.exercise_ids, newIds)) continue

      writes.push(client
        .from('scheduled_workouts')
        .update({
          exercise_ids: newIds,
          exercise_config: remapConfig(base.exercise_config, base.exercise_ids, newIds),
          travel_restore: base,
        })
        .eq('id', r.id))
      changedRows++
    }

    if (writes.length) await Promise.all(writes)
  } catch {
    // Best-effort — travel adaptation must never break app open.
  }
  return changedRows
}
