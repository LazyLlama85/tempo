// Tempo — training-load awareness for smart rescheduling.
//
// The difference between "a real coach moved this" and "an app dumped it in the next
// gap": when a workout has to move, we don't just find open time — we find a day that
// respects RECOVERY. Muscles need ~48h, so we avoid stacking the same region on
// back-to-back days, avoid creating 3-in-a-row training blocks, and keep the week
// balanced. Pure functions over the week's existing sessions, so it's unit-testable.

import { toDateStr as dateStr, daysBetween } from '@/lib/dates'

export type Region = 'push' | 'pull' | 'legs' | 'core' | 'other'

// Exact-match lookup, not substring — a naive .includes() check misclassified
// 'lateral_deltoids' as PULL (it contains "lat", pull's keyword for "lats")
// alongside its correct PUSH tag, and 'abductor' as CORE in addition to its
// correct LEGS tag (it contains "ab", core's keyword for "abs"). Both muscles
// ended up double-counted against the wrong region, corrupting the 48h
// recovery scoring, day-suggestion logic, and (via the shared mapping) the
// volume-landmark MRV cap. Every muscle name the `exercises` table actually
// uses (primary_muscles/secondary_muscles — see exerciseSearch.ts's
// muscleGroupOf and exerciseProgramming.ts's MUSCLE_SLOT for the same
// vocabulary) maps to exactly one region here.
const MUSCLE_REGION: Record<string, Region> = {
  chest: 'push', upper_chest: 'push', serratus: 'push',
  shoulders: 'push', lateral_deltoids: 'push', front_deltoids: 'push',
  rear_delts: 'push', rotator_cuff: 'push', triceps: 'push',
  lats: 'pull', back: 'pull', upper_back: 'pull', rhomboids: 'pull',
  traps: 'pull', mid_traps: 'pull', upper_traps: 'pull', teres_major: 'pull',
  biceps: 'pull', brachialis: 'pull', forearms: 'pull',
  quads: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs', legs: 'legs',
  inner_thighs: 'legs', adductors: 'legs', abductors: 'legs',
  // hip_flexors was 'legs', which made every ab hold contribute leg training load
  // and leg fatigue to the recovery map — Hollow Body Hold and Hanging Leg Raise
  // are both ['abs','hip_flexors']. Same root cause as the Quick Workout target
  // area bug (founder, 2026-09-04); matches exerciseProgramming's own mapping.
  hip_flexors: 'core',
  core: 'core', abs: 'core', obliques: 'core', transverse_abdominis: 'core',
  lower_back: 'core', erectors: 'core',
}

// Coarse muscle regions a set of muscles touches (a workout usually spans a couple).
export function musclesToRegions(muscles: string[]): Set<Region> {
  const out = new Set<Region>()
  for (const raw of muscles) {
    out.add(MUSCLE_REGION[raw.toLowerCase()] ?? 'other')
  }
  return out
}

const REGION_LABEL: Record<Region, string> = {
  push: 'push', pull: 'pull', legs: 'leg', core: 'core', other: 'similar',
}

export interface DayLoad {
  date: string                 // 'YYYY-MM-DD'
  regions: Set<Region>
}

export interface DayScore {
  score: number                // lower is better
  reason: string               // human explanation for the chosen day
  tightRecovery: boolean       // true when even the best pick still stacks the same region only 1 day out
}

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
// dayDiff(a,b) = a - b (in days) — daysBetween(x,y) computes y-x, so this
// delegates as daysBetween(b,a) to keep the exact same sign convention every
// existing call site already expects.
function dayDiff(a: string, b: string): number {
  return daysBetween(b, a)
}
function shares(a: Set<Region>, b: Set<Region>): Region | null {
  for (const r of a) if (r !== 'other' && b.has(r)) return r
  return null
}

