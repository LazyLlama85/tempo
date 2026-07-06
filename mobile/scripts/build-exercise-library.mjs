#!/usr/bin/env node
// Tempo — build the expanded exercise library from the ExerciseDB catalog.
//
// Reads the full ExerciseDB dataset (fetched via RapidAPI, or a cached JSON file)
// and emits:
//   supabase/seed_exercise_library_v2.sql   — INSERT rows for every kept exercise
//   library-report.txt                      — human-readable curation report
//
// Each imported exercise gets a DETERMINISTIC UUID derived from its ExerciseDB id
// (edb00000-0000-4000-8000-<zero-padded id>), so the app can derive the form-GIF
// id straight from the exercise UUID with no lookup table (see data/exerciseMedia.ts)
// and re-running the script never duplicates rows (ON CONFLICT DO NOTHING).
//
// Usage:
//   node scripts/build-exercise-library.mjs --input path/to/exdb_all.json
//   node scripts/build-exercise-library.mjs            (fetches the catalog live)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = 'exercisedb.p.rapidapi.com'

// ── Catalog loading ───────────────────────────────────────────────────────────

function readKey() {
  if (process.env.EXPO_PUBLIC_RAPIDAPI_KEY) return process.env.EXPO_PUBLIC_RAPIDAPI_KEY.trim()
  try {
    const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
    return (env.match(/EXPO_PUBLIC_RAPIDAPI_KEY=(.+)/) || [])[1]?.trim()
  } catch { return undefined }
}

async function fetchCatalog() {
  const KEY = readKey()
  if (!KEY) throw new Error('Missing EXPO_PUBLIC_RAPIDAPI_KEY (env or mobile/.env.local)')
  const headers = { 'x-rapidapi-host': HOST, 'x-rapidapi-key': KEY }
  let all = []
  for (let offset = 0; ; offset += 10) {
    const r = await fetch(`https://${HOST}/exercises?limit=10&offset=${offset}`, { headers })
    if (!r.ok) throw new Error(`HTTP ${r.status} at offset ${offset}`)
    const page = await r.json()
    all = all.concat(page)
    if (page.length < 10) break
    await new Promise(res => setTimeout(res, 120))
  }
  return all
}

// ── Existing library (never re-import) ────────────────────────────────────────

// ExerciseDB ids already mapped to the original 50 seeded movements in
// src/data/exerciseMedia.ts — the canonical row for these movements is the
// hand-written seed, so the catalog entry is skipped.
function mappedExdbIds() {
  const src = fs.readFileSync(path.join(root, 'src/data/exerciseMedia.ts'), 'utf8')
  const ids = new Set()
  for (const m of src.matchAll(/exdbId:\s*'(\d{3,4})'/g)) ids.add(m[1])
  return ids
}

// Names of ALL existing seeded exercises (50 strength + 10 mobility) — normalized.
const EXISTING_NAMES = [
  'Push-Up', 'Bodyweight Squat', 'Reverse Lunge', 'Plank', 'Glute Bridge', 'Mountain Climber',
  'Burpee', 'Jumping Jack', 'Goblet Squat', 'Dumbbell Row', 'Dumbbell Shoulder Press',
  'Bicep Curl', 'Tricep Overhead Extension', 'Dumbbell Romanian Deadlift', 'Lateral Raise',
  'Dumbbell Chest Press', 'Barbell Back Squat', 'Barbell Bench Press', 'Conventional Deadlift',
  'Barbell Overhead Press', 'Barbell Bent-Over Row', 'Lat Pulldown', 'Seated Cable Row',
  'Leg Press', 'Leg Curl', 'Leg Extension', 'Cable Fly', 'Face Pull', 'Cable Bicep Curl',
  'Pull-Up', 'Dip', 'Bulgarian Split Squat', 'Incline Barbell Bench Press', 'Pendlay Row',
  'Sumo Deadlift', 'Pause Squat', 'Close-Grip Bench Press', 'Weighted Pull-Up', 'Power Clean',
  'Front Squat', 'Barbell Romanian Deadlift', 'Dead Bug', 'Hollow Body Hold', 'Ab Wheel Rollout',
  'Hanging Leg Raise', 'Russian Twist', 'Cable Crunch', 'Jump Rope', 'Box Jump', 'Rowing Machine',
  "World's Greatest Stretch", 'Ankle Mobility Rock', 'Shoulder Pass-Through', 'Downward Dog to Cobra',
  'Deep Squat Hold', 'Thoracic Rotation', '90/90 Hip Switch', 'Standing Hamstring Stretch',
  'Hip Flexor Stretch', 'Cat-Cow',
]

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const EXISTING_NORM = new Set(EXISTING_NAMES.map(norm))

// ── Drop rules ────────────────────────────────────────────────────────────────

const DROP_ID = new Set([
  '1463', '1464', // leg press camera-angle duplicates (side/back pov)
  '1604', // world greatest stretch — duplicate of the seeded mobility movement (GIF mapped to it instead)
])

