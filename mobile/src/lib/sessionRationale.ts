// Tempo — "why this workout" reasoning.
//
// Most apps generate a workout and never explain it. This turns the classified
// slot/role structure of a session into plain-language coaching — why the squat
// leads, why the RDL follows, why isolation and calves finish — so a generated
// workout reads as *designed*, not random. Pure + derived at render time, so it's
// correct for any session, including one the user edited.

import { classifyExercise, isIsolation, type ClassifiableExercise, type Slot } from '@/lib/exerciseProgramming'

export interface SessionRationale {
  headline: string
  lines: string[]
}

const MUSCLE_LABEL: Record<string, string> = {
  quads: 'quads', hamstrings: 'hamstrings', glutes: 'glutes', calves: 'calves',
  chest: 'chest', upper_chest: 'upper chest', shoulders: 'shoulders',
  lats: 'back', back: 'back', upper_back: 'upper back', rhomboids: 'mid-back',
  biceps: 'biceps', triceps: 'triceps', rear_delts: 'rear delts',
  lateral_deltoids: 'side delts', abs: 'core', obliques: 'obliques',
}
const muscle = (m: string | undefined): string => (m ? (MUSCLE_LABEL[m] ?? m.replace(/_/g, ' ')) : 'the target muscles')

const SLOT_JOB: Partial<Record<Slot, string>> = {
  hinge: 'your hamstrings and posterior chain',
  knee_flexion: 'your hamstrings directly',
  quad_iso: 'your quads directly',
  calf: 'your calves',
  glute_iso: 'your glutes',
  lunge: 'each leg on its own for balance',
  chest_iso: 'your chest through a full stretch',
  lat_raise: 'your side delts',
  rear_delt: 'your rear delts and upper back',
  biceps: 'your biceps',
  triceps: 'your triceps',
}

/**
 * Build the reasoning for an ordered list of exercises. Names are used verbatim;
 * classification supplies the roles. Empty for a 0–1 exercise session.
 */
export function describeSession(exercises: ClassifiableExercise[], focus?: string): SessionRationale | null {
  if (exercises.length < 2) return null
  const classed = exercises.map((ex) => ({ ex, c: classifyExercise(ex) }))
  const compounds = classed.filter((x) => x.c.role === 'compound' || x.c.role === 'power')
  const isolations = classed.filter((x) => isIsolation(x.c.slot) && x.c.role === 'isolation')
  const finishers = classed.filter((x) => x.c.role === 'core' || x.c.role === 'cardio')

  const primary = classed[0]
  const lines: string[] = []

  // 1) Why the opener leads.
  if (primary) {
    const isPower = primary.c.role === 'power'
    lines.push(
      isPower
        ? `You open with ${primary.ex.name} — an explosive movement done first, while your nervous system is fresh.`
        : `You open with ${primary.ex.name} — your highest-priority compound. Heavy, multi-joint work goes first, while you're freshest.`,
    )
  }

  // 2) Why the second compound follows.
  const second = compounds[1]
  if (second && second !== primary) {
    const job = SLOT_JOB[second.c.slot]
    lines.push(
      job
        ? `${second.ex.name} follows to train ${job} without cutting into your ${primary.ex.name} performance.`
        : `${second.ex.name} follows as your second big lift, complementing the opener.`,
    )
  }

  // 3) Accessory / isolation block.
  if (isolations.length) {
    const names = isolations.slice(0, 3).map((x) => x.ex.name).join(', ')
    lines.push(
      `Once the heavy lifting is done, isolation work (${names}) adds targeted volume with lighter loads and higher reps.`,
    )
  }

  // 4) Finisher.
  if (finishers.length) {
    const f = finishers[0]
    lines.push(
      f.c.role === 'cardio'
        ? `${f.ex.name} closes the session to keep your conditioning up.`
        : `${f.ex.name} finishes with core work, when fatigue won't compromise your big lifts.`,
    )
  }

  const headline = focus
    ? `Your ${focus} session, in order of priority`
    : 'Ordered the way a coach would program it'
  return { headline, lines }
}
