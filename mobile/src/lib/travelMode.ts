// Tempo — temporary equipment override ("travel mode").
//
// When the user is away from their usual setup (a hotel with only dumbbells, a week
// at a relative's, no gym while travelling), they flip this on and tell Tempo what
// they DO have right now plus when they'll be back. While active it replaces their
// home equipment everywhere exercises get chosen — Quick Workouts, swaps, and
// in-session substitutions — so the plan keeps working instead of prescribing a
// barbell they can't touch. When the end date passes it quietly expires on its own.
//
// Everything degrades gracefully: if the travel_mode column hasn't been migrated yet
// (see supabase/add_travel_mode.sql), reads return null and writes no-op, so the app
// behaves exactly as before.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Equipment, TravelMode } from '@/types'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The active override, or null if not travelling / expired / column missing.
export async function getActiveTravelMode(client: SupabaseClient, userId: string): Promise<TravelMode | null> {
  try {
    const { data, error } = await client
      .from('user_profiles')
      .select('travel_mode')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data?.travel_mode) return null
    const tm = data.travel_mode as TravelMode
    if (!tm.equipment?.length) return null
    if (tm.until && tm.until < todayStr()) return null   // end date has passed
    return { equipment: tm.equipment, until: tm.until ?? null, label: tm.label ?? null }
  } catch {
    return null
  }
}

export async function saveTravelMode(client: SupabaseClient, userId: string, tm: TravelMode): Promise<boolean> {
  try {
    const { error } = await client.from('user_profiles').update({ travel_mode: tm }).eq('user_id', userId)
    return !error
  } catch {
    return false
  }
}

export async function clearTravelMode(client: SupabaseClient, userId: string): Promise<void> {
  try {
    await client.from('user_profiles').update({ travel_mode: null }).eq('user_id', userId)
  } catch {
    // best-effort
  }
}

// Equipment to actually program with: the travel override if active, else the home
// equipment passed in. Callers that already have the profile's equipment pass it so
// this is a single extra read at most.
export async function effectiveEquipment(
  client: SupabaseClient,
  userId: string,
  homeEquipment: string[],
): Promise<{ equipment: string[]; travel: TravelMode | null }> {
  const travel = await getActiveTravelMode(client, userId)
  return { equipment: travel ? travel.equipment : homeEquipment, travel }
}

// "until Fri, Jun 27" / "until you turn it off" — for banners and the settings row.
export function describeTravelUntil(until: string | null): string {
  if (!until) return 'until you turn it off'
  const d = new Date(`${until}T00:00:00`)
  if (Number.isNaN(d.getTime())) return 'until you turn it off'
  return `until ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
}

const EQUIP_LABELS: Record<Equipment, string> = {
  full_gym: 'Full gym',
  dumbbells: 'Dumbbells',
  barbell: 'Barbell',
  resistance_bands: 'Bands',
  bodyweight: 'Bodyweight',
}

// "Dumbbells & Bands" — a short summary of the travel equipment for banners.
export function describeTravelEquipment(equipment: Equipment[]): string {
  const names = equipment.map(e => EQUIP_LABELS[e] ?? e)
  if (names.length <= 1) return names[0] ?? 'No equipment'
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}
