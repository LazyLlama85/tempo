// Tempo — periodization (the mesocycle layer).
//
// The per-exercise engine in `progression.ts` decides load *reactively* ("you
// cleared 12 reps → add 5 lb"). This module sits on top of it and gives the plan
// *structure over weeks*: a planned overload wave and a scheduled deload, shaped
// by the plan's `adaptation_mode`. Together they make the app behave like a coach
// running a block, not a generator repeating the same week four times.
//
// Division of responsibility (deliberate, to avoid double-counting load):
//   • progression.ts owns week-to-week LOAD progression (reactive autoregulation).
//   • periodization.ts owns planned VOLUME waves + the scheduled DELOAD, and only
//     ever touches load on a deload week (a one-week dip, so nothing compounds).

import type { Experience, AdaptationMode } from '@/types'

export type { AdaptationMode }
export type Phase = 'base' | 'build' | 'peak' | 'deload' | 'maintain'

export interface WeekProgression {
  weekIndex: number     // 0-based position within the block this workout maps to
  phase: Phase
  intensityPct: number  // load multiplier vs. the autoregulated baseline; 1.0 except on deload
  setsDelta: number     // +/- working sets vs. the base scheme
  repBias: number       // shift applied to rep targets (negative trims reps, e.g. deload)
  isDeload: boolean
  label: string         // short UI label, e.g. "Peak"
  note: string          // one-line coaching rationale
}

export const BLOCK_WEEKS = 4

type WeekDef = Omit<WeekProgression, 'weekIndex'>

// ── Mesocycle tables, one per adaptation_mode ─────────────────────────────────
// intensityPct stays 1.0 on working weeks (load is driven by autoregulation); it
// only drops on a deload so planned and reactive load never stack.

const NORMAL: WeekDef[] = [
  { phase: 'base',   intensityPct: 1.0,  setsDelta: 0,  repBias: 0,  isDeload: false, label: 'Base',   note: 'Dial in your working weights — leave a rep in reserve.' },
  { phase: 'build',  intensityPct: 1.0,  setsDelta: 0,  repBias: 0,  isDeload: false, label: 'Build',  note: 'Add load or reps anywhere you cleared the range last week.' },
  { phase: 'peak',   intensityPct: 1.0,  setsDelta: 1,  repBias: 0,  isDeload: false, label: 'Peak',   note: 'Overload week — one extra set per lift to drive adaptation.' },
  { phase: 'deload', intensityPct: 0.85, setsDelta: -1, repBias: -2, isDeload: true,  label: 'Deload', note: 'Planned recovery — lighter with less volume so you supercompensate.' },
]

// No progressive overload — hold fitness with a steady, sustainable load.
const MAINTENANCE: WeekDef[] = [
  { phase: 'maintain', intensityPct: 1.0, setsDelta: 0,  repBias: 0,  isDeload: false, label: 'Maintain', note: 'Hold steady — same effort, no added volume this block.' },
  { phase: 'maintain', intensityPct: 1.0, setsDelta: 0,  repBias: 0,  isDeload: false, label: 'Maintain', note: 'Keep showing up at the same quality; consistency is the goal.' },
  { phase: 'maintain', intensityPct: 1.0, setsDelta: 0,  repBias: 0,  isDeload: false, label: 'Maintain', note: 'Stay the course — protect what you have built.' },
  { phase: 'deload',   intensityPct: 0.9, setsDelta: -1, repBias: -1, isDeload: true,  label: 'Easy week', note: 'A lighter week to stay fresh.' },
]

// User is beaten up (repeated "too hard" / missed sessions): reduced volume, an
// immediate easy week, then a gradual rebuild.
const RECOVERY: WeekDef[] = [
  { phase: 'deload', intensityPct: 0.85, setsDelta: -1, repBias: -2, isDeload: true,  label: 'Reset',   note: "You've been grinding — this week is a deliberate step back to recover." },
  { phase: 'base',   intensityPct: 0.95, setsDelta: -1, repBias: -1, isDeload: false, label: 'Rebuild', note: 'Ease back in: trimmed volume, clean reps, nothing maximal.' },
  { phase: 'build',  intensityPct: 1.0,  setsDelta: 0,  repBias: 0,  isDeload: false, label: 'Build',   note: 'Back to full volume now that you have recovered.' },
  { phase: 'deload', intensityPct: 0.85, setsDelta: -1, repBias: -2, isDeload: true,  label: 'Deload',  note: 'Planned recovery to lock in the rebuild.' },
]

// "You need a break now": lead with a deload, then resume a normal ramp.
const DELOAD_FIRST: WeekDef[] = [NORMAL[3], NORMAL[0], NORMAL[1], NORMAL[2]]

function tableFor(mode: AdaptationMode): WeekDef[] {
  switch (mode) {
    case 'maintenance': return MAINTENANCE
    case 'recovery':    return RECOVERY
    case 'deload':      return DELOAD_FIRST
    default:            return NORMAL
  }
}

/**
 * The progression directive for a given week of the block. `weekIndex` is taken
 * modulo the block length, so a plan that repeats past 4 weeks keeps cycling the
 * wave. Beginners get a gentler treatment: no volume spike on the peak week
 * (steady linear load is plenty of stimulus) and a shallower deload.
 */
export function weekProgression(
  weekIndex: number,
  experience: Experience,
  mode: AdaptationMode = 'normal',
): WeekProgression {
  const table = tableFor(mode)
  const i = ((weekIndex % BLOCK_WEEKS) + BLOCK_WEEKS) % BLOCK_WEEKS
  const def = { ...table[i] }

  if (experience === 'beginner') {
    if (def.phase === 'peak') def.setsDelta = 0           // linear load instead of a volume spike
    if (def.isDeload) def.intensityPct = Math.max(def.intensityPct, 0.9) // milder deload
  }

  return { weekIndex, ...def }
}

/** True when a deload/easy week — used to surface a "lighter by design" banner. */
export function isRecoveryWeek(p: WeekProgression | null | undefined): boolean {
  return !!p?.isDeload
}
