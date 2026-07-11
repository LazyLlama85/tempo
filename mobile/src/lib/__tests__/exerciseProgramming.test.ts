import {
  classifyExercise, roleRepMod, isIsolation,
  type ClassifiableExercise, type Slot, type Role,
} from '@/lib/exerciseProgramming'

const ex = (
  name: string,
  movement_pattern: string,
  primary_muscles: string[] = [],
): ClassifiableExercise => ({ name, movement_pattern, primary_muscles })

// A fixture of well-known exercises with the slot + role a coach would assign.
// Guards the classifier that every generated session is ordered and rep-schemed by.
const CASES: { ex: ClassifiableExercise; slot: Slot; role: Role }[] = [
  // Lower compound
  { ex: ex('Back Squat', 'squat', ['quads']), slot: 'squat', role: 'compound' },
  { ex: ex('Barbell Deadlift', 'hinge', ['hamstrings']), slot: 'hinge', role: 'compound' },
  { ex: ex('Romanian Deadlift', 'hinge', ['hamstrings']), slot: 'hinge', role: 'compound' },
  { ex: ex('Dumbbell RDL', 'hinge', ['hamstrings']), slot: 'hinge', role: 'compound' },
  { ex: ex('Walking Lunge', 'lunge', ['quads']), slot: 'lunge', role: 'compound' },
  { ex: ex('Bulgarian Split Squat', 'lunge', ['quads']), slot: 'lunge', role: 'compound' },
  { ex: ex('Leg Press', 'squat', ['quads']), slot: 'squat', role: 'compound' },
  // Lower isolation
  { ex: ex('Leg Extension', 'isolation', ['quads']), slot: 'quad_iso', role: 'isolation' },
  { ex: ex('Lying Leg Curl', 'isolation', ['hamstrings']), slot: 'knee_flexion', role: 'isolation' },
  { ex: ex('Standing Calf Raise', 'isolation', ['calves']), slot: 'calf', role: 'isolation' },
  { ex: ex('Barbell Hip Thrust', 'hinge', ['glutes']), slot: 'glute_iso', role: 'isolation' },
  // Push compound
  { ex: ex('Barbell Bench Press', 'push', ['chest']), slot: 'h_push', role: 'compound' },
  { ex: ex('Incline Dumbbell Press', 'push', ['chest']), slot: 'h_push', role: 'compound' },
  { ex: ex('Overhead Press', 'push', ['shoulders']), slot: 'v_push', role: 'compound' },
  // Push isolation
  { ex: ex('Dumbbell Lateral Raise', 'push', ['shoulders']), slot: 'lat_raise', role: 'isolation' },
  { ex: ex('Cable Fly', 'push', ['chest']), slot: 'chest_iso', role: 'isolation' },
  { ex: ex('Triceps Pushdown', 'push', ['triceps']), slot: 'triceps', role: 'isolation' },
  // Pull compound
  { ex: ex('Pull-up', 'pull', ['lats']), slot: 'v_pull', role: 'compound' },
  { ex: ex('Lat Pulldown', 'pull', ['lats']), slot: 'v_pull', role: 'compound' },
  { ex: ex('Barbell Row', 'pull', ['back']), slot: 'h_pull', role: 'compound' },
  // Pull isolation
  { ex: ex('Face Pull', 'pull', ['rear_delts']), slot: 'rear_delt', role: 'isolation' },
  { ex: ex('Barbell Curl', 'pull', ['biceps']), slot: 'biceps', role: 'isolation' },
  { ex: ex('Hammer Curl', 'pull', ['biceps']), slot: 'biceps', role: 'isolation' },
  // "Compound-shaped" accessory that must NOT outrank real rows → demoted to isolation
  { ex: ex('Barbell Shrug', 'pull', ['traps']), slot: 'h_pull', role: 'isolation' },
  { ex: ex('Upright Row', 'pull', ['shoulders']), slot: 'h_pull', role: 'isolation' },
  // Core
  { ex: ex('Plank', 'core', ['abs']), slot: 'core', role: 'core' },
  { ex: ex('Hanging Leg Raise', 'core', ['abs']), slot: 'core', role: 'core' },
  // Power (Olympic / plyo) — role wins regardless of the underlying slot
  { ex: ex('Power Clean', 'hinge', ['hamstrings']), slot: 'hinge', role: 'power' },
  { ex: ex('Box Jump', 'cardio', ['quads']), slot: 'squat', role: 'power' },
  // Carry
  { ex: ex("Farmer's Carry", 'carry', ['forearms']), slot: 'carry', role: 'compound' },
  // Cardio — a cardio-tagged row is a conditioning finisher, NOT a barbell row
  { ex: ex('Treadmill Run', 'cardio', []), slot: 'cardio', role: 'cardio' },
  { ex: ex('Rowing Machine', 'cardio', []), slot: 'cardio', role: 'cardio' },
]

describe('exerciseProgramming — classifier (slot + role)', () => {
  it.each(CASES)('classifies "$ex.name" as $slot / $role', ({ ex: e, slot, role }) => {
    const c = classifyExercise(e)
    expect(c.slot).toBe(slot)
    expect(c.role).toBe(role)
  })

  it('never leaves slot or role undefined for any fixture', () => {
    for (const { ex: e } of CASES) {
      const c = classifyExercise(e)
      expect(c.slot).toBeTruthy()
      expect(c.role).toBeTruthy()
      expect(c.primaryMuscle).toBeTruthy()
      expect(c.family).toBeTruthy()
    }
  })

  it('separates lift families so redundant variants never share a session', () => {
    const family = (name: string, mp: string, m: string[] = []) => classifyExercise(ex(name, mp, m)).family
    const squat = family('Back Squat', 'squat', ['quads'])
    const deadlift = family('Barbell Deadlift', 'hinge', ['hamstrings'])
    const split = family('Bulgarian Split Squat', 'lunge', ['quads'])
    // A back squat, a deadlift, and a split squat are three different families…
    expect(new Set([squat, deadlift, split]).size).toBe(3)
    // …but two bench variations are the SAME family (can't both open a push day).
    expect(family('Barbell Bench Press', 'push', ['chest']))
      .toBe(family('Close-Grip Bench Press', 'push', ['triceps']))
  })

  it('roleRepMod skews compounds heavier/longer-rest and isolations higher-rep/shorter-rest', () => {
    const compound = roleRepMod('compound')
    const isolation = roleRepMod('isolation')
    expect(compound.restMult).toBe(1)
    expect(isolation.repHighDelta).toBeGreaterThan(0) // more reps
    expect(isolation.restMult).toBeLessThan(1)         // less rest
    // Isolations never drop below the goal's set count.
    expect(isolation.setsDelta).toBe(0)
    // Power is the heaviest/lowest-rep tier.
    expect(roleRepMod('power').repLowDelta).toBeLessThan(0)
  })

  it('isIsolation agrees with the classifier', () => {
    expect(isIsolation('biceps')).toBe(true)
    expect(isIsolation('squat')).toBe(false)
  })
})
