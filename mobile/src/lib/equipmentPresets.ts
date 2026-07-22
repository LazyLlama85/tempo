// Tempo — saved equipment presets for Quick Workout.
//
// A user saves named equipment sets ("Home – bands & dumbbells", "Hotel gym") and
// picks one when generating a Quick Workout, so the session is built around the gear
// they actually have right now. Stored as a jsonb array on user_profiles.equipment_presets
// (migration add_equipment_presets.sql) so it syncs across devices. All reads/writes
// degrade gracefully if the column is missing.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Equipment } from '@/types'

export interface EquipmentPreset {
  id: string
  name: string
  equipment: Equipment[]
}

// The equipment catalog shown when building a preset (shared shape with Travel Mode).
export const EQUIPMENT_OPTIONS: { id: Equipment; label: string; desc: string; icon: string }[] = [
  { id: 'full_gym', label: 'Full gym', desc: 'Machines, racks & cables', icon: 'business-outline' },
  { id: 'dumbbells', label: 'Dumbbells', desc: 'A pair of dumbbells', icon: 'barbell-outline' },
  { id: 'barbell', label: 'Barbell & plates', desc: 'Barbell with a rack or bench', icon: 'disc-outline' },
  { id: 'kettlebell', label: 'Kettlebells', desc: 'One or two kettlebells', icon: 'fitness-outline' },
  { id: 'resistance_bands', label: 'Resistance bands', desc: 'Travel / loop bands', icon: 'pulse-outline' },
  { id: 'pull_up_bar', label: 'Pull-up & dip bar', desc: 'A bar, dip station, or rings', icon: 'body-outline' },
  { id: 'bodyweight', label: 'No equipment', desc: 'Floor work only', icon: 'walk-outline' },
]

const EQUIP_LABEL: Record<Equipment, string> = {
  full_gym: 'Full gym', dumbbells: 'Dumbbells', barbell: 'Barbell', kettlebell: 'Kettlebells',
  resistance_bands: 'Bands', pull_up_bar: 'Pull-up bar', bodyweight: 'Bodyweight',
}

/** "Dumbbells & Bands" — a short summary of a preset's gear. */
export function describeEquipment(equipment: Equipment[]): string {
  const names = equipment.map((e) => EQUIP_LABEL[e] ?? e)
  if (!names.length) return 'No equipment'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

// A lightweight id without pulling in a uuid dep — presets are per-user and few.
export function newPresetId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export async function fetchPresets(client: SupabaseClient, userId: string): Promise<EquipmentPreset[]> {
  try {
    const { data } = await client
      .from('user_profiles')
      .select('equipment_presets')
      .eq('user_id', userId)
      .maybeSingle()
    const raw = (data?.equipment_presets ?? []) as EquipmentPreset[]
    return Array.isArray(raw) ? raw.filter((p) => p && p.id && Array.isArray(p.equipment)) : []
  } catch {
    return []
  }
}

export async function savePresets(client: SupabaseClient, userId: string, presets: EquipmentPreset[]): Promise<boolean> {
  try {
    const { error } = await client.from('user_profiles').update({ equipment_presets: presets }).eq('user_id', userId)
    return !error
  } catch {
    return false
  }
}
