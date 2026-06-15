-- Tempo Exercise Library — 50 exercises
-- Run SECOND (after schema migration) in Supabase SQL Editor.
-- Uses fixed UUIDs so substitute_ids can cross-reference.

INSERT INTO public.exercises
  (id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, substitute_ids)
VALUES

-- ── BEGINNER BODYWEIGHT (1–8) ─────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000001',
 'Push-Up', 'push',
 ARRAY['chest','triceps','shoulders'], ARRAY['core'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Start in a high plank: hands shoulder-width apart, body in a straight line from head to heels.',
   'Lower your chest toward the floor, keeping elbows at roughly 45° from your sides.',
   'Press through your palms to return to the start. Keep your hips from sagging or piking.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000031']::uuid[]),

('00000000-0000-0000-0000-000000000002',
 'Bodyweight Squat', 'squat',
 ARRAY['quads','glutes'], ARRAY['hamstrings','core'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Stand with feet shoulder-width apart and toes turned out slightly.',
   'Push your knees out and sit your hips back and down until thighs are parallel to the floor.',
   'Drive through your heels to return to standing. Keep your chest tall throughout.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000024']::uuid[]),

('00000000-0000-0000-0000-000000000003',
 'Reverse Lunge', 'squat',
 ARRAY['quads','glutes'], ARRAY['hamstrings','calves'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Stand tall with feet hip-width apart.',
   'Step one foot back and lower your rear knee toward the floor, keeping your front shin vertical.',
   'Push through your front heel to return to standing. Alternate legs each rep.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000032']::uuid[]),

('00000000-0000-0000-0000-000000000004',
 'Plank', 'core',
 ARRAY['abs','transverse_abdominis'], ARRAY['shoulders','glutes'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Place forearms on the floor, elbows under shoulders. Extend legs behind you onto your toes.',
   'Squeeze your abs, glutes, and quads to create a rigid straight line from head to heels.',
   'Hold the position. Breathe steadily — do not hold your breath.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000043']::uuid[]),

('00000000-0000-0000-0000-000000000005',
 'Glute Bridge', 'hinge',
 ARRAY['glutes','hamstrings'], ARRAY['lower_back','core'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Lie on your back with knees bent and feet flat on the floor, hip-width apart.',
   'Drive through your heels to lift your hips until your body forms a straight line from knees to shoulders.',
   'Squeeze your glutes hard at the top, then lower slowly. Do not arch your lower back.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000025']::uuid[]),

('00000000-0000-0000-0000-000000000006',
 'Mountain Climber', 'cardio',
 ARRAY['abs','hip_flexors'], ARRAY['shoulders','quads'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Start in a high plank with hands directly under shoulders.',
   'Drive one knee toward your chest, then quickly switch legs in a running motion.',
   'Keep your hips level and your core braced throughout. Aim for a steady, controlled pace.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000007']::uuid[]),

('00000000-0000-0000-0000-000000000007',
 'Burpee', 'cardio',
 ARRAY['chest','quads','glutes'], ARRAY['shoulders','triceps','core'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'From standing, hinge and place hands on the floor, then jump or step feet back into a push-up position.',
   'Perform a push-up, then jump or step feet back toward your hands.',
   'Explosively jump up, reaching arms overhead. Land softly and immediately go into the next rep.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000049']::uuid[]),

('00000000-0000-0000-0000-000000000008',
 'Jumping Jack', 'cardio',
 ARRAY['legs','shoulders'], ARRAY['calves','core'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Stand with feet together and arms at your sides.',
   'Jump your feet out to shoulder-width while raising both arms overhead.',
   'Jump back to the starting position. Keep a steady rhythm and land softly.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000048']::uuid[]),

-- ── BEGINNER DUMBBELL (9–16) ──────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000009',
 'Goblet Squat', 'squat',
 ARRAY['quads','glutes'], ARRAY['core','hamstrings'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Hold one dumbbell vertically at chest height with both hands cupping the top.',
   'Set feet shoulder-width apart with toes slightly out. Brace your core.',
   'Squat down until elbows meet your inner thighs, keeping your chest tall.',
   'Drive through your heels to stand, squeezing your glutes at the top.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000024']::uuid[]),