function shouldDrop(e) {
  if (DROP_ID.has(e.id)) return 'drop-list'
  if (/\((side|back|front) pov\)/i.test(e.name)) return 'pov duplicate'
  // Partner-assisted movements (equipment "assisted...") can't be done alone;
  // machine-assisted dips/pull-ups use equipment "leverage machine" and are kept.
  if (e.equipment.startsWith('assisted')) return 'partner-assisted'
  if (/\bposing\b|body ?builder pose/i.test(e.name)) return 'posing'
  return null
}

// ── Name cleaning ─────────────────────────────────────────────────────────────

// Exact renames where the catalog name would confuse a lifter. Keyed by exdb id.
const RENAME = {
  '0738': '45° Calf Press',
  '0740': 'Wide-Stance Leg Press',
  '0741': 'Hack Squat (Narrow Stance)',
  '0742': 'Angled Standing Calf Raise',
  '0743': 'Hack Squat Machine',
  '0744': 'Lying Squat Machine',
  '1383': 'Hack Squat Calf Raise',
  '1384': 'Single-Leg Hack Squat Calf Raise',
  '1391': 'Calf Press on Leg Press',
  '1392': 'Single-Leg Calf Press on Leg Press',
  '1425': 'Single-Leg 45° Leg Press',
  '2334': 'Lying Calf Press Machine',
  '0685': 'Running',
  '0684': 'Treadmill Running',
  '3666': 'Incline Treadmill Walk',
  '2311': 'Stair Climber',
  '2138': 'Stationary Bike',
  '0798': 'Easy Stationary Bike',
  '2140': 'Wave Machine',
  '2141': 'Elliptical Trainer',
  '2331': 'Cross Trainer',
  '2142': 'Ski Ergometer',
  '2133': "Farmer's Walk",
  // Common-gym-name renames
  '0003': 'Bicycle Crunch',
  '0596': 'Pec Deck Fly',
  '0601': 'Reverse Pec Deck Fly (Parallel Grip)',
  '0602': 'Reverse Pec Deck Fly',
  '0201': 'Triceps Pushdown',
  '0060': 'Barbell Skull Crusher',
  '0812': 'Bench Dip',
  '0813': 'Bench Dip (Feet Elevated)',
  '0017': 'Assisted Pull-Up (Machine)',
  '0019': 'Assisted Dip (Machine)',
  '0009': 'Assisted Chest Dip (Machine)',
  '0705': 'Side Plank',
  '0620': 'Lying Leg Raise',
  '0979': 'Pallof Press (Band)',
  '2963': "Captain's Chair Leg Raise",
  '0551': 'Kettlebell Turkish Get-Up',
}

const SMALL_WORDS = new Set(['on', 'with', 'to', 'of', 'the', 'a', 'an', 'in', 'for', 'from', 'at', 'by', 'per', 'and', 'or', 'as'])

// Casing fixes applied after title-casing.
const CASE_FIX = [
  [/\bEz\b/g, 'EZ'], [/\bEz-Bar\b/g, 'EZ-Bar'], [/\bJm\b/g, 'JM'], [/\bT Bar\b/g, 'T-Bar'],
  [/\bV Bar\b/g, 'V-Bar'], [/\bV Up\b/g, 'V-Up'], [/\bY Raise\b/g, 'Y-Raise'],
  [/\bL Sit\b/g, 'L-Sit'], [/\bV Sit\b/g, 'V-Sit'], [/\bZottman\b/g, 'Zottman'],
  [/\bSuperman\b/g, 'Superman'], [/\bIso\b/g, 'Iso'], [/\bPnf\b/g, 'PNF'],
]

function cleanName(e) {
  if (RENAME[e.id]) return RENAME[e.id]
  let n = e.name
  // Render-gender suffixes carry no meaning for the movement itself.
  n = n.replace(/\s*\((male|female)\)\s*$/i, '').replace(/\s+(male|female)\s*$/i, '')
  // Version suffixes (v. 2 / version 2) — the base entry usually exists too; when
  // it doesn't, the suffix is still noise.
  n = n.replace(/\s*\(version \d\)\s*$/i, '').replace(/\s*v\. ?\d\s*$/i, '')
  // Equipment vocabulary → what gyms actually call it.
  n = n.replace(/^lever /i, 'machine ')
  n = n.replace(/^smith /i, 'smith machine ')
  n = n.replace(/^olympic barbell /i, 'barbell ')
  n = n.replace(/^ez barbell /i, 'ez-bar ')
  n = n.replace(/sled 45° /i, '45° ')
  n = n.replace(/^sled /i, 'machine ')
  n = n.replace(/45 degrees/i, '45°')
  // Title case (keep small words lowercase, first word always capitalized).
  n = n.split(' ').map((w, i) => {
    const lower = w.toLowerCase()
    if (i > 0 && SMALL_WORDS.has(lower)) return lower
    // Capitalize each hyphen-part: "push-up" → "Push-Up"
    return lower.split('-').map(p => (p ? p[0].toUpperCase() + p.slice(1) : p)).join('-')
  }).join(' ')
  for (const [re, to] of CASE_FIX) n = n.replace(re, to)
  return n
}

// ── Field mapping ─────────────────────────────────────────────────────────────

