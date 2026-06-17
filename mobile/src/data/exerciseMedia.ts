// Tempo — exercise form-guide media.
//
// Maps each seeded exercise (by its fixed UUID) to a verified ExerciseDB clip.
// Every id here was matched to our exercise and confirmed to return a real GIF
// (see scripts/sync-exercise-media.mjs). Exercises with no accurate match are
// deliberately absent — the UI falls back to an illustration rather than show a
// misleading demo. The current gaps are tracked in supabase/MISSING_EXERCISE_MEDIA.md.
//
// GIFs are served by the ExerciseDB image endpoint, which requires the RapidAPI
// auth headers, so we attach them to the image request. EXPO_PUBLIC_ vars are
// inlined into the bundle at build time.

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
}

// Exercises we intentionally do NOT show a clip for (no accurate match in the
// source library). Kept here so the gap is visible in code, mirrored in
// supabase/MISSING_EXERCISE_MEDIA.md.
export const MISSING_MEDIA_UUIDS: string[] = [
  UUID('02'), // Bodyweight Squat
  UUID('04'), // Plank
  UUID('28'), // Face Pull
  UUID('32'), // Bulgarian Split Squat
  UUID('36'), // Pause Squat
  UUID('43'), // Hollow Body Hold
  UUID('49'), // Box Jump
  UUID('50'), // Rowing Machine
]

const EXDB_IMAGE_HOST = 'exercisedb.p.rapidapi.com'
const RAPIDAPI_KEY = process.env.EXPO_PUBLIC_RAPIDAPI_KEY

export interface GifSource {
  uri: string
  headers: Record<string, string>
}

export function getExerciseMedia(exerciseId: string | null | undefined): ExerciseMedia | null {
  if (!exerciseId) return null
  return EXERCISE_MEDIA[exerciseId] ?? null
}

// Returns an expo-image source (uri + auth headers) for an exercise's form clip,
// or null when we have no verified clip or the API key isn't configured.
export function getExerciseGifSource(
  exerciseId: string | null | undefined,
  resolution: 180 | 360 | 720 = 360,
): GifSource | null {
  const media = getExerciseMedia(exerciseId)
  if (!media || !RAPIDAPI_KEY) return null
  return {
    uri: `https://${EXDB_IMAGE_HOST}/image?exerciseId=${media.exdbId}&resolution=${resolution}`,
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': EXDB_IMAGE_HOST,
    },
  }
}
