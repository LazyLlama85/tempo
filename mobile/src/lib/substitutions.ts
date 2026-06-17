// Tempo — saved exercise swaps.
// A swap the user makes in a session is remembered and re-applied to every
// future workout that contains the original lift, so "the leg-press machine is
// always busy, use hack squat instead" only has to be said once.
//
// All calls degrade gracefully if the exercise_substitutions table hasn't been
// created yet (see supabase/add_exercise_substitutions.sql) — they no-op rather
// than break the session.

import type { SupabaseClient } from '@supabase/supabase-js'

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
// curated substitutes or equipment they have). Used to change a saved swap.
export async function getAlternatives(
  client: SupabaseClient,
  userId: string,
  originalId: string,
): Promise<AltExercise[]> {
  try {
    const { data: orig } = await client
      .from('exercises')
      .select('id, movement_pattern, substitute_ids')
      .eq('id', originalId)
      .maybeSingle()
    if (!orig) return []

    const { data: profileRow } = await client
      .from('user_profiles')
      .select('equipment')
      .eq('user_id', userId)
      .maybeSingle()
    const equipment = new Set<string>([...((profileRow?.equipment as string[]) ?? []), 'bodyweight'])
    const curatedSet = new Set<string>((orig.substitute_ids as string[]) ?? [])

    const { data: subs } = await client
      .from('exercises')
      .select('id, name, required_equipment')
      .eq('movement_pattern', orig.movement_pattern)
      .neq('id', originalId)

    const cands = (subs ?? [])
      .filter((s: any) => curatedSet.has(s.id) || (s.required_equipment as string[]).some(eq => equipment.has(eq)))
      .map((s: any) => ({ id: s.id as string, name: s.name as string, curated: curatedSet.has(s.id) }))

    cands.sort((a, b) => (a.curated === b.curated ? a.name.localeCompare(b.name) : a.curated ? -1 : 1))
    return cands
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
