// Tempo — volume landmarks (MEV/MRV), the RP-style ceiling the volume model
// lacked (audit, Fitness Science: "no true volume landmarks (MEV/MRV/MAV per
// muscle) — RP-style volume management is the current science standard; yours
// is a simplified wave"). B5.4.
//
// Scope, deliberately conservative: this titrates a CAP against the weekly
// Maximum Recoverable Volume (MRV) — protecting against overtraining, the
// scientifically urgent direction — using REAL completed volume for the week
// so far (not a hypothetical future-sessions projection, which would need
// cross-workout aggregation at prescription time and is a materially riskier
// change). It does not auto-add sets when a muscle is under its Minimum
// Effective Volume (MEV); under-MEV is a plan-design question, not something
// to hack per-exercise, and forcing more sets would silently inflate session
// length in ways `progression.ts`'s duration model doesn't expect. Two-way
// titration (a real floor, not just a cap) is a defensible future iteration
// once this lands.
//
// Landmarks are standard RP-ish weekly-set ranges for an INTERMEDIATE lifter;
// beginners get a lower MRV (they adapt to, and recover from, far less —
// overshooting recovery capacity is the single most common novice
// programming mistake), advanced lifters a higher one (built recoverable
// capacity through progressive overload over years).

import type { Experience } from '@/types'

export type LandmarkMuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core'

export interface VolumeLandmark {
  mev: number // Minimum Effective Volume — below this, growth stimulus is marginal
  mrv: number // Maximum Recoverable Volume — above this, fatigue outpaces recovery
}

// Weekly working sets, intermediate baseline. Arms/core sit lower than the
// majors — they're worked indirectly by every push/pull/hinge/squat exercise,
// so their *direct* landmark is smaller by design, not an oversight.
const INTERMEDIATE_LANDMARKS: Record<LandmarkMuscleGroup, VolumeLandmark> = {
  chest:     { mev: 8,  mrv: 20 },
  back:      { mev: 10, mrv: 22 },
  shoulders: { mev: 8,  mrv: 20 },
  legs:      { mev: 8,  mrv: 18 },
  arms:      { mev: 6,  mrv: 18 },
  core:      { mev: 4,  mrv: 16 },
}

// Experience scales the ceiling, not the floor — MEV barely moves (the
// stimulus needed to grow at all doesn't change much), but recoverable
// capacity does.
const MRV_MULT: Record<Experience, number> = {
  beginner: 0.7,
  intermediate: 1.0,
  advanced: 1.25,
}

export function landmarkFor(group: LandmarkMuscleGroup, experience: Experience = 'intermediate'): VolumeLandmark {
  const base = INTERMEDIATE_LANDMARKS[group]
  const mult = MRV_MULT[experience] ?? 1.0
  return { mev: base.mev, mrv: Math.round(base.mrv * mult) }
}

export function isLandmarkMuscleGroup(group: string | null | undefined): group is LandmarkMuscleGroup {
  return !!group && group in INTERMEDIATE_LANDMARKS
}

export interface VolumeTitration {
  sets: number
  capped: boolean
  note?: string
}

/**
 * Cap `requestedSets` so this muscle group's REAL weekly volume (already-
 * completed sets so far this week, `setsThisWeek`) plus this session's sets
 * never exceeds its weekly MRV. Never caps below 2 (progression.ts's own sane
 * floor) — protecting recovery should never leave a session with no working
 * sets at all. A no-op (returns `requestedSets` unchanged) whenever there's
 * room, so this only ever REDUCES volume, never silently changes a session
 * that was already within range.
 */
export function titrateForWeeklyVolume(
  requestedSets: number,
  group: LandmarkMuscleGroup,
  setsThisWeek: number,
  experience: Experience = 'intermediate',
): VolumeTitration {
  const { mrv } = landmarkFor(group, experience)
  const room = mrv - setsThisWeek
  if (requestedSets <= room) return { sets: requestedSets, capped: false }
  // The 2-set floor wins over strict MRV math in the rare case where there's
  // less than 2 sets of room left — a near-zero-set session is a worse outcome
  // than finishing 1-2 sets over the weekly ceiling for one exercise.
  const sets = Math.max(2, room)
  if (sets >= requestedSets) return { sets: requestedSets, capped: false }
  return {
    sets,
    capped: true,
    note: `Capped to protect recovery — ${group} is already near its weekly volume limit.`,
  }
}
