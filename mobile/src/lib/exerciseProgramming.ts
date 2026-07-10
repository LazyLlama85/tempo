// Tempo — exercise programming intelligence (shared, pure, no I/O).
//
// The plan generator used to build sessions from the 8 coarse `movement_pattern`
// buckets, one exercise per slot. That's why generated leg days read like a random
// list: `movement_pattern` is miscategorised for programming (biceps curls are
// tagged `pull`, cleans are `hinge`, and calf raises / leg extensions / leg curls
// all collapse into `squat`/`hinge`), so the engine couldn't tell a compound from
// an isolation or a hamstring curl from a deadlift.
//
// This module classifies an exercise the way a coach thinks about it — a fine
// **slot** (the movement's job) and a **role** (its tier in the session) — derived
// from the signal that IS reliable on core rows: `primary_muscles` + name keywords
// + `movement_pattern` + `required_equipment`. It's a pure function reused by both
// plan generation (build sessions) and the runner (role-aware prescriptions), so
// there is no database change and no migration risk.

import type { MovementPattern } from '@/types'

// Minimal structural shape shared by every exercise row in the app (library rows,
// the runner's ExerciseRow, custom exercises).
export interface ClassifiableExercise {
  name: string
  movement_pattern: string
  primary_muscles?: readonly string[] | null
  secondary_muscles?: readonly string[] | null
  required_equipment?: readonly string[] | null
}

// The movement's specific job. Templates order sessions by these.
export type Slot =
  | 'squat' | 'hinge' | 'lunge' | 'knee_flexion' | 'quad_iso' | 'glute_iso' | 'calf'
  | 'h_push' | 'v_push' | 'chest_iso' | 'triceps'
  | 'h_pull' | 'v_pull' | 'rear_delt' | 'lat_raise' | 'biceps'
  | 'core' | 'cardio' | 'carry'

// The exercise's tier in a session — drives ORDER (power → compound → isolation →
// finisher) and rep scheme (compounds heavier/lower-rep, isolations higher-rep).
export type Role = 'power' | 'compound' | 'isolation' | 'core' | 'cardio'

export interface ExerciseClass {
  slot: Slot
  role: Role
  primaryMuscle: string
  /** Base lift family for anti-redundancy (two `deadlift`s never share a session). */
  family: string
}

// ── Slot groupings used by templates + selection ──────────────────────────────

export const LOWER_COMPOUND_SLOTS: Slot[] = ['squat', 'hinge', 'lunge']
export const LOWER_ISO_SLOTS: Slot[] = ['knee_flexion', 'quad_iso', 'glute_iso', 'calf']
export const PUSH_COMPOUND_SLOTS: Slot[] = ['h_push', 'v_push']
export const PUSH_ISO_SLOTS: Slot[] = ['chest_iso', 'lat_raise', 'triceps']
export const PULL_COMPOUND_SLOTS: Slot[] = ['h_pull', 'v_pull']
export const PULL_ISO_SLOTS: Slot[] = ['rear_delt', 'biceps']

const ISOLATION_SLOTS = new Set<Slot>([
  'knee_flexion', 'quad_iso', 'glute_iso', 'calf', 'chest_iso', 'triceps',
  'rear_delt', 'lat_raise', 'biceps',
])

// ── Keyword tables (name is the most reliable disambiguator) ──────────────────
// Order matters: the first match wins, so more-specific patterns come first.

const POWER_RE = /\b(clean|snatch|jerk|power\s|high\s?pull|push\s?press|jump\s?squat|box\s?jump|broad\s?jump|hang\s(clean|snatch)|plyo|explosive)\b/i

