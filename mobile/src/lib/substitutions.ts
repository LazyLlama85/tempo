// Tempo — saved exercise swaps.
// A swap the user makes in a session is remembered and re-applied to every
// future workout that contains the original lift, so "the leg-press machine is
// always busy, use hack squat instead" only has to be said once.
//
// All calls degrade gracefully if the exercise_substitutions table hasn't been
// created yet (see supabase/add_exercise_substitutions.sql) — they no-op rather
// than break the session.

import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveEquipment } from '@/lib/travelMode'
import { expandEquipment, needsApparatus } from '@/lib/equipmentMatch'

// original_exercise_id → substitute_exercise_id
export async function getSubstitutions(
  client: SupabaseClient,
  userId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const { data, error } = await client
      .from('exercise_substitutions')
      .select('original_exercise_id, substitute_exercise_id')
      .eq('user_id', userId)
    if (error || !data) return map
    for (const r of data as { original_exercise_id: string; substitute_exercise_id: string }[]) {
      map.set(r.original_exercise_id, r.substitute_exercise_id)
    }
  } catch {
    // table missing / RLS — treat as "no saved swaps"
  }
  return map
}

export async function saveSubstitution(
  client: SupabaseClient,
  userId: string,
  originalId: string,
  substituteId: string,
): Promise<void> {
  if (originalId === substituteId) return
  try {
    await client
      .from('exercise_substitutions')
      .upsert(
        { user_id: userId, original_exercise_id: originalId, substitute_exercise_id: substituteId },
        { onConflict: 'user_id,original_exercise_id' },
      )
  } catch {
    // Best-effort — the in-session swap still applies even if we can't persist it.
  }
}

export async function removeSubstitution(
  client: SupabaseClient,
  userId: string,
  originalId: string,
): Promise<void> {
  try {
    await client
      .from('exercise_substitutions')
      .delete()
      .eq('user_id', userId)
      .eq('original_exercise_id', originalId)
  } catch {
    // no-op
  }
}

// ── Managing saved swaps from the Profile editor ──────────────────────────────

export interface SavedSwap {
  originalId: string
  originalName: string
  substituteId: string
  substituteName: string
}

// Saved swaps with exercise names resolved, for display/editing.
export async function getSavedSwaps(client: SupabaseClient, userId: string): Promise<SavedSwap[]> {
  try {
    const { data, error } = await client
      .from('exercise_substitutions')
      .select('original_exercise_id, substitute_exercise_id')
      .eq('user_id', userId)
    if (error || !data?.length) return []

    const rows = data as { original_exercise_id: string; substitute_exercise_id: string }[]
    const ids = [...new Set(rows.flatMap(r => [r.original_exercise_id, r.substitute_exercise_id]))]
    const { data: exRows } = await client.from('exercises').select('id, name').in('id', ids)
    const nameMap = new Map<string, string>((exRows ?? []).map((e: any) => [e.id, e.name]))

    return rows
      .map(r => ({
        originalId: r.original_exercise_id,
        originalName: nameMap.get(r.original_exercise_id) ?? 'Exercise',
        substituteId: r.substitute_exercise_id,
        substituteName: nameMap.get(r.substitute_exercise_id) ?? 'Exercise',
      }))
      .sort((a, b) => a.originalName.localeCompare(b.originalName))
  } catch {
    return []
  }
}

export interface AltExercise {
  id: string
  name: string
  curated: boolean
}

// Alternatives for an exercise the user can actually do (same movement pattern;
// curated substitutes or equipment they have). With a 1300-exercise library the
// candidates are RANKED — curated picks, then closest muscle overlap, then
// popularity — and capped, so "swap leg press" offers hack squats before
// obscure single-leg sled variants. Used to change a saved swap.
const MAX_ALTERNATIVES = 40

export async function getAlternatives(
  client: SupabaseClient,
  userId: string,
  originalId: string,
): Promise<AltExercise[]> {
  try {
    const { data: orig } = await client
      .from('exercises')
      .select('id, movement_pattern, substitute_ids, primary_muscles')
      .eq('id', originalId)
      .maybeSingle()
    if (!orig) return []

    const { data: profileRow } = await client
      .from('user_profiles')
      .select('equipment')
      .eq('user_id', userId)
      .maybeSingle()
    // Respect travel mode: offer alternatives for the equipment the user has now.
    const { equipment: effective } = await effectiveEquipment(client, userId, (profileRow?.equipment as string[]) ?? [])
    // "Full gym" implies barbell/dumbbells/bands — see lib/equipmentMatch.
    const equipment = expandEquipment(effective)
    const curatedSet = new Set<string>((orig.substitute_ids as string[]) ?? [])
    const origMuscles = new Set<string>((orig.primary_muscles as string[]) ?? [])

    const { data: subs } = await client
      .from('exercises')
      .select('id, name, required_equipment, primary_muscles, popularity')
      .eq('movement_pattern', orig.movement_pattern)
      .neq('id', originalId)

    const overlapOf = (muscles: string[] | null) =>
      (muscles ?? []).reduce((n, m) => n + (origMuscles.has(m) ? 1 : 0), 0)

    const cands = (subs ?? [])
      .filter((s: any) => {
        const req = s.required_equipment as string[]
        // Curated swaps are trusted; otherwise the gear has to match.
        if (!curatedSet.has(s.id) && !req.some(eq => equipment.has(eq))) return false
        // Never offer a bar/dip move to someone without the apparatus — even a
        // curated one (see lib/equipmentMatch).
        if (req.includes('bodyweight') && needsApparatus(s.name) && !equipment.has('pull_up_bar')) return false
        return true
      })
      .map((s: any) => ({
        id: s.id as string,
        name: s.name as string,
        curated: curatedSet.has(s.id),
        overlap: overlapOf(s.primary_muscles as string[] | null),
        popularity: (s.popularity as number | null) ?? 30,
      }))

    cands.sort((a, b) =>
      Number(b.curated) - Number(a.curated) ||
      b.overlap - a.overlap ||
      b.popularity - a.popularity ||
      a.name.localeCompare(b.name)
    )
    return cands.slice(0, MAX_ALTERNATIVES).map(({ id, name, curated }) => ({ id, name, curated }))
  } catch {
    return []
  }
}

// Applies saved swaps to a list of exercise ids, preserving order and dropping
// any duplicate that a remap might introduce.
export function applySubstitutions(exerciseIds: string[], subs: Map<string, string>): string[] {
  if (!subs.size) return exerciseIds
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of exerciseIds) {
    const mapped = subs.get(id) ?? id
    if (seen.has(mapped)) continue
    seen.add(mapped)
    out.push(mapped)
  }
  return out
}