('00000000-0000-0000-0000-000000000010',
 'Dumbbell Row', 'pull',
 ARRAY['lats','rhomboids'], ARRAY['biceps','rear_delts'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Place one knee and hand on a bench for support. Hold a dumbbell in the opposite hand.',
   'Let the dumbbell hang straight down, then row it to your hip by driving your elbow toward the ceiling.',
   'Squeeze your shoulder blade at the top, then lower with control. Keep your torso parallel to the floor.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000023']::uuid[]),

('00000000-0000-0000-0000-000000000011',
 'Dumbbell Shoulder Press', 'push',
 ARRAY['shoulders','triceps'], ARRAY['upper_chest'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Sit upright holding dumbbells at shoulder height, palms facing forward, elbows at 90°.',
   'Press the dumbbells straight up until your arms are nearly locked out overhead.',
   'Lower slowly back to shoulder height. Avoid shrugging your traps or arching your lower back.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000020']::uuid[]),

('00000000-0000-0000-0000-000000000012',
 'Bicep Curl', 'pull',
 ARRAY['biceps'], ARRAY['forearms','brachialis'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Stand holding dumbbells at your sides, palms facing forward.',
   'Curl both weights toward your shoulders by flexing at the elbow. Keep your upper arms pinned to your sides.',
   'Lower with control back to full extension. Do not swing your torso for momentum.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000029']::uuid[]),

('00000000-0000-0000-0000-000000000013',
 'Tricep Overhead Extension', 'push',
 ARRAY['triceps'], ARRAY['shoulders'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Hold one dumbbell with both hands overhead, arms fully extended.',
   'Keeping your upper arms vertical, lower the dumbbell behind your head by bending at the elbows.',
   'Press back up to full extension. Keep your core braced and elbows pointed forward.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000037']::uuid[]),

('00000000-0000-0000-0000-000000000014',
 'Dumbbell Romanian Deadlift', 'hinge',
 ARRAY['hamstrings','glutes'], ARRAY['lower_back','calves'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Stand holding dumbbells in front of your thighs, feet hip-width apart.',
   'Push your hips back while lowering the dumbbells along your legs, feeling a stretch in your hamstrings.',
   'Keep your back flat and chest up throughout. Drive your hips forward to return to standing.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000041']::uuid[]),

('00000000-0000-0000-0000-000000000015',
 'Lateral Raise', 'push',
 ARRAY['lateral_deltoids'], ARRAY['traps','upper_traps'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Stand holding light dumbbells at your sides, slight bend in the elbows.',
   'Raise both arms out to the sides until they reach shoulder height, leading with the elbows.',
   'Lower slowly in 2–3 seconds. Avoid shrugging or swinging to initiate the movement.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000028']::uuid[]),

('00000000-0000-0000-0000-000000000016',
 'Dumbbell Chest Press', 'push',
 ARRAY['chest','triceps'], ARRAY['shoulders'],
 ARRAY['dumbbells'], 'beginner',
 ARRAY[
   'Lie on a bench (or floor) holding dumbbells at chest level, palms facing your feet.',
   'Press the dumbbells up and slightly inward until your arms are extended.',
   'Lower with control, bringing elbows to roughly 45° from your sides. Feel a stretch in your chest at the bottom.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000018']::uuid[]),

-- ── BEGINNER BARBELL (17–21) ──────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000017',
 'Barbell Back Squat', 'squat',
 ARRAY['quads','glutes'], ARRAY['hamstrings','core','lower_back'],
 ARRAY['barbell'], 'beginner',
 ARRAY[
   'Set the barbell on your upper traps (high bar) or rear delts (low bar). Unrack and step back with feet shoulder-width apart.',
   'Brace your core hard. Push your knees out and sit your hips down until your thighs are at least parallel.',
   'Drive your feet through the floor to stand. Keep your chest up and do not let your knees cave in.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000024']::uuid[]),

('00000000-0000-0000-0000-000000000018',
 'Barbell Bench Press', 'push',
 ARRAY['chest','triceps'], ARRAY['shoulders','core'],
 ARRAY['barbell'], 'beginner',
 ARRAY[
   'Lie on a flat bench with eyes under the bar. Grip slightly wider than shoulder-width. Plant feet firmly on the floor.',
   'Unrack the bar and lower it to your lower chest with control, tucking your elbows at roughly 45°.',
   'Press the bar back up in a slight arc toward your eye line until your arms are locked out.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000001']::uuid[]),