const SLOT_RULES: { re: RegExp; slot: Slot }[] = [
  // Lower isolation (must precede the broad squat/hinge matches)
  { re: /\bcalf|calves|toe\s?raise|standing\s+heel\b/i, slot: 'calf' },
  { re: /\b(leg|lying|seated|hamstring|glute[-\s]?ham|nordic)\s*(curl|curls)\b/i, slot: 'knee_flexion' },
  { re: /\bnordic\b/i, slot: 'knee_flexion' },
  { re: /\b(leg|knee)\s*extension/i, slot: 'quad_iso' },
  { re: /\b(sissy\s?squat)\b/i, slot: 'quad_iso' },
  { re: /\b(hip\s?thrust|glute\s?bridge|glute\s?kickback|glute\s?(ham)?\s?raise|donkey\s?kick|hip\s?extension|abduction|abductor)\b/i, slot: 'glute_iso' },
  { re: /\b(adduction|adductor|inner\s?thigh)\b/i, slot: 'quad_iso' },
  // Lower compound
  { re: /\b(lunge|split\s?squat|bulgarian|step[-\s]?up|step[-\s]?ups|curtsy|cossack|skater)\b/i, slot: 'lunge' },
  { re: /\b(romanian|rdl|stiff[-\s]?leg|straight[-\s]?leg|good\s?morning|deadlift|dead\s?lift|hip\s?hinge|kettlebell\s?swing|swing|pull[-\s]?through|back\s?extension|hyperextension)\b/i, slot: 'hinge' },
  { re: /\b(squat|leg\s?press|hack|goblet|pistol|wall\s?sit|belt\s?squat|sled\s?press|smith\s+squat)\b/i, slot: 'squat' },
  // Upper isolation (precede the broad press/pull matches). Rear-delt BEFORE the
  // lateral-raise rule so "Rear Lateral Raise" reads as a rear delt, not a side raise.
  { re: /\b(rear[-\s]?delt|rear[-\s]?lateral|reverse\s?(fly|flye|pec)|face\s?pull|rear\s?deltoid|bent[-\s]?over\s?(lateral|reverse))\b/i, slot: 'rear_delt' },
  { re: /\b(lateral|side)\s*raise|\bside\s?lateral|\blaterals\b|\begyptian\b/i, slot: 'lat_raise' },
  { re: /\b(fly|flye|pec\s?deck|cross[-\s]?over|crossover|pec\s?fly|cable\s?cross)\b/i, slot: 'chest_iso' },
  { re: /\b(tricep|triceps|pushdown|press[-\s]?down|push[-\s]?down|skull\s?crush|skullcrusher|kickback|overhead\s?(tricep|extension)|jm\s?press)\b/i, slot: 'triceps' },
  // Upper compound push
  { re: /\b(overhead\s?press|shoulder\s?press|military|ohp|arnold\s?press|z\s?press|landmine\s?press|pike\s?push|handstand)\b/i, slot: 'v_push' },
  { re: /\b(bench|chest\s?press|incline\s?press|decline\s?press|push[-\s]?ups?|pushup|floor\s?press|dips?|chest\s?dip|machine\s?press|svend)\b/i, slot: 'h_push' },
  // Upper pull isolation (biceps must precede any generic "curl", but AFTER leg curl handled above)
  { re: /\b(shrug|shrugs|upright\s?row)\b/i, slot: 'h_pull' },
  { re: /\b(bicep|biceps|hammer\s?curl|preacher|concentration\s?curl|drag\s?curl|spider\s?curl|ez[-\s]?bar\s?curl|barbell\s?curl|dumbbell\s?curl|cable\s?curl|incline\s?curl|zottman|21s)\b/i, slot: 'biceps' },
  { re: /\bcurl\b/i, slot: 'biceps' }, // any remaining curl (leg curls already claimed above)
  // Upper compound pull
  { re: /\b(pulldown|pull[-\s]?down|pull[-\s]?up|pullup|chin[-\s]?up|chinup|lat\s?pull|muscle[-\s]?up|pullover)\b/i, slot: 'v_pull' },
  { re: /\b(row|rows|rowing)\b/i, slot: 'h_pull' },
  // Carry / core / cardio
  { re: /\b(carry|farmer|suitcase|yoke|waiter\s?walk)\b/i, slot: 'carry' },
]

