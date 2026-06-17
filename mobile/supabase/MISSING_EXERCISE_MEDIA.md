# Exercise form-guide media — coverage report

Source: **ExerciseDB** (RapidAPI, `exercisedb.p.rapidapi.com`), matched against the
50 seeded exercises. Regenerate/verify with `npm run sync:media` (see
`scripts/sync-exercise-media.mjs`).

**Coverage: 42 / 50 exercises have a verified, movement-accurate GIF.**

Mappings live in `src/data/exerciseMedia.ts`. Per your rule, a clip is only
attached when it actually shows the right exercise — the 8 below show a neutral
illustration instead of a misleading demo.

## ❌ No accurate clip (8) — needs attention

These movements have no faithful demo in the source library (only loaded or
variant versions exist), so they intentionally show no GIF:

| Exercise | Why no clip | Closest (rejected) |
|---|---|---|
| Bodyweight Squat | Library has only loaded/variant squats, no plain air squat | barbell full squat |
| Plank | Only plank *variations* (twist, shoulder-tap, side) — no static front plank | front plank with twist |
| Face Pull | Not present in the library at all | — |
| Bulgarian Split Squat | No rear-foot-elevated split squat; rejected to avoid a wrong demo | dumbbell single-leg split squat |
| Pause Squat | The defining pause isn't depicted by a normal squat clip | barbell full squat |
| Hollow Body Hold | Not present in the library | — |
| Box Jump | Only a "box jump *down*" variant exists, not the standard jump-up | box jump down (one-leg) |
| Rowing Machine | No erg/rowing-machine entry (it's a strength library) | — |

**Options to close these gaps:** (a) host our own 8 short clips/illustrations in
Supabase Storage and map them in `exerciseMedia.ts`; or (b) accept the closest
variant above (I left them off deliberately — your call).

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