const EQUIPMENT_MAP = {
  'body weight': 'bodyweight',
  'barbell': 'barbell', 'olympic barbell': 'barbell', 'ez barbell': 'barbell', 'trap bar': 'barbell',
  'ez barbell, exercise ball': 'full_gym',
  'dumbbell': 'dumbbells',
  'dumbbell (used as handles for deeper range)': 'dumbbells',
  'dumbbell, exercise ball': 'full_gym',
  'dumbbell, exercise ball, tennis ball': 'full_gym',
  'kettlebell': 'kettlebell',
  'cable': 'full_gym', 'leverage machine': 'full_gym', 'sled machine': 'full_gym',
  'smith machine': 'full_gym', 'stationary bike': 'full_gym', 'elliptical machine': 'full_gym',
  'stepmill machine': 'full_gym', 'skierg machine': 'full_gym', 'upper body ergometer': 'full_gym',
  'medicine ball': 'full_gym', 'stability ball': 'full_gym', 'bosu ball': 'full_gym',
  'hammer': 'full_gym', 'tire': 'full_gym',
  'band': 'resistance_bands', 'resistance band': 'resistance_bands',
  'body weight (with resistance band)': 'resistance_bands',
  'weighted': 'dumbbells', // "hold any weight" — a dumbbell always works
  'rope': 'full_gym',      // rope climbs etc.; jump-rope names overridden to bodyweight below
  'wheel roller': 'bodyweight',
  'roller': 'bodyweight',
}

function equipmentOf(e) {
  if (e.equipment === 'rope' && /jump rope|skipping/i.test(e.name)) return 'bodyweight'
  return EQUIPMENT_MAP[e.equipment]
}

const MUSCLE_MAP = {
  'pectorals': 'chest', 'delts': 'shoulders', 'lats': 'lats', 'upper back': 'upper_back',
  'traps': 'traps', 'levator scapulae': 'neck', 'spine': 'lower_back',
  'serratus anterior': 'serratus', 'cardiovascular system': 'full_body',
  'abs': 'abs', 'quads': 'quads', 'hamstrings': 'hamstrings', 'glutes': 'glutes',
  'calves': 'calves', 'adductors': 'adductors', 'abductors': 'abductors',
  'biceps': 'biceps', 'triceps': 'triceps', 'forearms': 'forearms',
}

const SECONDARY_FIX = {
  'rear deltoids': 'rear_delts', 'anterior deltoid': 'shoulders', 'front deltoids': 'shoulders',
  'spinal erectors': 'erectors', 'erector spinae': 'erectors', 'lower back': 'lower_back',
  'upper back': 'upper_back', 'hip flexors': 'hip_flexors', 'inner thighs': 'inner_thighs',
  'rotator cuff': 'rotator_cuff', 'core': 'core', 'obliques': 'obliques',
  'cardiovascular system': 'full_body', 'ankle stabilizers': 'calves', 'grip muscles': 'forearms',
  'wrist flexors': 'forearms', 'wrist extensors': 'forearms', 'shoulder stabilizers': 'rotator_cuff',
  'deltoids': 'shoulders', 'pectorals': 'chest', 'quadriceps': 'quads', 'sternocleidomastoid': 'neck',
  'latissimus dorsi': 'lats', 'gluteus maximus': 'glutes', 'gluteus medius': 'abductors',
  'hamstring': 'hamstrings', 'trapezius': 'traps', 'rhomboids': 'rhomboids', 'soleus': 'calves',
  'gastrocnemius': 'calves', 'brachialis': 'brachialis', 'brachioradialis': 'forearms',
}