// Muscle → fallback slot when the name alone gives nothing.
const MUSCLE_SLOT: Record<string, Slot> = {
  quads: 'squat', hamstrings: 'hinge', glutes: 'glute_iso', calves: 'calf',
  legs: 'squat', inner_thighs: 'quad_iso', adductors: 'quad_iso', abductors: 'glute_iso',
  chest: 'h_push', upper_chest: 'h_push',
  shoulders: 'v_push', lateral_deltoids: 'lat_raise', front_deltoids: 'v_push',
  rear_delts: 'rear_delt', rotator_cuff: 'rear_delt',
  lats: 'h_pull', back: 'h_pull', upper_back: 'h_pull', rhomboids: 'h_pull',
  traps: 'h_pull', teres_major: 'h_pull',
  biceps: 'biceps', brachialis: 'biceps', forearms: 'biceps',
  triceps: 'triceps',
  abs: 'core', obliques: 'core', core: 'core', transverse_abdominis: 'core',
  hip_flexors: 'core', lower_back: 'hinge', erectors: 'hinge',
}

const PATTERN_SLOT: Record<string, Slot> = {
  push: 'h_push', pull: 'h_pull', squat: 'squat', hinge: 'hinge',
  core: 'core', cardio: 'cardio', carry: 'carry', mobility: 'core',
}

// Family key for anti-redundancy — the base lift a name is a variation of, so two
// "deadlift" variants (Romanian, Trap Bar) never land in the same session.
const FAMILY_RE: { re: RegExp; family: string }[] = [
  { re: /\bdead\s?lift|deadlift\b/i, family: 'deadlift' },
  { re: /\bromanian|rdl|stiff[-\s]?leg|straight[-\s]?leg\b/i, family: 'rdl' },
  { re: /\bgood\s?morning\b/i, family: 'good_morning' },
  { re: /\bhip\s?thrust|glute\s?bridge\b/i, family: 'hip_thrust' },
  // Lunges/split-squats before the generic squat, so a split squat is its own
  // family and can share a session with a back squat.
  { re: /\blunge|split\s?squat|bulgarian|step[-\s]?up\b/i, family: 'lunge' },
  { re: /\bleg\s?press\b/i, family: 'leg_press' },
  { re: /\bsquat\b/i, family: 'squat' },
  { re: /\bleg\s?extension\b/i, family: 'leg_extension' },
  { re: /\b(leg|lying|seated)\s*curl|nordic\b/i, family: 'leg_curl' },
  { re: /\bcalf|calves\b/i, family: 'calf' },
  { re: /\bbench|chest\s?press\b/i, family: 'bench' },
  { re: /\bincline\b/i, family: 'incline_press' },
  { re: /\bdip\b/i, family: 'dip' },
  { re: /\bpush[-\s]?up|pushup\b/i, family: 'pushup' },
  { re: /\boverhead\s?press|shoulder\s?press|military|ohp\b/i, family: 'ohp' },
  { re: /\bfly|flye|pec\s?deck|crossover\b/i, family: 'fly' },
  { re: /\blateral|side\s?raise\b/i, family: 'lateral_raise' },
  { re: /\bface\s?pull|rear[-\s]?delt|reverse\s?fly\b/i, family: 'rear_delt' },
  { re: /\bpulldown|pull[-\s]?down|lat\s?pull\b/i, family: 'pulldown' },
  { re: /\bpull[-\s]?up|pullup|chin[-\s]?up\b/i, family: 'pullup' },
  { re: /\brow\b/i, family: 'row' },
  { re: /\bshrug\b/i, family: 'shrug' },
  { re: /\bpushdown|press[-\s]?down|skull|tricep\b/i, family: 'triceps' },
  { re: /\bcurl\b/i, family: 'curl' },
  { re: /\bcrunch|sit[-\s]?up|plank|russian\s?twist|leg\s?raise|ab\s?\b/i, family: 'core' },
]

function familyOf(name: string, slot: Slot): string {
  for (const { re, family } of FAMILY_RE) if (re.test(name)) return family
  return slot // fall back to the slot itself as the family bucket
}

