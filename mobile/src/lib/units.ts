// Tempo — weight units (lb / kg).
//
// Storage is ALWAYS pounds (`weight_lbs` everywhere in the DB); the unit is purely
// a display-layer preference, persisted per device like the theme. Every surface
// that shows or accepts a weight goes through these helpers, so a kg user types kg
// and reads kg while the data model never changes.

import { create } from 'zustand'

export type WeightUnit = 'lb' | 'kg'

const STORAGE_KEY = 'tempo.units.weight'
const LB_PER_KG = 2.2046226218

// Synchronous read from the SQLite-backed localStorage polyfill (same pattern as
// the theme store) so the first render already shows the right unit.
function readInitialUnit(): WeightUnit {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem(STORAGE_KEY)
    return v === 'kg' || v === 'lb' ? v : 'lb'
  } catch {
    return 'lb'
  }
}

interface UnitState {
  unit: WeightUnit
  setUnit: (u: WeightUnit) => void
}

export const useUnitStore = create<UnitState>((set) => ({
  unit: readInitialUnit(),
  setUnit: (unit) => {
    try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(STORAGE_KEY, unit) } catch { /* best-effort */ }
    set({ unit })
  },
}))

/** Convenience hook — the current display unit. */
export const useWeightUnit = () => useUnitStore((s) => s.unit)

/** Short label for headers/suffixes: 'lbs' | 'kg'. */
export function unitLabel(unit: WeightUnit): 'lbs' | 'kg' {
  return unit === 'kg' ? 'kg' : 'lbs'
}

/** Stored lbs → display-unit NUMBER (kg to 1 decimal, lbs untouched-but-tidied). */
export function displayWeight(lbs: number, unit: WeightUnit): number {
  if (unit === 'kg') return Math.round((lbs / LB_PER_KG) * 10) / 10
  return Math.round(lbs * 10) / 10
}

/** Stored lbs → "225 lbs" / "102.5 kg". */
export function formatWeight(lbs: number, unit: WeightUnit): string {
  return `${displayWeight(lbs, unit)} ${unitLabel(unit)}`
}

/** Big totals (volume): stored lbs → localized whole number in the display unit. */
export function displayVolume(lbs: number, unit: WeightUnit): string {
  const n = unit === 'kg' ? lbs / LB_PER_KG : lbs
  return Math.round(n).toLocaleString()
}

/** Display-unit NUMBER → stored lbs (for prefilling inputs the user then edits). */
export function toInputString(lbs: number | null | undefined, unit: WeightUnit): string {
  if (lbs == null) return ''
  return String(displayWeight(lbs, unit))
}

/** What the user typed (in their unit) → stored lbs, or null when not a number. */
export function inputToLbs(text: string, unit: WeightUnit): number | null {
  const n = parseFloat(text)
  if (!Number.isFinite(n)) return null
  const lbs = unit === 'kg' ? n * LB_PER_KG : n
  return Math.round(lbs * 100) / 100
}

/** Per-week trend etc.: stored lbs delta → signed display string ("−0.5 kg"). */
export function formatWeightDelta(lbs: number, unit: WeightUnit): string {
  const v = displayWeight(Math.abs(lbs), unit)
  const sign = lbs > 0 ? '+' : lbs < 0 ? '−' : ''
  return `${sign}${v} ${unitLabel(unit)}`
}
