-- Tempo Program Templates — 15 programs
-- Run THIRD (after schema migration and exercise seed) in Supabase SQL Editor.

INSERT INTO public.programs
  (id, name, description, goals, experience_level, days_per_week, duration_weeks)
VALUES

-- ── BEGINNER ──────────────────────────────────────────────────────────────────

(gen_random_uuid(),
 'Beginner Full Body Strength',
 'Three full-body sessions per week built around foundational compound lifts. Each session covers a push, pull, hinge, and squat pattern so every muscle gets trained with sufficient frequency to build strength fast.',
 ARRAY['muscle_gain'], 'beginner', 3, 4),

(gen_random_uuid(),
 'Beginner Fat Burn Circuit',
 'High-energy circuits combining bodyweight and light dumbbell exercises to elevate heart rate and burn calories while building a base of fitness. Short rest periods keep intensity high without requiring any equipment beyond a pair of dumbbells.',
 ARRAY['fat_loss'], 'beginner', 3, 4),

(gen_random_uuid(),
 'Beginner Total Body',
 'A balanced 3-day program covering all major muscle groups each session. Emphasis is on movement quality and building consistent workout habits rather than intensity — the foundation every other program is built on.',
 ARRAY['general_fitness'], 'beginner', 3, 4),

(gen_random_uuid(),
 'Beginner Starter (2-Day)',
 'The lowest-commitment entry point for total beginners. Two full-body sessions per week give the body enough stimulus to adapt and build the habit without soreness overwhelming daily life.',
 ARRAY['general_fitness'], 'beginner', 2, 4),

-- ── INTERMEDIATE ──────────────────────────────────────────────────────────────

(gen_random_uuid(),
 'Intermediate Upper/Lower Split',
 'A classic 4-day upper/lower split that trains each muscle group twice per week at higher volume. Upper days focus on pressing and pulling; lower days focus on squat and hinge patterns with direct accessory work.',
 ARRAY['muscle_gain'], 'intermediate', 4, 4),

(gen_random_uuid(),
 'Intermediate PPL Intro',
 'A 3-day push/pull/legs introduction for lifters transitioning off full-body training. Each session has a clear movement focus, allowing more volume per pattern and better mind-muscle connection than full-body programming.',
 ARRAY['muscle_gain'], 'intermediate', 3, 4),

(gen_random_uuid(),
 'Intermediate Strength Builder',
 'A 4-day powerlifting-style program centred on squat, bench, and deadlift with targeted accessory work. Progressive overload is built in week over week to drive consistent strength gains.',
 ARRAY['strength'], 'intermediate', 4, 4),

(gen_random_uuid(),
 'Intermediate HIIT & Lift',
 'Pairs heavy compound strength sets with high-intensity interval finishers to simultaneously build muscle and accelerate fat loss. Metabolic conditioning rounds are kept short to preserve strength performance on the main lifts.',
 ARRAY['fat_loss'], 'intermediate', 4, 4),

(gen_random_uuid(),
 'Intermediate Active Lifestyle',
 'Three balanced sessions per week mixing strength, mobility, and conditioning work. Designed for lifters who want to stay athletic and healthy rather than optimise for one specific goal.',
 ARRAY['general_fitness'], 'intermediate', 3, 4),

-- ── ADVANCED ──────────────────────────────────────────────────────────────────

(gen_random_uuid(),
 'Advanced Powerlifting Foundation',
 'A 4-day program that peaks squat, bench, and deadlift strength using periodised intensity blocks. Includes competition-style technique work and heavy accessory movements to close weak points.',
 ARRAY['strength'], 'advanced', 4, 4),

(gen_random_uuid(),
 'Advanced Hypertrophy Program',
 'A high-volume 5-day bodybuilding split with dedicated sessions for each major muscle group. Uses mechanical drop sets, supersets, and escalating rep ranges to maximise hypertrophic stimulus.',
 ARRAY['muscle_gain'], 'advanced', 5, 4),

(gen_random_uuid(),
 'Advanced Upper/Lower',
 'A 4-day upper/lower split using advanced techniques — cluster sets, rest-pause, and heavy overload work — for experienced lifters who have outgrown standard linear progression.',
 ARRAY['muscle_gain'], 'advanced', 4, 4),

(gen_random_uuid(),
 'Advanced Athletic Performance',
 'Four sessions per week combining maximal strength work, power development (cleans, jumps), and conditioning to build a well-rounded athletic base. Suitable for sport-specific off-season preparation.',
 ARRAY['athletic'], 'advanced', 4, 4),

-- ── GENERAL ───────────────────────────────────────────────────────────────────

(gen_random_uuid(),
 'Weekend Warrior (2-Day)',
 'Two comprehensive sessions designed for people who can only train on weekends. Each session is a full-body workout hitting every major pattern so nothing is neglected between long rest periods.',
 ARRAY['general_fitness'], 'beginner', 2, 4),

(gen_random_uuid(),
 '5-Day Active Lifestyle',
 'Five shorter, moderate-intensity sessions spread across the week to keep you active every weekday. Sessions alternate between upper, lower, and full-body focus with enough variety to prevent boredom.',
 ARRAY['general_fitness'], 'beginner', 5, 4);