/** Classify an exercise into its coaching slot + role. Pure + deterministic. */
export function classifyExercise(ex: ClassifiableExercise): ExerciseClass {
  const name = ex.name ?? ''
  const primary = (ex.primary_muscles?.[0] ?? '').toLowerCase()
  const isPower = POWER_RE.test(name)

  // Cardio-tagged rows are conditioning finishers even when their name contains a
  // strength keyword ("Rowing Machine" is not a barbell row) — unless they're an
  // explosive/power move (e.g. Box Jump), which we let fall through to a lower slot.
  if (ex.movement_pattern === 'cardio' && !isPower) {
    return { slot: 'cardio', role: 'cardio', primaryMuscle: primary || 'cardio', family: 'cardio' }
  }

  // 1) Slot: name keywords first, then primary muscle, then movement pattern.
  let slot: Slot | null = null
  for (const { re, slot: s } of SLOT_RULES) {
    if (re.test(name)) { slot = s; break }
  }
  if (!slot) slot = MUSCLE_SLOT[primary] ?? PATTERN_SLOT[ex.movement_pattern] ?? 'core'

  // 2) Role: power keywords win; core/cardio slots are their own role; the
  //    isolation slot set is isolation; everything else is a compound.
  let role: Role
  if (isPower) role = 'power'
  else if (slot === 'core') role = 'core'
  else if (slot === 'cardio') role = 'cardio'
  else if (ISOLATION_SLOTS.has(slot)) role = 'isolation'
  else role = 'compound'

  // Single-joint "compound-shaped" accessories (shrugs, upright rows, straight-arm
  // pulldowns, pullovers) live in a compound slot for muscle coverage but must not
  // outrank real rows/pulldowns for a primary/secondary compound position.
  if (role === 'compound' && /\b(shrug|upright\s?row|straight[-\s]?arm|pullover|front\s?raise)\b/i.test(name)) {
    role = 'isolation'
  }

  return { slot, role, primaryMuscle: primary || ex.movement_pattern, family: familyOf(name, slot) }
}

// ── Rep-scheme modifiers by role (applied on top of the goal scheme) ──────────
// A primary compound skews heavier/lower-rep with longer rest; an isolation skews
// higher-rep with shorter rest — inside the SAME goal. Returned as deltas so the
// goal scheme (progression.ts) stays the single source of base numbers.
export interface RoleRepMod {
  setsDelta: number
  repLowDelta: number
  repHighDelta: number
  /** Multiplier on the goal's rest (compounds rest longer, isolations shorter). */
  restMult: number
}

export function roleRepMod(role: Role): RoleRepMod {
  switch (role) {
    case 'power':      return { setsDelta: 1, repLowDelta: -3, repHighDelta: -4, restMult: 1.15 }
    case 'compound':   return { setsDelta: 0, repLowDelta: 0,  repHighDelta: 0,  restMult: 1 }
    case 'isolation':  return { setsDelta: -1, repLowDelta: 3, repHighDelta: 4, restMult: 0.6 }
    case 'core':       return { setsDelta: 0, repLowDelta: 4,  repHighDelta: 6,  restMult: 0.6 }
    case 'cardio':     return { setsDelta: -1, repLowDelta: 0, repHighDelta: 0, restMult: 0.5 }
  }
}

export function isIsolation(slot: Slot): boolean {
  return ISOLATION_SLOTS.has(slot)
}

// ── Dev audit (Step 0) ────────────────────────────────────────────────────────
// Summarise how a pool classifies, so misclassifications can be eyeballed against
// real rows. Not shipped in any screen — called from a scratch script / test.
export function auditClassification(rows: ClassifiableExercise[]): Record<Slot, string[]> {
  const bySlot = {} as Record<Slot, string[]>
  for (const ex of rows) {
    const { slot } = classifyExercise(ex)
    ;(bySlot[slot] ??= []).push(ex.name)
  }
  return bySlot
}

// Re-export for callers that annotate slots with the coarse pattern.
export type { MovementPattern }
