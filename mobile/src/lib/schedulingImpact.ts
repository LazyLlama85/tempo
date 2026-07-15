// Tempo — scheduling impact (quantifying the wedge).
//
// Tempo's whole reason to exist is that it decides WHAT you train and WHEN it fits
// your real week, so you don't have to. That value is invisible in the app today —
// this makes it countable and honest: how many of your completed workouts did Tempo
// plan and schedule for you, versus ones you built yourself?
//
// "By Tempo" = a completed session whose source is plan/quick/smart (generated +
// auto-placed). Custom and split sessions are the USER's own planning, so they're
// deliberately excluded — the number only ever counts Tempo's contribution, which is
// exactly what makes it meaningful and keeps it honest (it never claims credit for a
// workout you programmed yourself). No fabricated "workouts you'd have skipped"
// guesses — just a real count of what Tempo actually handled.

import type { SupabaseClient } from '@supabase/supabase-js'

// The sources Tempo generated + placed for the user. Single source of truth so every
// surface counts the wedge the same way.
export const TEMPO_SCHEDULED_SOURCES = ['plan', 'quick', 'smart'] as const

export interface SchedulingImpact {
  /** Completed sessions Tempo planned + scheduled for the user, all-time. */
  scheduledByTempo: number
  /** ...of those, the ones completed in the current (Monday-anchored) week. */
  thisWeek: number
}

interface ImpactRow {
  planned_date: string
  status: string
  source: string | null
}

// Monday of the given day, as a 'YYYY-MM-DD' string — matches lib/weeklyReport's
// week anchoring so "this week" means the same thing across surfaces.
export function mondayStr(now: Date = new Date()): string {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Pure, unit-tested core: count completed Tempo-scheduled sessions (all-time + this
// week) from already-fetched rows. Separated from the fetch so it can be tested
// without a DB and reused by any caller that already holds the rows.
export function summarizeSchedulingImpact(
  rows: ImpactRow[],
  weekStart: string = mondayStr(),
): SchedulingImpact {
  const tempo = new Set<string>(TEMPO_SCHEDULED_SOURCES)
  let scheduledByTempo = 0
  let thisWeek = 0
  for (const r of rows) {
    if (r.status !== 'completed') continue
    if (!r.source || !tempo.has(r.source)) continue
    scheduledByTempo++
    if (r.planned_date >= weekStart) thisWeek++
  }
  return { scheduledByTempo, thisWeek }
}

// Fetch + summarize. Best-effort: any failure returns zeros so a caller can simply
// hide the surface (an honest empty state — never a fabricated number).
export async function fetchSchedulingImpact(
  client: SupabaseClient,
  userId: string,
): Promise<SchedulingImpact> {
  try {
    const { data } = await client
      .from('scheduled_workouts')
      .select('planned_date, status, source')
      .eq('user_id', userId)
      .eq('status', 'completed')
    return summarizeSchedulingImpact((data ?? []) as ImpactRow[])
  } catch {
    return { scheduledByTempo: 0, thisWeek: 0 }
  }
}