function mapSecondary(list) {
  const out = []
  for (const raw of list ?? []) {
    const k = raw.toLowerCase().trim()
    const mapped = SECONDARY_FIX[k] ?? MUSCLE_MAP[k] ?? k.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

function patternOf(e, lowerName) {
  const cat = e.category
  if (cat === 'stretching' || cat === 'mobility' || cat === 'rehabilitation') return 'mobility'
  if (/stretch\b|yoga|pose\b|cat[- ]cow|sphinx|cobra|updog|downward|foam roll|mobiliz/.test(lowerName)) return 'mobility'
  if (e.bodyPart === 'neck') return 'mobility'
  if (e.bodyPart === 'cardio' || e.target === 'cardiovascular system' || cat === 'cardio' || cat === 'plyometrics') return 'cardio'
  if (/farmer|\bcarry\b/.test(lowerName)) return 'carry'
  if (e.target === 'abs' || e.bodyPart === 'waist') return 'core'
  if (e.target === 'spine') return 'hinge' // hyperextensions / back extensions (stretches caught above)
  // Legs — split quad-dominant (squat) vs hip-dominant (hinge).
  const hingeName = /deadlift|good morning|hip thrust|bridge|pull[- ]?through|swing\b|leg curl|nordic|hip extension|reverse hyper|back extension|hyperextension|clean\b|snatch\b/
  const squatName = /squat|lunge|step[- ]?up|leg press|split|pistol|leg extension|wall sit|sissy|calf|step[- ]?down/
  if (['quads', 'adductors', 'abductors', 'calves'].includes(e.target)) return hingeName.test(lowerName) ? 'hinge' : 'squat'
  if (['hamstrings', 'glutes'].includes(e.target)) return squatName.test(lowerName) ? 'squat' : 'hinge'
  // Upper body — name signals beat the target label.
  if (/row\b|pull[- ]?up|pull[- ]?down|pulldown|chin[- ]?up|pullover|face pull|reverse fly|rear delt|high pull|upright row|shrug|\bcurl\b/.test(lowerName)
    && !/leg curl/.test(lowerName)) return 'pull'
  if (['lats', 'upper back', 'traps', 'biceps', 'forearms', 'levator scapulae'].includes(e.target)) return 'pull'
  if (['pectorals', 'delts', 'triceps', 'serratus anterior'].includes(e.target)) return 'push'
  // Fallback by body part.
  const bp = e.bodyPart
  if (bp === 'chest' || bp === 'shoulders') return 'push'
  if (bp === 'back') return 'pull'
  if (bp === 'upper arms') return 'push'
  if (bp === 'lower arms') return 'pull'
  if (bp === 'upper legs' || bp === 'lower legs') return 'squat'
  return 'core'
}

const MACHINE_EQUIP = new Set([
  'leverage machine', 'cable', 'sled machine', 'smith machine', 'band', 'resistance band',
  'stability ball', 'bosu ball', 'medicine ball', 'stationary bike', 'elliptical machine',
  'stepmill machine', 'body weight (with resistance band)',
])

const ADVANCED_NAME = /muscle[- ]?up|planche|front lever|back lever|human flag|handstand|pistol|dragon flag|one arm pull|one arm chin|snatch\b|clean and jerk|clean & jerk|\bjerk\b|nordic|sissy squat|shrimp squat|aztec|superman push|90 degree push/

function experienceOf(e, lowerName) {
  if (ADVANCED_NAME.test(lowerName)) return 'advanced'
  let exp = ['beginner', 'intermediate', 'advanced'].includes(e.difficulty) ? e.difficulty : 'intermediate'
  // Machines/cables/bands guide the movement path — the earlier
  // fix_machine_exercise_levels.sql migration set the same policy for the seed.
  if (exp === 'intermediate' && MACHINE_EQUIP.has(e.equipment)) exp = 'beginner'
  return exp
}

function muscleGroupOf(target, pattern, bodyPart) {
  if (pattern === 'cardio') return 'cardio'
  if (pattern === 'mobility') return 'mobility'
  const map = {
    'pectorals': 'chest', 'serratus anterior': 'chest',
    'lats': 'back', 'upper back': 'back', 'traps': 'back', 'spine': 'back', 'levator scapulae': 'back',
    'delts': 'shoulders',
    'biceps': 'arms', 'triceps': 'arms', 'forearms': 'arms',
    'abs': 'core',
    'quads': 'legs', 'hamstrings': 'legs', 'calves': 'legs', 'adductors': 'legs', 'abductors': 'legs',
    'glutes': 'glutes',
    'cardiovascular system': 'cardio',
  }
  if (map[target]) return map[target]
  if (bodyPart === 'waist') return 'core'
  return 'legs'
}

// ── Popularity + core pool ────────────────────────────────────────────────────

// The staple movements a plan is allowed to program (search shows everything;
// generated plans and quick workouts draw from this pool + the original seed).
// Names must match the CLEANED name exactly (case-insensitive).
const CORE_NAMES = new Set([
  // Push
  'dumbbell incline bench press', 'machine chest press', 'machine incline chest press',
  'smith machine bench press', 'chest dip', 'machine seated dip', 'pec deck fly',
  'reverse pec deck fly', 'dumbbell fly', 'decline push-up', 'incline push-up', 'kneeling push-up',
  'dumbbell arnold press', 'machine shoulder press', 'dumbbell front raise',
  'cable lateral raise', 'dumbbell rear lateral raise', 'triceps pushdown',
  'bench dip', 'barbell skull crusher', 'barbell lying triceps extension', 'dumbbell kickback',
  'dumbbell lying triceps extension', 'assisted dip (machine)',
  // Pull
  'chin-up', 'assisted pull-up (machine)', 'machine assisted chin-up', 'cable pulldown',
  'machine seated row', 'machine bent over row', 'machine t-bar row', 'dumbbell shrug',
  'barbell shrug', 'cable shrug', 'barbell upright row', 'dumbbell upright row',
  'barbell curl', 'ez-bar curl', 'dumbbell hammer curl', 'dumbbell preacher curl',
  'barbell preacher curl', 'dumbbell incline curl', 'dumbbell concentration curl',
  'cable hammer curl (with rope)', 'dumbbell reverse fly', 'inverted row',
  'barbell pullover', 'dumbbell pullover', 'cable straight arm pulldown', 'wide grip pull-up',
  // Legs (squat)
  'smith machine squat', 'hack squat machine', 'dumbbell lunge', 'barbell lunge',
  'walking lunge', 'dumbbell walking lunge', 'dumbbell step-up', 'barbell step-up',
  'wide-stance leg press', '45° calf press', 'dumbbell squat',
  'kettlebell goblet squat', 'dumbbell single leg split squat',
  'machine standing calf raise', 'machine seated calf raise', 'dumbbell standing calf raise',
  'barbell standing calf raise', 'forward lunge', 'split squats', 'wall sit',
  // Legs (hinge)
  'trap bar deadlift', 'barbell hip thrust', 'machine seated leg curl',
  'barbell good morning', 'cable pull through (with rope)', 'kettlebell swing',
  'dumbbell stiff leg deadlift', 'barbell straight leg deadlift',
  'hyperextension', 'machine back extension', 'dumbbell deadlift', 'barbell glute bridge',
  // Core
  'crunch floor', 'sit-up', 'bicycle crunch', 'side plank', 'reverse crunch',
  "captain's chair leg raise", 'lying leg raise', 'flutter kicks', 'machine seated crunch',
  'cable woodchop', 'pallof press (band)',
  // Cardio / carry
  'running', 'treadmill running', 'stationary bike', 'elliptical trainer', 'stair climber',
  "farmer's walk", 'skips', 'bear crawl', 'skater hops', 'incline treadmill walk',
  'kettlebell overhead carry',
])

const TIER1_POP = new Set([...CORE_NAMES])

const NOISE_QUALIFIER = /one arm|single arm|alternate|alternating|on stability ball|on exercise ball|on bosu|with towel|isometric|on knees|kneeling|reverse grip|behind head|behind the head|zercher|suspended|banded|paused|deficit|close grip|wide grip|decline|guillotine|jefferson|zeus|circular|two toe|potty|cocoons|sucks/

function popularityOf(e, cleaned, isCore) {
  const lower = cleaned.toLowerCase()
  let pop = 45
  if (isCore) pop = 88
  else if (/^(barbell|dumbbell|cable|machine|smith machine|ez-bar|kettlebell) /.test(lower)) pop = 55
  const qualifiers = lower.match(NOISE_QUALIFIER)
  if (qualifiers && !isCore) pop -= 14
  if (/v\. ?\d|version/.test(e.name)) pop -= 10
  if (['tire', 'hammer', 'upper body ergometer', 'skierg machine', 'bosu ball'].includes(e.equipment)) pop -= 20
  if (e.category === 'stretching' || e.category === 'mobility') pop = Math.min(pop, 40)
  return Math.max(5, Math.min(100, pop))
}

// Duration-logged movements: static holds + timed cardio/mobility.
const HOLD_NAME = /\bhold\b|plank|wall sit|\bsit\b(?!-)|bridge hold|l-sit|superman|hollow|dead hang|iso\b/

function trackingMetricsOf(pattern, lowerName) {
  if (pattern === 'mobility') return ['duration']
  if (pattern === 'cardio') return null // metricsFor() → duration + distance
  if (pattern === 'carry') return ['weight', 'duration']
  if (/plank|wall sit|\bhold\b|l-sit|dead hang/.test(lowerName)) return ['duration']
  return null // metricsFor() → weight + reps
}

// ── Hand-written staples the ExerciseDB catalog is missing ────────────────────
// Deterministic UUIDs in a reserved 9-prefixed range that can never collide with
// a 4-digit ExerciseDB id, so GIF derivation skips them. Two of them borrow a
// close-variant clip via the curated map in src/data/exerciseMedia.ts (with a note).

const HAND_WRITTEN = [
  {
    suffix: '900000000001', name: 'Barbell Hip Thrust', pattern: 'hinge',
    primary: ['glutes'], secondary: ['hamstrings', 'core'], equipment: 'barbell',
    experience: 'intermediate', isCore: true, popularity: 92, muscleGroup: 'glutes', metrics: null,
    instructions: [
      'Sit on the floor with your upper back against a bench and a padded barbell over your hips.',
      'Plant your feet hip-width apart with shins vertical when your hips are up.',
      'Drive through your heels to lift your hips until your torso is parallel to the floor, chin tucked.',
      'Squeeze your glutes hard at the top for a beat, then lower with control. Do not hyperextend your lower back.',
    ],
  },
  {
    suffix: '900000000002', name: 'Wall Sit', pattern: 'squat',
    primary: ['quads'], secondary: ['glutes', 'calves'], equipment: 'bodyweight',
    experience: 'beginner', isCore: true, popularity: 70, muscleGroup: 'legs', metrics: ['duration'],
    instructions: [
      'Stand with your back flat against a wall and walk your feet out about two feet.',
      'Slide down until your thighs are parallel to the floor, knees at 90° directly above your ankles.',
      'Press your lower back into the wall and hold, breathing steadily.',
      'To finish, push through your heels to slide back up. Keep hands off your thighs.',
    ],
  },
  {
    suffix: '900000000003', name: 'Cable Woodchop', pattern: 'core',
    primary: ['obliques'], secondary: ['abs', 'shoulders'], equipment: 'full_gym',
    experience: 'beginner', isCore: true, popularity: 72, muscleGroup: 'core', metrics: null,
    instructions: [
      'Set a cable to high-pulley height and stand side-on to the machine, feet shoulder-width apart.',
      'Grab the handle with both hands, arms nearly straight.',
      'Pull the handle down and across your body to the opposite hip, rotating your torso and pivoting the back foot.',
      'Control the return along the same arc. Finish the set, then face the other way to train the opposite side.',
    ],
  },
  {
    suffix: '900000000004', name: 'Dumbbell Walking Lunge', pattern: 'squat',
    primary: ['quads', 'glutes'], secondary: ['hamstrings', 'core'], equipment: 'dumbbells',
    experience: 'intermediate', isCore: true, popularity: 80, muscleGroup: 'legs', metrics: null,
    instructions: [
      'Stand tall holding a dumbbell in each hand at your sides.',
      'Step forward and lower your rear knee toward the floor, keeping your front shin vertical.',
      'Drive through your front heel and step the rear foot through into the next lunge.',
      'Keep your torso upright and take a beat to balance between steps.',
    ],
  },
  {
    suffix: '900000000005', name: 'Swimming (Freestyle)', pattern: 'cardio',
    primary: ['full_body'], secondary: ['lats', 'shoulders', 'core'], equipment: 'bodyweight',
    experience: 'beginner', isCore: false, popularity: 65, muscleGroup: 'cardio', metrics: ['duration', 'distance'],
    instructions: [
      'Swim freestyle at a steady, sustainable pace — exhale underwater, breathe every 2–3 strokes.',
      'Keep your body long and rotate from the hips with each stroke.',
      'Use intervals (e.g. 4×100m with 30s rest) to build up total distance.',
    ],
  },
  {
    suffix: '900000000006', name: 'Bird Dog', pattern: 'core',
    primary: ['abs', 'lower_back'], secondary: ['glutes', 'shoulders'], equipment: 'bodyweight',
    experience: 'beginner', isCore: true, popularity: 68, muscleGroup: 'core', metrics: null,
    instructions: [
      'Start on all fours with hands under shoulders and knees under hips.',
      'Brace your core, then extend your right arm forward and left leg back until both are parallel to the floor.',
      'Hold for a beat without letting your hips rotate or your back arch.',
      'Return with control and switch sides. Move slowly — the goal is a perfectly still torso.',
    ],
  },
  {
    suffix: '900000000007', name: 'Dead Hang', pattern: 'mobility',
    primary: ['forearms'], secondary: ['lats', 'shoulders'], equipment: 'bodyweight',
    experience: 'beginner', isCore: false, popularity: 55, muscleGroup: 'mobility', metrics: ['duration'],
    instructions: [
      'Grip a pull-up bar with both hands shoulder-width apart and hang with straight arms.',
      'Relax your shoulders and let your spine decompress — or keep shoulders packed to train grip.',
      'Hold for time, breathing slowly. Step off before your grip fails completely.',
    ],
  },
  {
    suffix: '900000000008', name: 'Nordic Hamstring Curl', pattern: 'hinge',
    primary: ['hamstrings'], secondary: ['glutes', 'calves'], equipment: 'bodyweight',
    experience: 'advanced', isCore: false, popularity: 60, muscleGroup: 'legs', metrics: null,
    instructions: [
      'Kneel on a pad with your ankles anchored (partner, loaded bar, or foot anchor).',
      'With hips extended and body in a straight line from knees to head, lower your torso forward as slowly as possible.',
      'Catch yourself with your hands, push back up lightly, and pull with your hamstrings to return.',
      'Fight the descent for as long as you can — the eccentric is the exercise.',
    ],
  },
  {
    suffix: '900000000009', name: 'Clamshell', pattern: 'mobility',
    primary: ['abductors'], secondary: ['glutes'], equipment: 'bodyweight',
    experience: 'beginner', isCore: false, popularity: 55, muscleGroup: 'glutes', metrics: null,
    instructions: [
      'Lie on your side with knees bent 90° and stacked, feet together, head resting on your arm.',
      'Keeping your feet touching, lift your top knee as high as you can without rolling your pelvis back.',
      'Pause at the top, feeling the side of your hip work, then lower slowly.',
      'Finish the set and repeat on the other side. Add a mini-band above the knees to progress.',
    ],
  },
  {
    suffix: '900000000010', name: 'Curtsy Lunge', pattern: 'squat',
    primary: ['glutes', 'quads'], secondary: ['abductors', 'calves'], equipment: 'bodyweight',
    experience: 'intermediate', isCore: false, popularity: 58, muscleGroup: 'legs', metrics: null,
    instructions: [
      'Stand tall with feet hip-width apart, hands at your chest.',
      'Step your right foot back and across behind your left leg, lowering your right knee toward the floor.',
      'Keep your chest up and front knee tracking over the toes.',
      'Push through your front heel to stand and switch sides. Hold dumbbells to progress.',
    ],
  },
  {
    suffix: '900000000011', name: 'Battle Ropes', pattern: 'cardio',
    primary: ['shoulders', 'full_body'], secondary: ['core', 'forearms'], equipment: 'full_gym',
    experience: 'beginner', isCore: false, popularity: 65, muscleGroup: 'cardio', metrics: ['duration'],
    instructions: [
      'Hold one rope end in each hand with a quarter-squat stance, chest up.',
      'Whip the ropes in fast alternating waves, driving from the shoulders and bracing your core.',
      'Work in intervals — e.g. 20–30 seconds hard, 30 seconds rest.',
      'Mix in double waves or slams to vary the stimulus.',
    ],
  },
  {
    suffix: '900000000012', name: 'Sled Push (Prowler)', pattern: 'cardio',
    primary: ['quads', 'glutes'], secondary: ['calves', 'core', 'shoulders'], equipment: 'full_gym',
    experience: 'intermediate', isCore: false, popularity: 60, muscleGroup: 'cardio', metrics: ['weight', 'duration'],
    instructions: [
      'Load a push sled and grip the high or low handles with arms extended.',
      'Lean into the sled with a flat back and drive it forward with powerful alternating steps.',
      'Keep your core braced and push through the full foot each stride.',
      'Push a set distance (e.g. 20–40m), rest, and repeat.',
    ],
  },
]

// ── SQL emission ──────────────────────────────────────────────────────────────

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const textArr = (a) => a.length ? `ARRAY[${a.map(q).join(',')}]` : `'{}'::text[]`

function uuidFor(exdbId) {
  if (!/^\d{4}$/.test(exdbId)) throw new Error(`Unexpected ExerciseDB id shape: ${exdbId}`)
  return `edb00000-0000-4000-8000-${exdbId.padStart(12, '0')}`
}

function rowSql(x) {
  return `(${q(x.uuid)}, ${q(x.name)}, ${q(x.pattern)}, ${textArr(x.primary)}, ${textArr(x.secondary)}, ` +
    `${textArr([x.equipment])}, ${q(x.experience)}, ${textArr(x.instructions)}, '{}'::uuid[], ` +
    `${x.metrics ? textArr(x.metrics) : 'NULL'}, ${x.isCore}, ${x.popularity}, ${q(x.muscleGroup)})`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const inputArg = process.argv.indexOf('--input')
  const catalog = inputArg > -1
    ? JSON.parse(fs.readFileSync(process.argv[inputArg + 1], 'utf8'))
    : await fetchCatalog()

  const skipIds = mappedExdbIds()
  const dropped = []
  const kept = []
  const seenNames = new Set(EXISTING_NORM)

  // Deterministic order → stable diffs between runs.
  const sorted = [...catalog].sort((a, b) => a.id.localeCompare(b.id))

  for (const e of sorted) {
    if (skipIds.has(e.id)) { dropped.push([e.id, e.name, 'already seeded (mapped media)']); continue }
    const why = shouldDrop(e)
    if (why) { dropped.push([e.id, e.name, why]); continue }
    if (!equipmentOf(e)) { dropped.push([e.id, e.name, `unmapped equipment: ${e.equipment}`]); continue }

    const name = cleanName(e)
    const nkey = norm(name)
    if (seenNames.has(nkey)) { dropped.push([e.id, e.name, `duplicate of "${name}"`]); continue }
    seenNames.add(nkey)

    const lower = name.toLowerCase()
    const pattern = patternOf(e, e.name.toLowerCase())
    const primary = [MUSCLE_MAP[e.target] ?? norm(e.target).replace(/ /g, '_')]
    const secondary = mapSecondary(e.secondaryMuscles).filter(m => !primary.includes(m))
    const isCore = CORE_NAMES.has(lower)
    const instructions = (e.instructions ?? []).map(s => String(s).trim()).filter(Boolean)

    kept.push({
      uuid: uuidFor(e.id),
      exdbId: e.id,
      name,
      pattern,
      primary,
      secondary,
      equipment: equipmentOf(e),
      experience: experienceOf(e, lower),
      instructions,
      metrics: trackingMetricsOf(pattern, lower),
      isCore,
      popularity: popularityOf(e, name, isCore),
      muscleGroup: muscleGroupOf(e.target, pattern, e.bodyPart),
    })
  }

  // Hand-written staples join the pool (reserved UUID range, no exdb id).
  for (const h of HAND_WRITTEN) {
    if (seenNames.has(norm(h.name))) throw new Error(`Hand-written "${h.name}" collides with a catalog entry`)
    seenNames.add(norm(h.name))
    kept.push({
      uuid: `edb00000-0000-4000-8000-${h.suffix}`,
      exdbId: null,
      name: h.name,
      pattern: h.pattern,
      primary: h.primary,
      secondary: h.secondary,
      equipment: h.equipment,
      experience: h.experience,
      instructions: h.instructions,
      metrics: h.metrics,
      isCore: h.isCore,
      popularity: h.popularity,
      muscleGroup: h.muscleGroup,
    })
  }

  // ── Emit SQL ────────────────────────────────────────────────────────────────
  // Catalog rows carry NO instructions in the DB — the app derives each row's
  // ExerciseDB id from its UUID and fetches steps (and the GIF) on demand, so the
  // seed stays small enough to apply through ordinary SQL tooling. Hand-written
  // rows have no remote source, so their instructions ship inline.
  const header = `-- Tempo Exercise Library v2 — ${kept.length} exercises imported from the ExerciseDB catalog.
-- Generated by scripts/build-exercise-library.mjs — DO NOT EDIT BY HAND (re-run the script).
-- Each id embeds the ExerciseDB clip id (edb00000-0000-4000-8000-<id, zero-padded>);
-- the app derives GIF + instructions from it (see src/lib/exerciseDb.ts). Rows in the
-- 9xxxxxxxxxxx suffix range are hand-written and carry their instructions inline.
-- Requires add_exercise_library_v2.sql (is_core / popularity / muscle_group columns).

`
  const compactRow = (x) => {
    const suffix = x.exdbId ? x.exdbId.padStart(12, '0') : x.uuid.slice(-12)
    return `('${suffix}',${q(x.name)},${q(x.pattern)},${q(x.primary.join(','))},${q(x.secondary.join(','))},` +
      `${q(x.equipment)},${q(x.experience)},${q(x.metrics ? x.metrics.join(',') : '')},` +
      `${x.isCore ? 'true' : 'false'},${x.popularity},${q(x.muscleGroup)},` +
      `${x.instructions.length && !x.exdbId ? textArr(x.instructions) : `'{}'::text[]`})`
  }
  const insertStmt = (batch) => `INSERT INTO public.exercises
  (id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, substitute_ids, tracking_metrics, is_core, popularity, muscle_group)
SELECT ('edb00000-0000-4000-8000-' || v.sfx)::uuid, v.nm, v.mp,
  string_to_array(v.pm, ','), CASE WHEN v.sm = '' THEN '{}'::text[] ELSE string_to_array(v.sm, ',') END,
  ARRAY[v.eq], v.xp, v.ins, '{}'::uuid[],
  CASE WHEN v.tm = '' THEN '{}'::text[] ELSE string_to_array(v.tm, ',') END, v.core, v.pop, v.mg
FROM (VALUES
${batch.map(compactRow).join(',\n')}
) AS v(sfx, nm, mp, pm, sm, eq, xp, tm, core, pop, mg, ins)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, movement_pattern = EXCLUDED.movement_pattern,
  primary_muscles = EXCLUDED.primary_muscles, secondary_muscles = EXCLUDED.secondary_muscles,
  required_equipment = EXCLUDED.required_equipment, experience_level = EXCLUDED.experience_level,
  tracking_metrics = EXCLUDED.tracking_metrics, is_core = EXCLUDED.is_core,
  popularity = EXCLUDED.popularity, muscle_group = EXCLUDED.muscle_group;
`
  const BATCH = 145
  const stmts = []
  for (let i = 0; i < kept.length; i += BATCH) stmts.push(insertStmt(kept.slice(i, i + BATCH)))
  fs.writeFileSync(path.join(root, 'supabase/seed_exercise_library_v2.sql'), header + stmts.join('\n'))

  // One statement per chunk file — sized for tooling that applies them one call
  // at a time (each ~40KB).
  const chunksIdx = process.argv.indexOf('--chunks-dir')
  if (chunksIdx > -1) {
    const dir = process.argv[chunksIdx + 1]
    fs.mkdirSync(dir, { recursive: true })
    stmts.forEach((s, i) => fs.writeFileSync(path.join(dir, `chunk-${i + 1}.sql`), s))
    console.log(`wrote ${stmts.length} chunk files to ${dir}`)
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const byPattern = {}, byEquip = {}, byLevel = {}, byGroup = {}
  for (const k of kept) {
    byPattern[k.pattern] = (byPattern[k.pattern] || 0) + 1
    byEquip[k.equipment] = (byEquip[k.equipment] || 0) + 1
    byLevel[k.experience] = (byLevel[k.experience] || 0) + 1
    byGroup[k.muscleGroup] = (byGroup[k.muscleGroup] || 0) + 1
  }
  const coreFound = kept.filter(k => k.isCore)
  const coreMissing = [...CORE_NAMES].filter(n => !coreFound.some(k => k.name.toLowerCase() === n))
  const report = [
    `kept: ${kept.length}   dropped: ${dropped.length}`,
    `patterns: ${JSON.stringify(byPattern)}`,
    `equipment: ${JSON.stringify(byEquip)}`,
    `levels: ${JSON.stringify(byLevel)}`,
    `muscle groups: ${JSON.stringify(byGroup)}`,
    ``,
    `CORE POOL (${coreFound.length} found):`,
    ...coreFound.map(k => `  [${k.pattern}] ${k.name}  (${k.equipment}, ${k.experience})`),
    ``,
    `CORE NAMES NOT FOUND (${coreMissing.length}):`,
    ...coreMissing.map(n => `  ${n}`),
    ``,
    `DROPPED:`,
    ...dropped.map(([id, name, why]) => `  ${id} ${name} — ${why}`),
  ].join('\n')
  fs.writeFileSync(path.join(root, 'scripts/library-report.txt'), report)
  console.log(report.split('\n').slice(0, 8).join('\n'))
  console.log(`\ncore found: ${coreFound.length}, core names not matched: ${coreMissing.length}`)
  console.log('wrote supabase/seed_exercise_library_v2.sql + scripts/library-report.txt')
}

main().catch(e => { console.error(e); process.exit(1) })