('00000000-0000-0000-0000-000000000019',
 'Conventional Deadlift', 'hinge',
 ARRAY['hamstrings','glutes','erectors'], ARRAY['traps','lats','core'],
 ARRAY['barbell'], 'beginner',
 ARRAY[
   'Stand with feet hip-width apart and the bar over mid-foot. Hinge down and grip just outside your knees.',
   'Take a deep breath, brace your core, and set your back flat by lifting your chest slightly.',
   'Push the floor away while keeping the bar against your legs. Stand tall at the top, squeezing your glutes.',
   'Hinge at the hips to lower the bar under control, keeping it close to your body.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000035']::uuid[]),

('00000000-0000-0000-0000-000000000020',
 'Barbell Overhead Press', 'push',
 ARRAY['shoulders','triceps'], ARRAY['upper_chest','core'],
 ARRAY['barbell'], 'beginner',
 ARRAY[
   'Grip the bar just outside shoulder-width. Hold it at upper chest level with elbows slightly in front.',
   'Brace your core and glutes, then press the bar straight overhead until your arms lock out.',
   'Lower the bar back to your clavicle under control. Avoid leaning back excessively.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000011']::uuid[]),

('00000000-0000-0000-0000-000000000021',
 'Barbell Bent-Over Row', 'pull',
 ARRAY['lats','rhomboids'], ARRAY['biceps','erectors','rear_delts'],
 ARRAY['barbell'], 'beginner',
 ARRAY[
   'Hinge forward until your torso is roughly 45° to the floor. Grip the bar just outside shoulder-width.',
   'Row the bar to your lower chest or upper abdomen by driving your elbows back and up.',
   'Squeeze your shoulder blades together at the top, then lower the bar with control.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000023']::uuid[]),

-- ── INTERMEDIATE FULL GYM (22–29) ─────────────────────────────────────────────

('00000000-0000-0000-0000-000000000022',
 'Lat Pulldown', 'pull',
 ARRAY['lats','teres_major'], ARRAY['biceps','rear_delts'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Sit at the lat pulldown machine. Grip the bar wider than shoulder-width with palms facing away.',
   'Lean back slightly, then pull the bar down to your upper chest by driving your elbows toward your hips.',
   'Squeeze your lats at the bottom, then let the bar rise with control. Avoid using momentum.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000038']::uuid[]),

('00000000-0000-0000-0000-000000000023',
 'Seated Cable Row', 'pull',
 ARRAY['lats','rhomboids','mid_traps'], ARRAY['biceps','rear_delts'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Sit at a cable row machine with feet on the platform and knees slightly bent. Grip a close-grip handle.',
   'Sit tall, then row the handle to your lower chest by driving your elbows back past your torso.',
   'Squeeze your shoulder blades together at the end range, then extend your arms with control.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000021']::uuid[]),

('00000000-0000-0000-0000-000000000024',
 'Leg Press', 'squat',
 ARRAY['quads','glutes'], ARRAY['hamstrings','calves'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Sit in the leg press machine with feet shoulder-width apart in the middle of the platform.',
   'Release the safety handles, then lower the sled until your knees reach 90° or slightly past.',
   'Press through the full foot to extend your legs — do not lock out your knees hard. Keep your lower back against the pad.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-000000000009']::uuid[]),

('00000000-0000-0000-0000-000000000025',
 'Leg Curl', 'hinge',
 ARRAY['hamstrings'], ARRAY['calves','glutes'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Lie face-down on the leg curl machine with the pad just above your heels.',
   'Curl your heels toward your glutes as far as possible, squeezing your hamstrings at the top.',
   'Lower the weight back to full extension with control. Avoid lifting your hips off the pad.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000005']::uuid[]),

('00000000-0000-0000-0000-000000000026',
 'Leg Extension', 'squat',
 ARRAY['quads'], ARRAY['hip_flexors'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Sit in the leg extension machine with the pad resting on the front of your ankles.',
   'Extend both legs fully by straightening the knee, squeezing your quads hard at the top.',
   'Lower the weight slowly back to 90°. Avoid slamming the weight stack.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000024']::uuid[]),

('00000000-0000-0000-0000-000000000027',
 'Cable Fly', 'push',
 ARRAY['chest'], ARRAY['shoulders','biceps'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Set cable pulleys at chest height. Stand in the center holding handles with a slight forward lean.',
   'With a slight bend in your elbows, draw your hands together in a hugging arc in front of your chest.',
   'Squeeze your chest hard at the peak contraction, then open your arms back with control. Do not let the cables jerk your shoulders open.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000001']::uuid[]),

