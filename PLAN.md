# Tempo — Implementation Plan: Programming Engine v2 + First-Time Experience

Two connected upgrades. The **engine** determines whether a generated workout reads
like a coach wrote it; the **first-time experience** teaches the user *why* Tempo
feels intelligent. If the engine still emits random-feeling sessions, no tutorial
can sell the "designed for me" feeling — so **build the engine first**, then teach it.

Status legend: **[BUILD]** this effort · **[REUSE]** existing system · **[DECISION]** needs sign-off.

---

## PART A — Current architecture (what exists, verified by reading the code)

### A1. Workout programming (Feature 2 territory)
- **`lib/generatePlan.ts`** runs **client-side** against Supabase (not an edge function).
  Pipeline: `buildSessionTemplates(goal, days)` → `buildBlockContext` (fetch core
  exercises, group `byPattern[movement_pattern]`, sort, cap 14) → `pickExercises`
  (one exercise per pattern slot, rotated by session index) → `buildBlockRows`
  (writes `scheduled_workouts` rows with `exercise_ids`, `week_index`, `progression`).
- Reused by **`extendActivePlan`** (4-week rollover on app open) and
  **`restampFuturePlanForExperience`** (level-up re-selection). Both call the SAME
  `buildSessionTemplates` + `pickExercises`, so a change there propagates everywhere.
- **`SessionTemplate = { focus, patterns: string[] }`** where patterns are the 8
  coarse `movement_pattern` values (`push/pull/hinge/squat/carry/core/cardio/mobility`).
- **`lib/progression.ts` `buildPrescription(last, goal, pattern, …)`** decides
  sets/reps/rest/weight **at runtime in the runner** (`plan.tsx loadWorkout`), NOT at
  generation. Rep scheme is **goal-only** (`GOAL_SCHEME`); `pattern` is used only to
  pick the weight increment. Plan rows store `exercise_ids` only — never per-exercise
  reps — so autoregulation + periodization stay live. **We must preserve that.**
- **The data problem (root cause), confirmed from the seed:** `movement_pattern` is
  too coarse and frequently miscategorised for programming — biceps curls are `pull`,
  cleans are `hinge/quads`, calf raises / leg extensions / leg curls all fall under
  `squat`/`hinge`. `primary_muscles` (e.g. `quads`, `hamstrings`, `biceps`, `chest`,
  `lats`, `calves`) **is** reliably populated on core rows; `muscle_group` too. So the
  engine has enough signal to classify — it just isn't using muscles or an
  exercise *role* (compound vs isolation vs power).
- **`lib/quickWorkout.ts`** builds Quick Workouts (same library, `injuriesToRestrictions`).
- **`plan-explainer.tsx`** explains the *week's* periodization, not per-exercise order.

### A2. First-run / onboarding (Feature 1 territory)
- **Gate:** `app/(tabs)/_layout.tsx:14` → `if (!profile?.onboarding_complete) Redirect('/onboarding/goal')`.
  This is the single choke point every tab entry passes through — the natural place
  to insert a Welcome gate.
- **Finish flow:** `onboarding/plan-preview.tsx` upserts the profile → `generatePlan` →
  flips `onboarding_complete=true` (separate update, only after the plan exists) →
  **new user** `router.replace('/onboarding/profile-setup')` → `/(tabs)`; **re-plan**
  → `dismissAll()` → `/(tabs)`.
- **`onboarding_complete` is the only first-run flag.** No tutorial/first-workout state
  exists anywhere. A **one-off coach overlay already exists** in the runner
  (`localStorage 'tempo.coach.session'`, added recently) and a **first-time lift hint**
  — both are precursors to fold into the framework, not duplicate.
- **Stores:** `stores/auth.ts` (zustand: session + profile, localStorage profile cache
  keyed by userId). Device-local prefs (`units`, `theme`, `restPrefs`, the coach flag)
  all use the **SQLite-backed `globalThis.localStorage`**, read synchronously at init.
- **React Query** owns server data; `invalidateTrainingData(queryClient)` after mutations.

