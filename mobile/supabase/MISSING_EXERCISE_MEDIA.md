# Exercise form-guide media — coverage report

Source: **ExerciseDB** (RapidAPI, `exercisedb.p.rapidapi.com`), matched against the
50 seeded exercises. Regenerate/verify with `npm run sync:media` (see
`scripts/sync-exercise-media.mjs`).

**Coverage: 50 / 50 exercises have a movement-accurate GIF.** (42 remote, 8 local.)

Mappings live in `src/data/exerciseMedia.ts`. Per your rule, a clip is only
attached when it actually shows the right exercise.

## ✅ Filled with our own local clips (8)

These 8 had no faithful demo in the remote library, so they now use **bundled GIFs
we generated ourselves** (split from a single 10s demo video into 1.25s segments,
palette-optimised). They live in `mobile/assets/exercise-gifs/` and are wired by id
in `src/data/exerciseMedia.ts` (`LOCAL_GIFS`), surfaced via `getLocalExerciseGif`
in both the form guide (`ExerciseFormSheet`) and the runner thumbnail (`plan.tsx`).
They load instantly and work offline / without an API key.

| Exercise | Local clip |
|---|---|
| Bodyweight Squat | `bodyweight-squat.gif` |
| Plank | `plank.gif` |
| Face Pull | `face-pull.gif` |
| Bulgarian Split Squat | `bulgarian-split-squat.gif` |
| Pause Squat | `pause-squat.gif` |
| Hollow Body Hold | `hollow-body-hold.gif` |
| Box Jump | `box-jump.gif` |
| Rowing Machine | `rowing-machine.gif` |

There are no remaining gaps — `MISSING_MEDIA_UUIDS` is now empty.

## ⚠️ Accurate movement, close variant (6) — clip shown with a caveat

These show the correct movement but a near variant; the app displays a one-line
note under the clip:

| Exercise | Clip shown | Note surfaced in-app |
|---|---|---|
| Reverse Lunge | dumbbell rear lunge | "…loaded with dumbbells." |
| Jumping Jack | jack jump | (model variant) |
| Tricep Overhead Extension | dumbbell standing triceps extension | "standing dumbbell triceps extension" |
| Barbell Overhead Press | barbell standing military press (wide) | "wide grip" |
| Weighted Pull-Up | bodyweight pull-up | "same movement, add weight" |
| Glute Bridge | low glute bridge on floor | (floor bridge) |

The other 36 are exact name matches (Bench Press, Deadlift, Squat, Pull-Up, RDL,
Power Clean, Dead Bug, Russian Twist, Cable Crunch, etc.).