('00000000-0000-0000-0000-000000000028',
 'Face Pull', 'pull',
 ARRAY['rear_delts','rotator_cuff'], ARRAY['traps','rhomboids'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Attach a rope to a cable set at face height. Grip both ends with palms facing in.',
   'Pull the rope toward your face, flaring your elbows out to the sides so hands end up beside your ears.',
   'Hold the end position for a beat to feel the rear delts contract, then extend arms with control.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000015']::uuid[]),

('00000000-0000-0000-0000-000000000029',
 'Cable Bicep Curl', 'pull',
 ARRAY['biceps'], ARRAY['forearms','brachialis'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Attach a straight bar or EZ-bar to a low cable. Stand with feet hip-width apart, arms extended.',
   'Curl the bar up to shoulder height by flexing at the elbow, keeping upper arms stationary.',
   'Lower with control to full extension. The constant cable tension challenges the muscle differently than free weights.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000012']::uuid[]),

-- ── INTERMEDIATE COMPOUND (30–34) ─────────────────────────────────────────────

('00000000-0000-0000-0000-000000000030',
 'Pull-Up', 'pull',
 ARRAY['lats','biceps'], ARRAY['rear_delts','teres_major'],
 ARRAY['bodyweight'], 'intermediate',
 ARRAY[
   'Hang from a bar with an overhand grip, hands slightly wider than shoulder-width. Fully extend your arms.',
   'Pull yourself up by driving your elbows toward your hips until your chin clears the bar.',
   'Lower with full control to a dead hang before the next rep. Avoid kipping unless programmed for it.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000038']::uuid[]),

('00000000-0000-0000-0000-000000000031',
 'Dip', 'push',
 ARRAY['chest','triceps'], ARRAY['shoulders'],
 ARRAY['bodyweight'], 'intermediate',
 ARRAY[
   'Grip parallel bars and support your weight with arms locked out, shoulders depressed.',
   'Lower yourself by bending your elbows until your upper arms are parallel to the floor. A slight forward lean emphasises the chest; staying upright hits the triceps more.',
   'Press back up to the start, fully extending your elbows without locking out aggressively.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000037']::uuid[]),

('00000000-0000-0000-0000-000000000032',
 'Bulgarian Split Squat', 'squat',
 ARRAY['quads','glutes'], ARRAY['hamstrings','calves'],
 ARRAY['dumbbells'], 'intermediate',
 ARRAY[
   'Stand about two feet in front of a bench. Place the top of your rear foot on the bench behind you.',
   'Hold dumbbells at your sides. Lower your rear knee toward the floor until your front thigh is parallel.',
   'Drive through your front heel to stand. Keep your torso upright and front knee tracking over your toes.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000003']::uuid[]),

('00000000-0000-0000-0000-000000000033',
 'Incline Barbell Bench Press', 'push',
 ARRAY['upper_chest','triceps'], ARRAY['shoulders'],
 ARRAY['barbell'], 'intermediate',
 ARRAY[
   'Set a bench to 30–45°. Lie back and grip the bar just wider than shoulder-width.',
   'Lower the bar to your upper chest with control, keeping elbows at a 45° angle from your torso.',
   'Press back up until arms are nearly locked. The incline angle shifts emphasis to the upper chest.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000018','00000000-0000-0000-0000-000000000027']::uuid[]),

('00000000-0000-0000-0000-000000000034',
 'Pendlay Row', 'pull',
 ARRAY['lats','rhomboids'], ARRAY['biceps','erectors'],
 ARRAY['barbell'], 'intermediate',
 ARRAY[
   'Set a barbell on the floor. Stand with feet hip-width apart and hinge until your torso is nearly horizontal.',
   'Grip the bar just outside your knees. Row it explosively to your lower chest, letting it touch.',
   'Lower the bar all the way back to the floor between every rep. This strict reset builds raw back strength.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000023']::uuid[]),

