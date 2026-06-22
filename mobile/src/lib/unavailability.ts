// Tempo — "completely unavailable" times.
// Hard blocks the user defines (religious observance, standing commitments, any
// time they never train) that the scheduler treats as un-bookable. Stored as JSON
// on the profile (see supabase/add_unavailable_blocks.sql).
//
// All calls degrade gracefully if the column hasn't been added yet — they return
// [] / no-op rather than breaking scheduling.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UnavailableBlock } from '@/types'

export async function getUnavailableBlocks(
  client: SupabaseClient,
  userId: string,
): Promise<UnavailableBlock[]> {
  try {
    const { data, error } = await client
      .from('user_profiles')
      .select('unavailable_blocks')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return []
    return ((data.unavailable_blocks as UnavailableBlock[] | null) ?? [])
  } catch {
    // column missing / RLS — treat as "nothing blocked off"
    return []
  }
}

export async function saveUnavailableBlocks(
  client: SupabaseClient,
  userId: string,
  blocks: UnavailableBlock[],
): Promise<boolean> {
  try {
    const { error } = await client
      .from('user_profiles')
      .update({ unavailable_blocks: blocks })
      .eq('user_id', userId)
    return !error
  } catch {
    return false
  }
}

// A short human summary for a block, e.g. "Saturdays · all day" or "Weekdays · 12–1 PM".
const WD = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function time12(t?: string): string {
  if (!t) return ''
  const [hS, mS] = t.split(':')
  const h = parseInt(hS, 10)
  return `${h % 12 || 12}:${mS} ${h >= 12 ? 'PM' : 'AM'}`
}

export function describeBlock(b: UnavailableBlock): string {
  const when = b.scope === 'weekday'
    ? `${WD[b.weekday ?? 0] || '—'}s`
    : (b.date ?? '—')
  const span = b.allDay ? 'all day' : `${time12(b.start)} – ${time12(b.end)}`
  return `${when} · ${span}`
}
