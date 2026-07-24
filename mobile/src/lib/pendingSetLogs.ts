// Tempo — offline retry queue for logged sets (the scoped fix, not a generic
// offline-write framework — see PRODUCT_AUDIT.html's Reliability row, 2026-07-23).
//
// The gap this closes: `plan.tsx`'s `handleSetDone` already handles a failed
// set-log insert well — it un-checks the set and shows a one-time "tap ✓ to
// retry" alert, so a network blip is never silent. But that recovery only lives
// in React state. If the user closes the app before retrying, the set is gone —
// it was never written anywhere durable. This module is the durable fallback:
// stage the exact insert payload locally the moment it fails, and replay
// whatever's still pending the next time the app opens.
//
// Deliberately scoped to ONE table, ONE call site, and ONE flush trigger
// (cold app-open) rather than a generic queue every mutation in the app could
// register with — CLAUDE.md's guardrails are explicit that unrequested
// abstraction is exactly how this class of feature goes wrong. If another
// mutation needs the same treatment later, that's a new, deliberate decision,
// not something this module should pre-guess.
//
// Storage: extends lib/prefStorage's existing write/read-both-ways pattern
// (sync localStorage + async expo-sqlite/kv-store) rather than introducing a
// second storage mechanism — one JSON array under one key.

import type { SupabaseClient } from '@supabase/supabase-js'
import { readPref, writePref } from './prefStorage'

const STORAGE_KEY = 'tempo.pendingSetLogs'
// A device that stays offline across many cold opens shouldn't accumulate an
// unbounded backlog — oldest-first eviction past this cap. Generous: a user
// logging this many sets while genuinely offline across multiple sessions is
// already an edge case worth capping, not optimizing for.
const MAX_QUEUED = 200

export interface SetLogInsert {
  workout_log_id: string
  exercise_id: string
  set_number: number
  reps_completed: number
  weight_lbs: number | null
  duration_sec: number | null
  distance_m: number | null
  rpe: number | null
  is_warmup: boolean
  completed_at: string
}

interface QueuedSetLog extends SetLogInsert {
  /** Locally generated — storage key only, never sent to the server. */
  queueId: string
  queuedAt: string
}

async function readQueue(): Promise<QueuedSetLog[]> {
  try {
    const raw = await readPref(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedSetLog[]): void {
  try { writePref(STORAGE_KEY, JSON.stringify(queue)) } catch { /* best-effort, matches prefStorage's own contract */ }
}

/**
 * The natural key `attachRpe`/the edit-set path already use for a logged set —
 * used here to find and clear a stale queued entry once the set that failed
 * has since been logged successfully some other way (a manual retry, most
 * commonly), so a later flush can't insert it a second time.
 */
function naturalKey(s: Pick<SetLogInsert, 'workout_log_id' | 'exercise_id' | 'set_number'>): string {
  return `${s.workout_log_id}:${s.exercise_id}:${s.set_number}`
}

/** Stage a failed set-log insert so it survives the app closing. Never throws. */
export async function queuePendingSetLog(entry: SetLogInsert): Promise<void> {
  try {
    const queue = await readQueue()
    const key = naturalKey(entry)
    // A retry of the same set replaces its own stale queued attempt (fresher
    // reps/weight if the user edited before retrying) rather than stacking a
    // second entry for the same set.
    const next = queue.filter((q) => naturalKey(q) !== key)
    next.push({ ...entry, queueId: `${key}:${Date.now()}`, queuedAt: new Date().toISOString() })
    writeQueue(next.length > MAX_QUEUED ? next.slice(next.length - MAX_QUEUED) : next)
  } catch { /* best-effort — losing the queue entry is no worse than today's behavior */ }
}

/**
 * Clear any queued entry for a set that was just logged successfully by some
 * other path (the interactive manual retry, most commonly) — called on EVERY
 * successful set-log insert, not just ones that had a prior failure, so this
 * is always a no-op in the overwhelming common case (nothing queued for that
 * key) and cheap either way.
 */
export async function clearPendingSetLog(s: Pick<SetLogInsert, 'workout_log_id' | 'exercise_id' | 'set_number'>): Promise<void> {
  try {
    const queue = await readQueue()
    const key = naturalKey(s)
    if (!queue.some((q) => naturalKey(q) === key)) return // common case — nothing to write back
    writeQueue(queue.filter((q) => naturalKey(q) !== key))
  } catch { /* best-effort */ }
}

/**
 * Replay every queued set-log insert. Called once, at cold app-open, from the
 * SAME single-owner sweep F5 established for scheduling — not on every
 * foreground, matching that fix's own "don't introduce a new resume-time
 * sweep" guidance. Best-effort per entry: a still-offline device leaves its
 * entries queued for the next open rather than losing them.
 */
export async function flushPendingSetLogs(client: SupabaseClient): Promise<{ flushed: number; remaining: number }> {
  const queue = await readQueue()
  if (!queue.length) return { flushed: 0, remaining: 0 }

  const remaining: QueuedSetLog[] = []
  let flushed = 0
  for (const { queueId, queuedAt, ...payload } of queue) {
    try {
      const { error } = await client.from('set_logs').insert(payload)
      if (error) remaining.push({ ...payload, queueId, queuedAt })
      else flushed++
    } catch {
      remaining.push({ ...payload, queueId, queuedAt })
    }
  }
  writeQueue(remaining)
  return { flushed, remaining: remaining.length }
}