-- ── ADVANCED (35–41) ──────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000035',
 'Sumo Deadlift', 'hinge',
 ARRAY['glutes','inner_thighs'], ARRAY['hamstrings','erectors','traps'],
 ARRAY['barbell'], 'advanced',
 ARRAY[
   'Take a wide stance with toes pointed out 45°. Grip the bar just inside your knees with a double-overhand or mixed grip.',
   'Push your knees out hard, chest up, hips low. This is different from conventional — think "leg press the floor away."',
   'As the bar passes your knees, drive your hips through to lockout. Keep the bar on your legs the entire pull.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000019']::uuid[]),

('00000000-0000-0000-0000-000000000036',
 'Pause Squat', 'squat',
 ARRAY['quads','glutes'], ARRAY['hamstrings','core'],
 ARRAY['barbell'], 'advanced',
 ARRAY[
   'Set up and descend exactly as a standard barbell squat, but use 10–20% less weight than your working squat.',
   'At the bottom of the squat, hold completely still for 2–3 seconds. No bouncing out of the hole.',
   'Stay braced and drive out of the pause using pure muscular force. This builds strength through the sticking point.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-000000000040']::uuid[]),

('00000000-0000-0000-0000-000000000037',
 'Close-Grip Bench Press', 'push',
 ARRAY['triceps','chest'], ARRAY['shoulders'],
 ARRAY['barbell'], 'advanced',
 ARRAY[
   'Lie on a flat bench and grip the bar with hands about shoulder-width apart (narrower than a standard bench press).',
   'Lower the bar to your lower chest while keeping your elbows tucked close to your sides.',
   'Press to full lockout, focusing on squeezing the triceps. This narrow grip maximises tricep recruitment.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000013']::uuid[]),

('00000000-0000-0000-0000-000000000038',
 'Weighted Pull-Up', 'pull',
 ARRAY['lats','biceps'], ARRAY['rear_delts','teres_major'],
 ARRAY['full_gym'], 'advanced',
 ARRAY[
   'Attach a weight plate or dumbbell to a dip belt. Hang from a pull-up bar with arms fully extended.',
   'Pull yourself up with control until your chin clears the bar.',
   'Lower back to a dead hang with full control. Adding weight demands strict form — no kipping.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000022']::uuid[]),

('00000000-0000-0000-0000-000000000039',
 'Power Clean', 'carry',
 ARRAY['quads','glutes','traps'], ARRAY['hamstrings','shoulders','core'],
 ARRAY['barbell'], 'advanced',
 ARRAY[
   'Stand with feet hip-width apart, bar over mid-foot. Grip the bar just outside your knees. Set a neutral spine.',
   'Pull the bar off the floor similarly to a deadlift, then explosively extend your hips and shrug hard as the bar passes your waist.',
   'Drop under the bar by catching it in the front rack position — elbows high, bar resting on your front delts.',
   'Stand up to finish the rep, then lower the bar with control. Master the component movements before going heavy.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000049']::uuid[]),

('00000000-0000-0000-0000-000000000040',
 'Front Squat', 'squat',
 ARRAY['quads','core'], ARRAY['glutes','upper_back'],
 ARRAY['barbell'], 'advanced',
 ARRAY[
   'Set the bar in the front rack position across your front delts with elbows high and parallel to the floor.',
   'Keeping elbows up, descend into a squat — the front-loaded position forces a more upright torso than a back squat.',
   'Drive your knees out and push the floor away to stand. Drop the elbows at any point and the bar will fall forward.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-000000000036']::uuid[]),

('00000000-0000-0000-0000-000000000041',
 'Barbell Romanian Deadlift', 'hinge',
 ARRAY['hamstrings','glutes'], ARRAY['erectors','calves'],
 ARRAY['barbell'], 'advanced',
 ARRAY[
   'Stand holding a barbell at hip height with an overhand grip, feet hip-width apart.',
   'Push your hips back and lower the bar along your thighs, feeling a deep hamstring stretch. Your knees bend only slightly.',
   'Drive your hips forward to return to standing. Keep the bar close to your body the entire movement and your back flat.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000014']::uuid[]),

-- ── CORE (42–47) ──────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000042',
 'Dead Bug', 'core',
 ARRAY['abs','transverse_abdominis'], ARRAY['hip_flexors'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Lie on your back with arms pointing at the ceiling and knees bent at 90° above your hips.',
   'Press your lower back firmly into the floor, then slowly lower your right arm and left leg toward the floor simultaneously.',
   'Return to the start and switch sides. Keep your lower back flat — the moment it arches, you have gone too far.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000043']::uuid[]),

