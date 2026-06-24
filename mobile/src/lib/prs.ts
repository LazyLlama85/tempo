// Tempo — personal-record detection.
//
// People remember PRs. After a session this finds what the user just beat —
// heaviest weight, best estimated 1RM, or most reps — versus all their prior
// history, so the celebration screen can call it out aggressively. One PR per
// exercise (the most impressive), newest-best first.

import type { SupabaseClient } from '@supabase/supabase-js'
import { estimate1RM } from '@/lib/progression'

export type PRKind = 'weight' | 'e1rm' | 'reps' | 'first'

export interface SessionPR {
  exercise: string
  kind: PRKind
  value: number          // the new best (lbs for weight/e1rm, reps for reps)
  deltaLbs: number | null // improvement over prior best, when applicable
  unit: 'lbs' | 'reps'
}

interface SetRow { workout_log_id: string; exercise_id: string; weight_lbs: number | null; reps_completed: number }

/**
 * Detect PRs set in a specific session (defaults to the user's most recent log).
 * Compares the session's sets against every prior set for the same exercise.
 */
export async function detectSessionPRs(
  client: SupabaseClient,
  userId: string,
  logId?: string,
): Promise<SessionPR[]> {
  try {
    // Resolve the target session log (latest if not given).
    let targetLog = logId
    if (!targetLog) {
      const { data } = await client
        .from('workout_logs')
        .select('id, started_at')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      targetLog = data?.id as string | undefined
    }
    if (!targetLog) return []

    const { data: logs } = await client.from('workout_logs').select('id').eq('user_id', userId)
    const logIds = (logs ?? []).map((l: any) => l.id as string)
    if (!logIds.length) return []

    const { data: sets } = await client
      .from('set_logs')
      .select('workout_log_id, exercise_id, weight_lbs, reps_completed')
      .in('workout_log_id', logIds)
    const rows = (sets ?? []) as SetRow[]

    const session = rows.filter(s => s.workout_log_id === targetLog && s.weight_lbs != null && s.weight_lbs > 0)
    if (!session.length) return []
    const prior = rows.filter(s => s.workout_log_id !== targetLog && s.weight_lbs != null && s.weight_lbs > 0)

    const exIds = [...new Set(session.map(s => s.exercise_id))]
    const { data: exRows } = await client.from('exercises').select('id, name').in('id', exIds)
    const exName = new Map<string, string>((exRows ?? []).map((e: any) => [e.id, e.name]))

    const prs: SessionPR[] = []
    for (const exId of exIds) {
      const mine = session.filter(s => s.exercise_id === exId)
      const hist = prior.filter(s => s.exercise_id === exId)

      const sessBestW = Math.max(...mine.map(s => s.weight_lbs!))
      const sessBestReps = Math.max(...mine.map(s => s.reps_completed))
      const sessBestE = Math.max(...mine.map(s => estimate1RM(s.weight_lbs!, s.reps_completed)))
      const name = exName.get(exId) ?? 'Lift'

      if (!hist.length) {
        // First time logging this lift — a gentle "first" PR (not spammy: only weighted).
        prs.push({ exercise: name, kind: 'first', value: sessBestW, deltaLbs: null, unit: 'lbs' })
        continue
      }

      const histBestW = Math.max(...hist.map(s => s.weight_lbs!))
      const histBestReps = Math.max(...hist.map(s => s.reps_completed))
      const histBestE = Math.max(...hist.map(s => estimate1RM(s.weight_lbs!, s.reps_completed)))

      // Prefer the most impressive PR per exercise: weight > estimated-1RM > reps.
      if (sessBestW > histBestW) {
        prs.push({ exercise: name, kind: 'weight', value: sessBestW, deltaLbs: Math.round(sessBestW - histBestW), unit: 'lbs' })
      } else if (sessBestE > histBestE) {
        prs.push({ exercise: name, kind: 'e1rm', value: Math.round(sessBestE), deltaLbs: Math.round(sessBestE - histBestE), unit: 'lbs' })
      } else if (sessBestReps > histBestReps) {
        prs.push({ exercise: name, kind: 'reps', value: sessBestReps, deltaLbs: null, unit: 'reps' })
      }
    }

    // Most impressive first: real weight/e1rm gains, then reps, then firsts.
    const rank = (p: SessionPR) => p.kind === 'first' ? 0 : (p.deltaLbs ?? 1)
    return prs.sort((a, b) => rank(b) - rank(a))
  } catch {
    return []
  }
}

/** One-line label for a PR, e.g. "Bench Press: +10 lbs (225)". */
export function prLine(pr: SessionPR): string {
  switch (pr.kind) {
    case 'weight': return `${pr.exercise}: ${pr.value} lbs${pr.deltaLbs ? ` (+${pr.deltaLbs})` : ''}`
    case 'e1rm':   return `${pr.exercise}: est. 1RM ${pr.value} lbs${pr.deltaLbs ? ` (+${pr.deltaLbs})` : ''}`
    case 'reps':   return `${pr.exercise}: ${pr.value} reps — rep PR`
    case 'first':  return `${pr.exercise}: first logged at ${pr.value} lbs`
  }
}