### A3. Reusable primitives (verified — DO NOT duplicate)
| Need | Reuse |
|---|---|
| Press feedback | `PressableScale` (motion.tsx) |
| Entrances | `FadeInView`, `PopIn`, `ScreenTransition` (motion.tsx) |
| Reduced motion | `useReducedMotion()`, `useScreenFocused()` (motion.tsx) |
| Celebration | `ConfettiBurst` (has `count` → bigger burst), `CountUp` (celebration.tsx) |
| Brand motion | `TempoPulse`, `TempoWordmark`, `PulseLoader` (brand.tsx) |
| Haptics | `lib/haptics.ts` → `tapLight` / `tapMedium` / `success` / `warning` |
| Analytics | `track()` typed by `EventProperties`; super-props already inject `platform` + `app_version` |
| Sheets / empties | `OptionSheet`, `EmptyState` |
| Theme | `useTheme`, `useThemedStyles`, `Palette`, `Spacing/Radius/CardShadow` |

---

## PART B — Feature 2: Programming Engine v2

### B1. Conflicts with existing systems
1. **Runtime prescription must stay adaptive.** We must NOT bake static reps into plan
   rows (`exercise_config`) — that would bypass autoregulation/periodization (a
   regression). Fix: make `buildPrescription` **role-aware** by passing the exercise's
   role, keeping reps dynamic.
2. **Three call sites share the template/selection code** (`generatePlan`,
   `extendActivePlan`, `restampFuturePlanForExperience`). All must keep working — so the
   new slot model replaces `patterns` in `buildSessionTemplates`/`pickExercises` in one
   place and every caller inherits it.
3. **Duration model** (`exerciseCountForDuration` / `estimateSessionMinutes`) currently
   drives how many exercises fit. The new templates have a *natural* length per goal;
   `targetCount` must reconcile with the template (clamp the template to the
   time-budget count, dropping lowest-priority slots first — never the primary compound).
