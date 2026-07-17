// Tempo — per-exercise "logging per side" preference.
//
// There's no reliable way to know from an exercise's name/data alone whether a
// logged weight means "50 lbs total" or "50 lbs in each hand" (a dumbbell
// press, a single-arm row, a lunge holding one weight — all ambiguous without
// asking). Rather than a database column + a curation pass across the whole
// exercise library, this is a simple, optional, per-exercise toggle: when on,
// the number the user types is treated as per side and doubled into the
// actual stored total, so every existing volume/PR calculation (which already
// just reads the total) stays correct with zero changes anywhere else. Same
// device-local, keyed-by-name pattern as `restPrefs.ts`.

const KEY = 'tempo.unilateralPrefs'

type UnilateralMap = Record<string, boolean>

function read(): UnilateralMap {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY)
    return raw ? (JSON.parse(raw) as UnilateralMap) : {}
  } catch {
    return {}
  }
}

function write(map: UnilateralMap): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, JSON.stringify(map))
  } catch { /* best-effort */ }
}

/** Whether this exercise was last logged "per side" (×2 into the stored total). */
export function getUnilateralPref(exerciseName: string): boolean {
  return !!read()[exerciseName.trim().toLowerCase()]
}

/** Remember the per-side toggle state for this exercise name. */
export function setUnilateralPref(exerciseName: string, perSide: boolean): void {
  const map = read()
  const key = exerciseName.trim().toLowerCase()
  if (perSide) map[key] = true
  else delete map[key]
  write(map)
}