// Score a candidate day for a workout hitting `workoutRegions`, given the week's
// other sessions. Lower = better. Also returns the dominant reason so the UI can say
// *why* this day ("48h of recovery for your legs", "spaced from your push day").
export function scoreDay(candidate: Date, workoutRegions: Set<Region>, loads: DayLoad[]): DayScore {
  const cd = dateStr(startOfDay(candidate))
  let score = 0
  let recoveryConflict: { region: Region; dist: number } | null = null
  let adjacentTrainingDays = 0

  for (const load of loads) {
    if (load.date === cd) continue
    const dist = Math.abs(dayDiff(cd, load.date))
    if (dist === 1) adjacentTrainingDays++
    if (dist > 2) continue

    const overlap = shares(workoutRegions, load.regions)
    if (overlap) {
      // Same muscle region too soon — the core recovery penalty.
      if (dist === 1) { score += 45; if (!recoveryConflict || recoveryConflict.dist > 1) recoveryConflict = { region: overlap, dist: 1 } }
      else if (dist === 2) { score += 12; if (!recoveryConflict) recoveryConflict = { region: overlap, dist: 2 } }
    }
  }

  // Avoid building a 3-in-a-row training block (both neighbours already train).
  if (adjacentTrainingDays >= 2) score += 25
  else if (adjacentTrainingDays === 1) score += 6

  // Mild "sooner is better" so we don't push a workout further than recovery needs.
  const offset = Math.max(0, dayDiff(cd, dateStr(startOfDay(new Date()))))
  score += offset

  // A dist===1 conflict is the WORST case this function can land on (only one
  // day of recovery from the same region) — it only ever gets returned as the
  // winning candidate when every open day in the horizon has some conflict, so
  // this is the least-bad pick, not a good one. The old copy here claimed the
  // opposite ("gives more recovery"), which is backwards — that framing
  // actually fits the dist===2 case (a real, if modest, buffer).
  let reason: string
  if (recoveryConflict && recoveryConflict.dist === 1) {
    reason = `Earliest open day — still close to your last ${REGION_LABEL[recoveryConflict.region]} session`
  } else if (recoveryConflict && recoveryConflict.dist === 2) {
    reason = `Gives your ${REGION_LABEL[recoveryConflict.region]} muscles more recovery`
  } else if (adjacentTrainingDays >= 2) {
    reason = 'Breaks up a long training stretch'
  } else if (workoutRegions.size && ![...workoutRegions].every(r => r === 'other')) {
    const main = [...workoutRegions].find(r => r !== 'other') as Region
    reason = `Well-spaced for ${REGION_LABEL[main]} day`
  } else {
    reason = 'Keeps your week balanced'
  }

  return { score, reason, tightRecovery: recoveryConflict?.dist === 1 }
}

// Number of training days in an unbroken run ending yesterday — the signal for
// whether the body is due a rest day.
export function consecutiveTrainingDays(trainingDates: Set<string>, today: Date): number {
  let n = 0
  const d = startOfDay(today); d.setDate(d.getDate() - 1)
  while (trainingDates.has(dateStr(d))) { n++; d.setDate(d.getDate() - 1) }
  return n
}

export interface RestAdvice { title: string; body: string }

// A clear, non-naggy rest-day recommendation. Rest is when muscle is built, so after
// a genuinely long run with no rest, we affirm a rest day IF one is already open today.
//
// 2026-07-17 (founder report: "don't push rest days too much, some people only need
// one rest day a week, don't discourage from workouts"): two changes from the
// original thresholds. (1) Raised 3→6 consecutive days before affirming a rest
// day — a 6-day/week trainer with exactly one rest day (the common, healthy
// pattern this complaint names) was getting nagged every single week at the old
// threshold. (2) Removed the `trainsToday` branch entirely — it used to suggest
// resting even on a day the user already has a workout scheduled, which is
// actively discouraging a planned session, not just affirming an open one.
export function restDayAdvice(consecutiveDays: number, trainsToday: boolean): RestAdvice | null {
  if (consecutiveDays >= 6 && !trainsToday) {
    return {
      title: 'Rest day',
      body: `You've trained ${consecutiveDays} days straight. Today's recovery is where those gains actually lock in — take it.`,
    }
  }
  return null
}
