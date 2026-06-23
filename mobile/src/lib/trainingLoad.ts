// Tempo — training-load awareness for smart rescheduling.
//
// The difference between "a real coach moved this" and "an app dumped it in the next
// gap": when a workout has to move, we don't just find open time — we find a day that
// respects RECOVERY. Muscles need ~48h, so we avoid stacking the same region on
// back-to-back days, avoid creating 3-in-a-row training blocks, and keep the week
// balanced. Pure functions over the week's existing sessions, so it's unit-testable.

export type Region = 'push' | 'pull' | 'legs' | 'core' | 'other'

const REGION_KEYWORDS: { region: Region; keys: string[] }[] = [
  { region: 'push', keys: ['chest', 'pec', 'shoulder', 'delt', 'tricep'] },
  { region: 'pull', keys: ['back', 'lat', 'trap', 'rhomboid', 'bicep', 'forearm'] },
  { region: 'legs', keys: ['quad', 'hamstring', 'glute', 'calf', 'calves', 'adductor', 'abductor', 'hip'] },
  { region: 'core', keys: ['core', 'ab', 'oblique', 'lower_back', 'erector', 'spine'] },
]

// Coarse muscle regions a set of muscles touches (a workout usually spans a couple).
export function musclesToRegions(muscles: string[]): Set<Region> {
  const out = new Set<Region>()
  for (const raw of muscles) {
    const m = raw.toLowerCase()
    let matched = false
    for (const { region, keys } of REGION_KEYWORDS) {
      if (keys.some(k => m.includes(k))) { out.add(region); matched = true }
    }
    if (!matched) out.add('other')
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
}

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayDiff(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86400000)
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

  let reason: string
  if (recoveryConflict && recoveryConflict.dist === 1) {
    reason = `Gives your ${REGION_LABEL[recoveryConflict.region]} muscles more recovery`
  } else if (adjacentTrainingDays >= 2) {
    reason = 'Breaks up a long training stretch'
  } else if (workoutRegions.size && ![...workoutRegions].every(r => r === 'other')) {
    const main = [...workoutRegions].find(r => r !== 'other') as Region
    reason = `Well-spaced for ${REGION_LABEL[main]} day`
  } else {
    reason = 'Keeps your week balanced'
  }

  return { score, reason }
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
// a few days straight we either affirm a rest day or gently suggest one.
export function restDayAdvice(consecutiveDays: number, trainsToday: boolean): RestAdvice | null {
  if (consecutiveDays >= 3 && !trainsToday) {
    return {
      title: 'Rest day',
      body: `You've trained ${consecutiveDays} days straight. Today's recovery is where those gains actually lock in — take it.`,
    }
  }
  if (consecutiveDays >= 4 && trainsToday) {
    return {
      title: 'Consider a rest day',
      body: `That's ${consecutiveDays} days in a row. A recovery day now will leave you stronger for the rest of the week.`,
    }
  }
  return null
}