('00000000-0000-0000-0000-000000000043',
 'Hollow Body Hold', 'core',
 ARRAY['abs','hip_flexors'], ARRAY['quads','shoulders'],
 ARRAY['bodyweight'], 'intermediate',
 ARRAY[
   'Lie on your back. Press your lower back into the floor, then raise your legs and shoulders off the ground.',
   'Reach your arms overhead (palms up) to increase the lever arm and challenge. Your body should form a shallow C-shape.',
   'Hold the position while breathing steadily. To make it easier, bend your knees; to make it harder, lower your legs.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000042']::uuid[]),

('00000000-0000-0000-0000-000000000044',
 'Ab Wheel Rollout', 'core',
 ARRAY['abs','obliques'], ARRAY['shoulders','lats'],
 ARRAY['bodyweight'], 'intermediate',
 ARRAY[
   'Kneel on the floor holding an ab wheel directly below your shoulders.',
   'Brace your core hard, then slowly roll the wheel forward until your body is nearly parallel to the floor.',
   'Reverse the motion by contracting your abs to pull yourself back to the start. Do not let your hips sag.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000045']::uuid[]),

('00000000-0000-0000-0000-000000000045',
 'Hanging Leg Raise', 'core',
 ARRAY['abs','hip_flexors'], ARRAY['lats','forearms'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Hang from a pull-up bar with arms fully extended and shoulders packed down.',
   'Keeping your legs straight (or knees bent for a regression), raise your feet toward the bar by flexing at the hips.',
   'Lower your legs with control — do not swing. The eccentric is just as important as the raise.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000047']::uuid[]),

('00000000-0000-0000-0000-000000000046',
 'Russian Twist', 'core',
 ARRAY['obliques'], ARRAY['abs','hip_flexors'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Sit on the floor with knees bent, feet flat or slightly raised. Lean back until you feel your abs engage.',
   'Clasp your hands together and rotate your torso to one side, tapping the floor beside your hip.',
   'Rotate to the other side. Add a dumbbell or plate to increase the challenge.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000047']::uuid[]),

('00000000-0000-0000-0000-000000000047',
 'Cable Crunch', 'core',
 ARRAY['abs'], ARRAY['obliques'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Attach a rope to a high cable. Kneel facing the machine, holding the rope at either side of your head.',
   'Without moving your hips, curl your elbows toward your knees by contracting your abs.',
   'Hold the crunched position briefly, then extend back up with control. The cable keeps tension on the abs throughout the full range.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000046','00000000-0000-0000-0000-000000000044']::uuid[]),

-- ── CARDIO (48–50) ────────────────────────────────────────────────────────────

('00000000-0000-0000-0000-000000000048',
 'Jump Rope', 'cardio',
 ARRAY['calves','shoulders'], ARRAY['forearms','core'],
 ARRAY['bodyweight'], 'beginner',
 ARRAY[
   'Hold the rope handles at hip height with arms slightly bent. Stand on the balls of your feet.',
   'Turn the rope with your wrists — not your whole arms — and jump just high enough to clear it.',
   'Aim for a consistent rhythm. Start with 30-second intervals and build from there.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000008']::uuid[]),

('00000000-0000-0000-0000-000000000049',
 'Box Jump', 'cardio',
 ARRAY['quads','glutes','calves'], ARRAY['hamstrings','core'],
 ARRAY['bodyweight'], 'intermediate',
 ARRAY[
   'Stand about a foot from a sturdy box with feet shoulder-width apart.',
   'Dip into a quarter squat, swing your arms, and jump explosively, landing softly on top of the box with both feet at the same time.',
   'Stand fully upright on the box, then step down carefully. Reset before each rep — do not bounce off the ground.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000048']::uuid[]),

('00000000-0000-0000-0000-000000000050',
 'Rowing Machine', 'cardio',
 ARRAY['back','legs'], ARRAY['core','shoulders'],
 ARRAY['full_gym'], 'intermediate',
 ARRAY[
   'Sit on the rower with feet strapped in and knees bent. Grip the handle with an overhand grip, arms extended.',
   'Drive with your legs first, then lean back slightly, then pull the handle to your lower chest — this sequence is key.',
   'Reverse the order to return: extend arms, lean forward, then bend knees. Aim for a stroke rate of 22–26 spm for steady-state cardio.'
 ],
 ARRAY['00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000049']::uuid[]);
