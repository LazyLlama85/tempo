// Tempo — exercise form-guide media.
//
// THREE sources, in priority order:
//   1. LOCAL_GIFS — our own bundled clips (offline, no API key).
//   2. EXERCISE_MEDIA — curated UUID → ExerciseDB-clip mapping for the original
//      seeded movements (each verified by scripts/sync-exercise-media.mjs), with
//      an optional caveat note when the demo is a close variant.
//   3. Derivation — the 1200+ imported library rows EMBED their ExerciseDB id in
//      their UUID (edb00000-0000-4000-8000-<id>), so their clip needs no mapping
//      at all (see lib/exerciseDb.ts).
// Exercises with no accurate clip anywhere fall back to an illustration rather
// than show a misleading demo (gaps tracked in supabase/MISSING_EXERCISE_MEDIA.md).
//
// GIFs are served from our own public Supabase Storage bucket (`exercise-gifs`),
// backfilled ONCE from ExerciseDB by scripts/backfill-exercise-media.mjs — the
// app never calls RapidAPI live for images anymore (that's what exhausted the
// RapidAPI monthly quota: every install hitting the same shared plan on every
// view). An exercise not yet backfilled just has no object at that URL yet; the
// <Image> onError handlers in ExerciseFormSheet/ExerciseMedia fall back to the
// illustration exactly as they do for a genuine gap.

import { exdbIdForExercise } from '@/lib/exerciseDb'

const UUID = (suffix: string) => `00000000-0000-0000-0000-0000000000${suffix}`

export interface ExerciseMedia {
  exdbId: string
  /** Shown under the clip when the demo is the right movement but a close variant. */
  note?: string
}

// Keyed by full exercise UUID → ExerciseDB id (+ optional caveat).
export const EXERCISE_MEDIA: Record<string, ExerciseMedia> = {
  [UUID('01')]: { exdbId: '0662' }, // Push-Up
  [UUID('03')]: { exdbId: '0381', note: 'Demo shows the rear-lunge movement loaded with dumbbells.' }, // Reverse Lunge
  [UUID('05')]: { exdbId: '3013' }, // Glute Bridge (floor)
  [UUID('06')]: { exdbId: '0630' }, // Mountain Climber
  [UUID('07')]: { exdbId: '1160' }, // Burpee
  [UUID('08')]: { exdbId: '3224' }, // Jumping Jack (jack jump)
  [UUID('09')]: { exdbId: '1760' }, // Goblet Squat
  [UUID('10')]: { exdbId: '0293' }, // Dumbbell Row (bent-over)
  [UUID('11')]: { exdbId: '0405' }, // Dumbbell Shoulder Press (seated)
  [UUID('12')]: { exdbId: '0294' }, // Bicep Curl
  [UUID('13')]: { exdbId: '0430', note: 'Demo shows a standing dumbbell triceps extension.' }, // Tricep Overhead Extension
  [UUID('14')]: { exdbId: '1459' }, // Dumbbell Romanian Deadlift
  [UUID('15')]: { exdbId: '0334' }, // Lateral Raise
  [UUID('16')]: { exdbId: '0289' }, // Dumbbell Chest Press (bench press)
  [UUID('17')]: { exdbId: '0043' }, // Barbell Back Squat (full squat)
  [UUID('18')]: { exdbId: '0025' }, // Barbell Bench Press
  [UUID('19')]: { exdbId: '0032' }, // Conventional Deadlift
  [UUID('20')]: { exdbId: '1457', note: 'Demo shows a standing barbell overhead press (wide grip).' }, // Barbell Overhead Press
  [UUID('21')]: { exdbId: '0027' }, // Barbell Bent-Over Row
  [UUID('22')]: { exdbId: '2330' }, // Lat Pulldown
  [UUID('23')]: { exdbId: '0861' }, // Seated Cable Row
  [UUID('24')]: { exdbId: '0739' }, // Leg Press
  [UUID('25')]: { exdbId: '0586' }, // Leg Curl (lying)
  [UUID('26')]: { exdbId: '0585' }, // Leg Extension
  [UUID('27')]: { exdbId: '0188' }, // Cable Fly (middle)
  [UUID('29')]: { exdbId: '0868' }, // Cable Bicep Curl
  [UUID('30')]: { exdbId: '0652' }, // Pull-Up
  [UUID('31')]: { exdbId: '0814' }, // Dip (triceps dip)
  [UUID('33')]: { exdbId: '0047' }, // Incline Barbell Bench Press
  [UUID('34')]: { exdbId: '3017' }, // Pendlay Row
  [UUID('35')]: { exdbId: '0117' }, // Sumo Deadlift
  [UUID('37')]: { exdbId: '0030' }, // Close-Grip Bench Press
  [UUID('38')]: { exdbId: '0652', note: 'Demo shows a bodyweight pull-up — same movement, add weight.' }, // Weighted Pull-Up
  [UUID('39')]: { exdbId: '0648' }, // Power Clean
  [UUID('40')]: { exdbId: '0042' }, // Front Squat
  [UUID('41')]: { exdbId: '0085' }, // Barbell Romanian Deadlift
  [UUID('42')]: { exdbId: '0276' }, // Dead Bug
  [UUID('44')]: { exdbId: '0857' }, // Ab Wheel Rollout
  [UUID('45')]: { exdbId: '0472' }, // Hanging Leg Raise
  [UUID('46')]: { exdbId: '0687' }, // Russian Twist
  [UUID('47')]: { exdbId: '0175' }, // Cable Crunch
  [UUID('48')]: { exdbId: '2612' }, // Jump Rope
  // Seeded mobility movement with a verified catalog clip.
  ['1d8c9b44-c59d-4504-94f6-04ce75865422']: { exdbId: '1604' }, // World's Greatest Stretch
  // Hand-written staples (no exact catalog clip) borrowing a close variant.
  ['edb00000-0000-4000-8000-900000000001']: {
    exdbId: '1409',
    note: 'Demo shows the barbell glute bridge from the floor — same hip drive with your upper back on a bench.',
  }, // Barbell Hip Thrust
  ['edb00000-0000-4000-8000-900000000004']: {
    exdbId: '1460',
    note: 'Demo shows the unloaded walking lunge — hold a dumbbell in each hand.',
  }, // Dumbbell Walking Lunge
}