4. **Quick Workout** uses its own builder — v2 classifier should be shared so Quick
   Workouts benefit too, but its selection logic is separate scope (note, don't break).
5. **Existing plans in the wild.** Users already have `scheduled_workouts` with old
   `exercise_ids`. v2 must not corrupt them: new logic only affects **newly generated /
   rolled-over / restamped** sessions. Past + current sessions render unchanged. No
   backfill, no migration → **zero migration risk** (see B4).

### B2. Implementation plan
**New: `lib/exerciseProgramming.ts`** (pure, shared, no I/O):
- `type Role = 'power' | 'primary_compound' | 'secondary_compound' | 'compound' | 'isolation' | 'core' | 'cardio'`
- `type Slot` = a finer movement category the templates order by:
  `squat | hinge | lunge | knee_flexion | quad_iso | calf | glute_iso |
   h_push | v_push | chest_iso | h_pull | v_pull | rear_delt | lat_raise |
   biceps | triceps | core | cardio | carry`
- `classifyExercise(ex) → { role, slot, primaryMuscle }` — deterministic, derived from
  `primary_muscles` (main signal) + curated name keywords (e.g. "curl"→biceps,
  "extension"+quad→quad_iso, "raise"+calf→calf, "romanian|rdl|good morning"→hinge,
  "row"→h_pull, "pulldown|pull-up|chin"→v_pull, "press"+incline/flat→h_push/v_push,
  "fly"→chest_iso, "lateral raise"→lat_raise, "face pull|rear"→rear_delt,
  "lunge|split squat|step up"→lunge, "leg curl|nordic"→knee_flexion) +
  `movement_pattern`/`required_equipment` as tie-breakers. **Compound vs isolation**
  from # of primary+secondary muscles and slot. **Power** from clean/snatch/jerk/jump.
- `SLOT_TO_INCREMENT` and role→rep-modifier tables live here too.
- **Testable:** a `describe`-free self-check dump (a dev script prints the classified
  core pool) so we can eyeball misclassifications against real DB rows (Step 0).

**New session template model** (replaces flat `patterns[]`), still in `generatePlan.ts`:
- `SessionTemplate = { focus, slots: SlotSpec[] }`, `SlotSpec = { slot: Slot; role: Role; muscle?: string; optional?: boolean }`.
- Ordered by the coach hierarchy: **power → primary compound → secondary compound →
  accessory compound → isolation → core/cardio finisher.** Encoded per goal × split
  (the brief's Lower Hypertrophy / Lower Strength / Push / Pull / PPL / Upper-Lower /
  5-day templates translate directly to slot lists).
- Example Lower Hypertrophy: `[squat/primary_compound, hinge/secondary_compound,
  {lunge|leg_press}/compound, knee_flexion/isolation, quad_iso/isolation,
  calf/isolation, core]`.

**New selection (`selectForSlots`)** replacing `pickExercises`:
- Group core pool by **Slot** (via classifier), popularity+equipment sorted.
- For each slot in order, pick the best not-yet-used exercise, enforcing:
  **anti-redundancy** (no two picks share the same base lift family — e.g. never two
  deadlift variants; dedupe by a `liftFamily(name)` key), **muscle coverage** (ensure
  hamstrings/quads/etc. each get direct work when the template asks), **rotation**
  (session-index offset for week-to-week variety, e.g. Back → Front → Hack squat).
- Padding when a slot is empty (thin equipment) uses **slot affinity** (a missing
  knee_flexion borrows another hamstring movement, never a plank) — evolve the existing
  `PATTERN_AFFINITY`.
- **Clamp to `targetCount`** by dropping `optional`/lowest-priority slots first.

**Role-aware prescription** (`progression.ts`):
- `buildPrescription(last, goal, pattern, …, role?)` — role shifts reps/sets/rest
  *within* the goal: primary compounds skew heavier/lower-rep + longer rest; isolations
  skew higher-rep + shorter rest. Runner passes `classifyExercise(ex).role`. Default
  (no role) = today's behaviour → back-compat for old rows/custom workouts.

**Explainability** (`lib/sessionRationale.ts`, pure):
- `describeSession(orderedExercises) → { headline, lines[] }` derived from slot roles
  ("Squats lead — your highest-priority movement. RDLs follow to train hamstrings
  without cutting into squat performance. Isolation and calves finish."). Rendered as a
  **"Why this workout" sheet** from the runner hub (reuses plan-explainer card style).
  No stored data — derived at render, so it's correct for any session incl. edited ones.

### B3. New services / hooks / components
- `lib/exerciseProgramming.ts` (classifier + tables) — **[BUILD]**
- `lib/sessionRationale.ts` (reasoning) — **[BUILD]**
- Refactor inside `lib/generatePlan.ts` (templates + selection) — **[BUILD]**
- Extend `lib/progression.ts buildPrescription` (role param) — **[BUILD]**
- Runner: pass role into `buildPrescription`; add "Why this workout" entry (sheet) — **[BUILD]**
- Optional: fold shared classifier into `lib/quickWorkout.ts` later — **[REUSE/defer]**

### B4. Database changes
- **NONE required.** Classification is a pure client function over columns that already
  exist (`primary_muscles`, `movement_pattern`, `required_equipment`, `name`). Reasoning
  is derived at render. This is the migration-safe choice and means **existing users
  upgrade with zero data changes**; their next generated/rolled-over block simply reads
  better. (A future optimization could persist a computed `slot`/`role` column for
  SQL-side filtering, but it's not needed and would add backfill risk.)

### B5. Edge cases / failure scenarios
- **Misclassification** (e.g. an oddly-named import) → falls back to `movement_pattern`
  bucket + `isolation` role; never crashes, worst case one slightly-off pick. Step 0
  audit dump catches the big ones.
- **Thin equipment / injuries empty a slot** → affinity padding + honest shorter session
  (existing behaviour preserved).
- **Anti-redundancy starves a slot** (only deadlift variants available for two hinge-ish
  slots) → allow the dupe rather than emit an empty slot, but prefer a different
  liftFamily first.
- **Offline / force-close during generation** → unchanged: `generatePlan` already throws
  on write failure and `plan-preview` surfaces it; `onboarding_complete` only flips after
  success (no half-onboarded state).
- **Rollover / restamp mid-block** must keep exercise *rotation* continuity → carry the
  session-index offset exactly as today.
- **Performance** — classifier is O(pool) pure math on ~150–250 core rows, memoizable;
  no extra queries. Duration estimate unchanged.
- **Reduced motion / a11y** — engine is non-visual; the "Why this workout" sheet reuses
  reduced-motion-aware components.

---

## PART C — Feature 1: First-Time Experience

### C1. Conflicts / rules
- **No slideshow, no screen-freeze.** Spotlight overlays dim + cut out a target and
  still show the UI (Home tour). One concept per step, ≤2 sentences, animated + haptic.
- **Never annoy existing users.** The gate must be *opt-in*: a first-run tutorial only
  shows if it was **explicitly armed** at the deterministic new-user moment (onboarding
  success, non-replan). Existing users, re-planners, and reinstalls never arm it → never
  see it. (This avoids a fragile "have they done a workout?" server probe as the primary
  gate — see C5.)
- **Never mark complete on API failure / support offline.** Tutorial state is
  **device-local** (localStorage), so steps complete without any network. Server writes
  (e.g. the First-Session achievement) are best-effort and independent of step completion.
- **Absorb, don't duplicate** the existing runner coach overlay + first-time hint.

### C2. Tutorial framework (the reusable engine)
**`lib/tutorial.ts` (service) + `stores/tutorial.ts` (zustand, localStorage-persisted, keyed by userId):**
```
TutorialState = {
  version: number,                       // schema version of the store
  completedSteps: Record<stepId, true>,  // stable ids, never re-shown
  skipped: Record<tutorialId, true>,
  armed: Record<tutorialId, true>,       // set at the new-user moment; gate reads this
  firstPlanCreated: boolean,
  firstWorkoutCompleted: boolean,
  lastSeenAt: number,
}
```
- **Persistence:** SQLite-localStorage, key `tempo.tutorial.<userId>` (same pattern as the
  profile cache). Survives restart + app update (never cleared on upgrade). A `version`
  field lets us migrate/retire steps without wiping progress.
- **API:** `armFirstRun(userId)`, `isArmed(tut)`, `completeStep(id)`, `isStepDone(id)`,
  `skipTutorial(tut)`, `replayTutorial(tut)` (clears its steps+skip, re-arms),
  `markFirstWorkoutComplete()`, `resetAll(userId)` (Settings → replay).
- **Definitions:** `TUTORIALS` = ordered `TutorialStep[]` per tutorial id
  (`welcome`, `home_tour`, `first_workout`), each step `{ id, target?, title, body,
   placement, advanceOn: 'tap'|'interact', experience?: 'beginner'|'all' }`.
  Experience-gated copy (beginner explains sets/reps/RPE; experienced explains
  adaptation/periodization) selected from `profile.experience`.

**`TutorialOverlay` component (spotlight coach-mark):**
- A generic overlay driven by a **target registry**: screens tag highlightable elements
  with `useTutorialTarget(id)` (measures `measureInWindow`, stores rect in the store).
  The overlay reads the active step's `target` → rect → renders **dim + rounded cutout +
  floating tooltip card + pulse/arrow**. Missing/unmeasured target → graceful centered
  tooltip (never breaks). `pointerEvents` tuned so the spotlighted element stays visible;
  advance on Next **or** on interacting with the target.
- Built entirely on `useReducedMotion`, `PressableScale`, `FadeInView`, `haptics` —
  reduced motion drops movement, keeps fades + the dim/cutout.

### C3. Surfaces (screens/flows)
1. **Welcome Experience** — new route `app/welcome.tsx` (fullscreen, `gestureEnabled:false`).
   `TempoPulse` reveal + `success` haptic; plan cards (`Goal / Schedule / Program /
   First workout`) reveal one at a time (`FadeInView` stagger). "Explore My Plan" →
   marks `welcome` done → `/(tabs)`. **Skip** allowed → `tutorial_skipped`, still routes in.
   Data: read `profile` + the first upcoming `scheduled_workouts` row.
2. **Gate:** in `(tabs)/_layout.tsx`, after the onboarding check:
   `if (isArmed('welcome') && !isStepDone('welcome_done')) Redirect('/welcome')`.
   → **survives force-close**: reopening lands back on Welcome, never restarts onboarding.
3. **Home tour** — 5 spotlight steps (Calendar → Today's workout → GO/Quick → Progress
   tab → Profile) via the overlay + registry, armed for new users, shown on first Home
   focus after Welcome. Tabs live in `TempoTabBar` → it registers its GO/Progress/Profile
   targets.
4. **First-workout tutorial** — evolve the existing runner coach overlay into a
   `first_workout` tutorial: spotlight the ✓ ("Finish a set? Tap ✓"), after first logged
   set fire `success` + "Tempo started your rest timer automatically", spotlight the form
   guide once. Gated by `armed.first_workout && !firstWorkoutCompleted`.
5. **First-workout completion** — bigger celebration on `workout-complete.tsx` when it's
   the user's first: `ConfettiBurst count≈60`, `CountUp`, a **"First Tempo Session"
   achievement card** (extend `lib/achievements.ts`), `success` haptic.
6. **Contextual education** (lightweight, one-off) — a `useOnceTip('tip.<id>')` hook
   (localStorage boolean) drives small inline tips: first edit-workout, first Progress
   visit, first Quick Workout, first equipment change. Not overlays — inline `PopIn` note
   cards, dismissible.
7. **Empty states** — upgrade existing `EmptyState` usages (History, Friends, Saved
   Workouts) with teaching copy + CTA. Pure copy/props, no new system.

### C4. New services / hooks / components / analytics
- `lib/tutorial.ts`, `stores/tutorial.ts`, `TUTORIALS` definitions — **[BUILD]**
- `components/TutorialOverlay.tsx` + `useTutorialTarget` hook + `useOnceTip` hook — **[BUILD]**
- `app/welcome.tsx` route (+ register in `app/_layout.tsx`) — **[BUILD]**
- Extend `lib/achievements.ts` with the "First Tempo Session" unlock — **[BUILD]**
- Extend `EventProperties` (analytics) with: `tutorial_started`, `tutorial_step_completed`,
  `tutorial_skipped`, `tutorial_completed`, `tutorial_replayed`, `first_workout_started`,
  `first_set_logged`, `first_workout_completed` — each carries `experience` (platform +
  app_version are already auto super-props) — **[BUILD]**
- Settings row "Replay tutorials" → `replayTutorial`/`resetAll` — **[BUILD]**
- Reuse everything in A3 for visuals/haptics/motion — **[REUSE]**

### C5. Edge cases / failure scenarios
- **Existing user upgrades** → never armed → sees nothing. **Re-plan** → armed only when
  `!isReplan` in plan-preview → correct. **Reinstall of an established account** → local
  state empty, but `armFirstRun` was never called on this install → not armed → nothing
  shows (safe default). *(Optional nicety: a one-time server-signal reconcile that could
  RE-show for a genuine new device — deliberately deferred; the safe default is "don't
  annoy".)*
- **Force-close during Welcome** → gate re-shows Welcome (state persisted). During Home
  tour → step ids already completed are skipped; resumes at the next step. During first
  workout → `firstWorkoutCompleted` only set on real completion, so a mid-workout quit
  resumes the tutorial.
- **Failed API (achievement/analytics)** → never blocks step completion (local-first).
- **Reduced motion** → overlay keeps dim/cutout + fades, drops movement; confetti skipped
  by `ConfettiBurst` itself; `CountUp` renders final value.
- **Target not measured / off-screen** (slow mount, small phone) → centered-tooltip
  fallback; overlay never traps input.
- **Skip** → marks skipped + completes the tutorial's steps so it won't re-fire; replayable
  from Settings.
- **A user with a plan but no first upcoming workout** (all rest ahead) → Welcome's
  "first workout" card shows "Your first session is coming up" instead of a date.

---

## PART D — Sequencing & checkpoints (branch `feature/engine-and-first-run`)
Each phase: typecheck + Metro export + commit. Merge to `main` at the end (no push).
1. **Engine v2 core** — `exerciseProgramming.ts` classifier + Step-0 audit dump; new
   templates + `selectForSlots`; wire `generatePlan`/rollover/restamp. (No UI, no migration.)
2. **Role-aware prescription + "Why this workout"** — `progression.ts` role param; runner
   passes role; `sessionRationale.ts` + sheet.
3. **Tutorial framework** — `tutorial.ts` + `stores/tutorial.ts` + `TutorialOverlay` +
   registry/hooks + analytics events. (No surfaces yet — framework in isolation.)
4. **Welcome + gate** — `app/welcome.tsx`, `(tabs)/_layout` gate, `plan-preview` arming.
5. **Home tour + first-workout tutorial** — spotlight steps; absorb the existing coach
   overlay; first-set moment.
6. **First-completion celebration + achievement + contextual tips + empty states +
   Settings replay.**
7. **Docs** — ARCHITECTURE.md + AUDIT.md follow-ups; verify checklist.

**Decisions needed before build:** (1) engine-first sequencing OK? (2) tutorial state
local-first (recommended) vs DB-backed? (3) proceed now, or review the plan first?
