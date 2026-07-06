-- Fix: machine/cable exercises were labelled 'intermediate', which — combined with
-- the beginner-only experience filter — left a beginner full-gym user with ZERO
-- matching pull exercises (their "Pull" day was padded with planks/dead bugs).
-- Pin-loaded and cable machines have guided movement paths and are exactly what a
-- beginner should be given first, so they're beginner-level. Free-weight technical
-- lifts (Pendlay Row, Power Clean, …) and genuinely hard moves (Weighted Pull-Up,
-- Hanging Leg Raise) keep their levels.
update exercises
set experience_level = 'beginner'
where user_id is null
  and name in (
    'Lat Pulldown',
    'Seated Cable Row',
    'Cable Bicep Curl',
    'Face Pull',
    'Cable Fly',
    'Cable Crunch',
    'Leg Press',
    'Leg Curl',
    'Leg Extension',
    'Rowing Machine'
  );
