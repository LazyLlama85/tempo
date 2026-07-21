// Tempo — free-tier conflict-card dismissal (§24/§30 L2).
//
// findCalendarConflicts (lib/autoSchedule.ts) re-detects the same conflicts
// every app-open sweep, so without this a dismissed card would just reappear
// on the next open. Device-local, same localStorage idiom as lib/feedSeen.ts
// and lib/badges.ts's seen-badge tracking. Keyed by workout id alone — each
// scheduled_workouts row is a distinct session, so this can't accidentally
// suppress a genuinely different conflict on a different day.

const key = (userId: string) => `tempo.conflict.dismissed.${userId}`

function readSet(userId: string): Set<string> {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(key(userId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

export function isConflictDismissed(userId: string, workoutId: string): boolean {
  return readSet(userId).has(workoutId)
}

export function dismissConflict(userId: string, workoutId: string): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (!ls) return
    const merged = readSet(userId)
    merged.add(workoutId)
    ls.setItem(key(userId), JSON.stringify([...merged]))
  } catch { /* best-effort */ }
}
