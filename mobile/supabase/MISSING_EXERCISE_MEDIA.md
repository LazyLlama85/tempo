# Exercise form-guide media — coverage report

Source: **ExerciseDB** (RapidAPI, `exercisedb.p.rapidapi.com`), matched against the
50 seeded exercises. Regenerate/verify with `npm run sync:media` (see
`scripts/sync-exercise-media.mjs`).

**Coverage: 50 / 60 library exercises have a form-guide GIF** (42 remote, 8 local).
The **10 mobility movements** added after the original 50 have **no GIF yet** — see
the "Missing" section below. The form guide falls back to an illustration for these,
so nothing is broken, but they're the exact set to complete.

## ❌ Missing a form-guide GIF (10 mobility movements)

These have neither a verified remote clip nor a bundled local GIF (tracked in
`MISSING_MEDIA_UUIDS` in `src/data/exerciseMedia.ts`):

| Exercise | UUID |
|---|---|
| World's Greatest Stretch | `1d8c9b44-c59d-4504-94f6-04ce75865422` |
| Ankle Mobility Rock | `201e20f5-d4de-4a80-838a-04b7034a35ca` |
| Shoulder Pass-Through | `39272408-f1db-4f3f-a2c4-0a7950b3fadc` |
| Downward Dog to Cobra | `42b3596f-6ebc-4b04-95ec-cdbe9417afd1` |
| Deep Squat Hold | `47f2cdd7-367c-44f4-9fea-9cb231e04fbf` |
| Thoracic Rotation | `6444cccc-7a7f-4484-a45e-1c46e34054d5` |
| 90/90 Hip Switch | `9488f1e5-0bad-4a6e-b4fb-9628d56f7b1b` |
| Standing Hamstring Stretch | `9971c614-10b0-4e62-a1d5-286056361b0e` |
| Hip Flexor Stretch | `d1380065-975c-4310-9682-907415b39c86` |
| Cat-Cow | `ed3798cf-4b37-4e5c-b245-067656480e0d` |

To complete: add a bundled GIF to `mobile/assets/exercise-gifs/` + wire it in
`LOCAL_GIFS`, or map a verified ExerciseDB id in `EXERCISE_MEDIA`, then remove the
UUID from `MISSING_MEDIA_UUIDS`.

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

The original 50 strength movements have no remaining gaps; the only gaps are the 10
mobility movements listed above (now in `MISSING_MEDIA_UUIDS`).

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
