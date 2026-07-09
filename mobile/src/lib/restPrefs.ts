// Tempo — per-workout rest-length preference.
//
// The prescription suggests a rest per exercise, but people have a pace they
// like for a given workout. When the user picks a rest length during a session
// it's remembered for THAT workout (keyed by scheduled-workout focus, so the
// preference follows "Push" from week to week) via the SQLite-backed
// localStorage polyfill — same pattern as the unit/theme stores.

const KEY = 'tempo.restPrefs'

/** Recommended default when nothing is prescribed or saved (spec: 2 minutes). */
export const SUGGESTED_REST_SEC = 120

type RestMap = Record<string, number>

function read(): RestMap {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY)
    return raw ? (JSON.parse(raw) as RestMap) : {}
  } catch {
    return {}
  }
}

function write(map: RestMap): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, JSON.stringify(map))
  } catch { /* best-effort */ }
}

/** The user's saved rest for this workout name, if any. */
export function getRestPref(workoutFocus: string): number | null {
  const v = read()[workoutFocus.trim().toLowerCase()]
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Remember a rest length for this workout name. */
export function setRestPref(workoutFocus: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  const map = read()
  map[workoutFocus.trim().toLowerCase()] = Math.round(seconds)
  write(map)
}