// Locally-bundled form clips — our own GIFs (split from a single demo video) for the
// 8 movements the remote library had no accurate clip for. These take priority over
// any remote source and work offline / without an API key. require() returns the
// bundled asset id, which expo-image accepts directly as a source.
const LOCAL_GIFS: Record<string, number> = {
  [UUID('02')]: require('@/assets/exercise-gifs/bodyweight-squat.gif'),      // Bodyweight Squat
  [UUID('04')]: require('@/assets/exercise-gifs/plank.gif'),                 // Plank
  [UUID('28')]: require('@/assets/exercise-gifs/face-pull.gif'),             // Face Pull
  [UUID('32')]: require('@/assets/exercise-gifs/bulgarian-split-squat.gif'), // Bulgarian Split Squat
  [UUID('36')]: require('@/assets/exercise-gifs/pause-squat.gif'),           // Pause Squat
  [UUID('43')]: require('@/assets/exercise-gifs/hollow-body-hold.gif'),      // Hollow Body Hold
  [UUID('49')]: require('@/assets/exercise-gifs/box-jump.gif'),              // Box Jump
  [UUID('50')]: require('@/assets/exercise-gifs/rowing-machine.gif'),        // Rowing Machine
}

// Seeded **mobility** movements with no form clip yet — no accurate ExerciseDB
// match (verified by hand; close-but-wrong demos are worse than none) and no
// bundled local GIF — so the form guide falls back to its illustration for these.
// Tracked here + in supabase/MISSING_EXERCISE_MEDIA.md. (The original 50 strength
// movements are all covered: 42 remote + 8 local; World's Greatest Stretch is
// mapped to catalog clip 1604 above.)
export const MISSING_MEDIA_UUIDS: string[] = [
  '201e20f5-d4de-4a80-838a-04b7034a35ca', // Ankle Mobility Rock
  '39272408-f1db-4f3f-a2c4-0a7950b3fadc', // Shoulder Pass-Through
  '42b3596f-6ebc-4b04-95ec-cdbe9417afd1', // Downward Dog to Cobra
  '47f2cdd7-367c-44f4-9fea-9cb231e04fbf', // Deep Squat Hold
  '6444cccc-7a7f-4484-a45e-1c46e34054d5', // Thoracic Rotation
  '9488f1e5-0bad-4a6e-b4fb-9628d56f7b1b', // 90/90 Hip Switch
  '9971c614-10b0-4e62-a1d5-286056361b0e', // Standing Hamstring Stretch
  'd1380065-975c-4310-9682-907415b39c86', // Hip Flexor Stretch
  'ed3798cf-4b37-4e5c-b245-067656480e0d', // Cat-Cow
]

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const GIF_STORAGE_BASE = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/exercise-gifs` : null

export interface GifSource {
  uri: string
  headers: Record<string, string>
}

export function getExerciseMedia(exerciseId: string | null | undefined): ExerciseMedia | null {
  if (!exerciseId) return null
  return EXERCISE_MEDIA[exerciseId] ?? null
}

// Our own bundled clip for an exercise (by id), or null. Used by the form guide +
// runner thumbnail to show local GIFs for the movements the remote library lacked.
export function getLocalExerciseGif(exerciseId: string | null | undefined): number | null {
  if (exerciseId && LOCAL_GIFS[exerciseId] != null) return LOCAL_GIFS[exerciseId]
  return null
}

// Returns an expo-image source for an exercise's form clip, or null when we have
// no verified clip. Served from our own Supabase Storage cache (see file header) —
// not yet backfilled reads as a 404, same as "no clip", handled by the caller's
// onError fallback.
export function getExerciseGifSource(exerciseId: string | null | undefined): number | GifSource | null {
  // Prefer our own bundled clip when we have one (offline, no network required).
  if (exerciseId && LOCAL_GIFS[exerciseId] != null) return LOCAL_GIFS[exerciseId]
  // Curated mapping first, then the id embedded in imported-library UUIDs.
  const exdbId = getExerciseMedia(exerciseId)?.exdbId ?? exdbIdForExercise(exerciseId)
  if (!exdbId || !GIF_STORAGE_BASE) return null
  return { uri: `${GIF_STORAGE_BASE}/${exdbId}.gif`, headers: {} }
}
