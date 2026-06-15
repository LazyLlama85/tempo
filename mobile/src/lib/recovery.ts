// Tempo — recovery & readiness.
// A 10-second daily check-in (sleep / energy / soreness / stress) produces a
// readiness score that the coach uses to trim volume on rough days.
//
// Degrades gracefully: if the recovery_checkins table hasn't been created yet
// (see supabase/add_recovery_checkins.sql) every read returns null and the app
// behaves exactly as before.

import { supabase } from '@/lib/supabase'

export interface RecoveryInputs {
  sleep: number     // 1–5, higher is better
  energy: number    // 1–5, higher is better
  soreness: number  // 1–5, higher is worse
  stress: number    // 1–5, higher is worse
}

export interface RecoveryCheckin extends RecoveryInputs {
  date: string
  readiness: number
}

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// Maps the four 1–5 inputs to a 0–100 readiness score. Soreness and stress are
// inverted (5 = worst), so a great day → 100 and a rough day → ~20.
export function computeReadiness({ sleep, energy, soreness, stress }: RecoveryInputs): number {
  const raw = sleep + energy + (6 - soreness) + (6 - stress)
  return Math.max(0, Math.min(100, Math.round((raw / 20) * 100)))
}

export function readinessLabel(score: number): string {
  if (score >= 80) return 'Primed'
  if (score >= 60) return 'Ready'
  if (score >= 45) return 'Moderate'
  return 'Take it easy'
}

export async function getTodayCheckin(userId: string): Promise<RecoveryCheckin | null> {
  if (!userId) return null
  try {
    const { data, error } = await supabase
      .from('recovery_checkins')
      .select('date, sleep, energy, soreness, stress, readiness')
      .eq('user_id', userId)
      .eq('date', todayStr())
      .maybeSingle()
    if (error || !data) return null
    return data as RecoveryCheckin
  } catch {
    return null
  }
}

export async function getTodayReadiness(userId: string): Promise<number | null> {
  const checkin = await getTodayCheckin(userId)
  return checkin?.readiness ?? null
}

export async function saveCheckin(userId: string, inputs: RecoveryInputs): Promise<number | null> {
  if (!userId) return null
  const readiness = computeReadiness(inputs)
  try {
    const { error } = await supabase
      .from('recovery_checkins')
      .upsert(
        { user_id: userId, date: todayStr(), ...inputs, readiness },
        { onConflict: 'user_id,date' },
      )
    if (error) return null
    return readiness
  } catch {
    return null
  }
}
