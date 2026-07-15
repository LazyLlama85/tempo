# Tempo — System Architecture & Feature Overview

A detailed description of everything Tempo is — frontend, backend, features, data, integrations.

---

## 1. What Tempo is
A **fitness operating system that adapts to your real life**. Instead of a static program, Tempo
generates a periodized training plan, schedules it around your actual calendar, adapts week-to-week
from your performance and recovery, and — the wedge feature — turns any spare 5–60 minutes into a
purposeful **Quick Workout**. One shared promise: *"no matter how busy your day gets, Tempo keeps
you moving."*

- **Platforms:** iOS + Android (Expo/React Native), iOS bundle id `com.fittempo.app` / Android package `com.fittempo.app`, v1.0.0. A separate
  static **web** marketing site lives in `web/`.
- **Auth modes:** Apple Sign In, Google OAuth, and guest/anonymous.

---

## 2. Tech stack
- **Mobile app** (`mobile/`): Expo SDK ~56, React Native 0.85, React 19, **expo-router** (file-based
  routing, typed routes, React Compiler on), dark-mode-first design system.
- **Client state:** **zustand** for auth/session (`src/stores/auth.ts`); **TanStack Query** for all
  server data (caching, refetch, error→Sentry funnel), with
  `@tanstack/react-query-persist-client` + `@tanstack/query-sync-storage-persister` (both JS-only)
  persisting the training cache to the SQLite-backed `localStorage` for instant cold starts.
- **Backend:** **Supabase** — Postgres (with Row-Level Security), Auth, Edge Functions (Deno),
  Storage, and `pg_cron` + `pg_net` for scheduling.
- **Telemetry:** **PostHog** (product analytics) + **Sentry** (crash/error). Both no-op without keys.
- **Fonts/UI:** Inter (`@expo-google-fonts/inter`) for body/UI, **Bricolage Grotesque** (display)
  + **JetBrains Mono** (numerals) loaded in the root layout for the redesign type system;
  `@expo/vector-icons` (Ionicons), `expo-image`, `react-native-reanimated`,
  `react-native-gesture-handler`, `expo-glass-effect`.

---

## 3. Frontend

### 3.1 Navigation & routes (`src/app/`, expo-router)
- **Root** `_layout.tsx`: wraps the app in a **persisted** React Query provider
  (`PersistQueryClientProvider` + sync-localStorage persister; JSON-safe training query roots —
  `scheduled_workouts`, `progress_workouts`, `next_workout`, `block_phase`, `missed_workouts`,
  `recovery_today` — are dehydrated for 24 h so cold starts paint real content instantly) + dark
  `ThemeProvider`, loads fonts, initializes analytics + crash reporting, wires the React Query
  error→`captureApiError` funnel, **wires `focusManager` to `AppState`** (stale queries refetch on
  app foreground), routes notification taps to the right screen, and Sentry-wraps the root.
- **Tabs** `(tabs)/`: **`index`** ("Today" — Home/Schedule), **`plan`** ("Train" — hub + workout
  runner), **`progress`**, **`profile`** ("You"). All four mount at startup (`lazy: false`) so
  switches are instant and nothing mounts mid-transition; the stock bar is replaced by
  **`TempoTabBar`** (floating dock, animated active states, raised amber **GO** button →
  quick-workout; hides while the keyboard is up).
- **Data freshness (the "stale tab" fix):** tab switches are neither mounts nor window focus, so
  screens use `useRefreshOnFocus(...roots)` (`src/hooks/useRefreshOnFocus.ts`) to invalidate their
  query roots on every re-focus, and every workout-state mutation calls
  `invalidateTrainingData(queryClient)` (`src/lib/queryInvalidation.ts`). Route modals blur/refocus
  the tab beneath them, so closing a mutating modal also triggers a refresh.
- **Onboarding stack** `onboarding/`: `goal → schedule → availability → plan-preview` (now **4
  numbered steps, down from 6**). **`goal` is a single merged "Basics" screen** — a 3-card sequence
  (goal → experience → equipment) behind one header + progress bar + sub-step dots (formerly three
  separate pushed screens; `experience.tsx`/`equipment.tsx` removed, route name `goal` kept so the
  `(tabs)` gate redirect and Profile → Change Plan re-entry are unchanged). **`schedule`** sets 2–6
  days/week **and** an **auto vs. manual scheduling mode**; **connecting a calendar has moved out of
  the required path** — a first-time "Connect your calendar" Home context banner (lowest priority)
  plus Profile → Calendar (`calendar-setup.tsx`) own it now, so a new user's path to a first workout
  never touches OAuth (a user who never connects still gets auto placement from the free-slot engine).
  Then `plan-preview`
  (primed notification ask — an explainer sheet *before* the one-shot OS prompt; push-token
  registration happens here on grant, never at sign-in) `→ profile-setup` (name, avatar, and an
  **optional starting weight** that seeds the weight trend + goal countdown on day one;
  weight input respects the kg/lb display unit).
  **Change Plan re-entry is first-class:** every step pre-fills from the saved profile (current
  goal/experience/equipment preselected; days-per-week, scheduling mode, and a previously chosen
  calendar reflected; availability shows the saved sleep/work/school/off-days instead of
  defaults), the availability save **merges** the weekday off-day chips with any dated/timed
  unavailable blocks added in Settings (it used to wipe them), and `plan-preview` detects a
  re-plan (`onboarding_complete` already true): copy flips to "Your new plan is ready", the
  notification primer is skipped (permission is just re-checked), `display_name`/`avatar_url`/
  `preferred_duration_min` are never clobbered by the upsert (identity fields only seed when
  empty), training query caches are invalidated so the tabs paint the new plan immediately, and
  on success it pops the whole onboarding stack back into the app instead of re-running
  profile-setup. The **Basics screen's experience card preview** is a real "session at this level"
  card — icon chip + 3-bar intensity meter + three sample lifts with set×rep prescriptions per level
  (replacing the old gray placeholder box), and each card scrolls on small phones.
  `plan-preview` also guards double-taps with a **ref latch** (state alone can't stop two taps
  in one frame), proactively refreshes the auth session before the save chain, auto-retries once
  after a silent token refresh on JWT failures, and maps failures to actionable copy (offline vs
  session vs server — `lib/saveErrors.ts`) with Try Again / Not now actions; the availability
  step has the same silent refresh-retry. **`onboarding_complete` flips only AFTER `generatePlan`
  succeeds** (a separate update), so a mid-chain failure + force-quit can't produce an
  "onboarded" account with no plan at next launch.
- **First-time experience (framework):** a reusable, **device-local, opt-in** tutorial engine
  (`lib/tutorial.ts` state/defs + `stores/tutorial.ts` reactive layer + `components/TutorialOverlay.tsx`
  spotlight + `useTutorialTarget`/`useOnceTip` hooks). State (armed/completedSteps/skipped/first-*)
  persists to localStorage per user — steps complete offline, a failed API can't mark them done, and
  an app upgrade never resets them (a `version` retires steps without wiping progress). Tutorials are
  **armed only at the new-user moment** (`plan-preview`, non-replan), so existing users / re-planners /
  reinstalls never see them. **`welcome`** (`app/welcome.tsx`, fullScreen) is gated by `(tabs)/_layout`
  — a fresh account is routed through it before the app and **re-shown on reopen until completed**
  (force-close-proof). To avoid a double celebration, `plan-preview`'s **new-user** copy is now
  anticipatory ("Here's your plan" → *we'll build it*) and **`welcome` owns the single "your plan is
  ready" reveal**; the replan branch (no `welcome`) keeps its own "Your new plan is ready" copy. **`home_tour`** is a 5-step spotlight (calendar → today's card → GO → Progress →
  Profile) that dims the screen + cuts a hole around a measured target + floats a tooltip, without
  freezing the UI; auto-starts once on first Home focus after Welcome. (Step 2's `home.today` target
  is anchored to the stable "today" day-group, which always renders in week/day view — not just the
  hero card, which only exists when today has a workout; previously a new user whose first session
  wasn't today got no spotlight on that step.) **`first_workout`** fires
  `first_workout_started`/`first_set_logged` and the existing coach overlay; the **first completed
  session** gets a bigger `workout-complete` celebration + a "First Tempo Session" card and sets the
  durable `firstWorkoutCompleted` flag. **Profile → Replay App Tour** re-arms it (and also clears the
  `how_tempo_works` one-off tip below, via its localStorage key directly). Analytics:
  `tutorial_started`/`step_completed`/`skipped`/`completed`/`replayed` + `first_workout_*`
  (experience-tagged; platform/app_version are auto super-props). **`how-tempo-works`** (new screen,
  triggered via the lighter `shouldShowTip`/`markTipSeen` one-off mechanism rather than
  `HOME_TOUR_STEPS`, specifically so it doesn't restart the spotlight tour for users who'd already
  completed it) fires once for every user — new or existing — right before `home_tour`, defining the
  vocabulary the spotlight tour assumes: what a workout/split is, and the previously-conflated
  distinction between Tempo **generating** a workout's exercises and Tempo **scheduling** its day/time.
  It's an **interactive, swipeable tutorial** (one concept per page — swipe or Next, progress dots,
  Back — with small inline visuals for the split + generate/schedule concepts), not the old static
  scroll of stacked cards.
- **Other screens/modals:** `sign-in`, `quick-workout`, `availability`,
  `travel-mode`, `legal` (Privacy + Terms), `workout-complete`, `welcome` (post-onboarding reveal),
  `weekly-report` (Sunday progress recap), `plan-explainer` ("why this week" periodization explanation),
  **`workout-builder`** (two modes: **create/edit** a saved workout = name + exercises → library,
  with no scheduling UI; **schedule** = opened with a `date` param from Add Workout, adds date/time +
  a Schedule action — the time is **smart-pre-filled** from the free-slot engine
  (`reschedule.suggestTimeOnDate`) with a "you're free at this time" hint, and a manually picked
  time is never overwritten), **`my-workouts`** (manage templates +
  custom exercises), **`my-splits`** (the Program/Split layer — list/activate/edit splits),
  **`split-editor`** (author a weekly split: name + 7-day weekday→workout pattern),
  **`workout-history`** (the training log — every completed session, newest first, with
  sets/volume/minutes per row), **`session-detail`** (one completed session's full set-by-set
  record + its PRs; opened from a completed card's **Details** on Home or a History row; each
  exercise links to its trend), **`exercise-library`** (browse/search the whole ~1,360-move library —
  instant ranked search + muscle-group & equipment filter chips, with **variant families collapsed**
  (barbell/dumbbell/cable versions under one expandable row, representative = shortest name on a
  relevance tie so the plainest variant leads) → the form-guide sheet; also doubles as an **add-to-
  workout picker** — every row/family carries an add-circle toggle, and a floating "Add to a
  workout" bar appears once ≥1 is picked, pushing `/workout-builder?addExerciseIds=…` pre-loaded
  with the picks. Reached from the Plan tab header (book icon, always visible) — no longer linked
  from Profile), **`exercise-progress`** (one lift's strength story: per-session best est-1RM bars,
  best-ever tiles, Δ vs a month ago; opened from PR rows on Progress/Profile/**`pr-browser`** and
  from session-detail), **`pr-browser`** (search ANY exercise, not just your 5 most recent PRs, then
  jump to its `exercise-progress` trend), **`calendar-setup`** (dedicated connect/disconnect screen
  for Google + Device Calendar, replacing the old `Alert.alert` checklist; shows a "needs
  reconnecting" banner when `googleCalendarNeedsReconnect()` is true), **`how-tempo-works`**
  (one-time — then replayable from Profile → Replay App Tour — explainer defining workout / split /
  **Tempo *generates* the exercises vs Tempo *schedules* the day & time** / adding & editing /
  calendar / equipment & goals; shown once per device via `shouldShowTip('how_tempo_works')`, right
  before the Home spotlight tour), **`edit-session`** (edit any scheduled session — incl. Tempo-generated — from
  the hub's "Edit workout" chip: add/remove/reorder exercises, pin sets/reps; only *touched*
  exercises get a pinned `exercise_config` entry so untouched plan exercises keep adaptive
  targets), **`social`** (Friends home — decluttered so the scroll is only content: requests →
  workout invites → leaderboard → activity feed → groups → friends → a Privacy row. The "loose"
  actions moved into sheets: a header **＋** opens **Add friends** (your friend-code card + search by
  name/@username/code + redeem a shared workout), a **New group / join** button opens the Groups
  sheet, and **Privacy & sharing** opens the tap-to-cycle privacy sheet (workouts/stats/activity/
  **availability**). Feed rows have a one-tap 🔥 reaction), **`friend-profile`** (privacy-gated
  @handle + member-since, **Schedule together**, badges, streak / longest /
  this-week cards, totals — workouts / sets / **volume in display unit** / favorite muscle / goal /
  this-month — recent activity + browsable workouts with "Save to My Workouts" attributed copies),
  **`shared-workout`** (share-link landing for a **workout or a whole split** — metadata chips
  (exercises/days · ~duration · equipment) + one-tap import), and **`w/[code]`** (deep-link route
  for `tempo.app/w/<code>` / `tempo://w/<code>` → shared-workout).

### 3.2 Screen responsibilities
- **Home / Schedule** (`(tabs)/index.tsx`): unified day/week/month calendar; merges plan workouts
  with live device + Google calendar events; readiness ring; a **weekly-target card** ("2 of 3
  sessions" + bar — the winnable loop for a 3×/week plan, always visible); **Add Workout** FAB
  (opens `AddWorkoutSheet` → build new / pick a saved workout / pick a starter template, scheduled
  onto the selected day via the builder); "ignore event" to free time; recovery check-in entry.
  (Redesign polish: the workout/quick/weekly-target/phase/goal cards now carry the shared
  `Elevation.e1` depth ramp instead of reading flat — style-only, no logic/layout change.)
  **Today's-context strip** (`contextItems` array in `index.tsx`): the contextual banners that used
  to stack independently — missed-workout reschedule, Google-reconnect, travel-mode, rest-day advice,
  block-phase (mesocycle position), goal-countdown ETA, weekly-report nudge (Sun/Mon), and the
  Quick Workout suggestion (`lib/quickSuggestion`) — are now priority-resolved so **at most one shows
  as a full banner** (priority order: missed → reconnect → travel → rest → block → goal → report →
  quick), with every other *currently-eligible* one demoted to a **swipeable chip** below it. Each
  banner's original eligibility gate is unchanged (this only caps how many render at once and in
  what form); the goal-countdown card and the standalone "Add a workout" row (redundant with the FAB)
  were removed as separate rows. Today's workout flips to a
  gentle **overdue "still on for this?"** state an hour past its start (ember treatment +
  Reschedule / Skip); a **past-day row whose status flipped to `'missed'`** now gets its own
  distinct treatment too (red **MISSED** badge/dumbbell tint, a dedicated note, and a red calendar
  dot via `renderDayCell`'s new `dotMissed` variant) — previously a missed row rendered
  indistinguishably from any other scheduled workout once you weren't looking at *today*. A workout
  a calendar event now overlaps shows a **proactive "move it?"**
  one-tap reschedule (the felt-intelligent case in manual mode, where times aren't auto-moved),
  and a completed card gets a **Details** action into `session-detail`. On open, Home also runs
  **plan rollover** (`extendActivePlan` + re-place times), the split horizon refresh, conflict
  resolution, and a **14-day reminder reconciliation sweep** (newly materialized or auto-moved
  sessions always carry a correct 30-min reminder; never prompts for permission). `checkMissedWorkouts`
  itself only ran on cold-start/sign-in (`stores/auth.ts` deliberately skips it on `TOKEN_REFRESHED`,
  which fires on every foreground) — so a workout that went stale while the app just sat
  backgrounded across midnight was never flipped until the next cold start. A lightweight `AppState`
  listener now re-runs just that cheap check (not the whole entry sweep) whenever the app foregrounds
  on a new calendar day. A "Google Calendar needs reconnecting" banner (see §5) can also appear here.
- **Workout runner** (`(tabs)/plan.tsx`): a **hub** and a **live session** in one tab.
  Tapping the tab (no `workoutId` param) lands on the **hub**. **Training redesign:** the hub is now a
  four-way **segmented control** (`components/TrainSegments.tsx`) — kept strictly to Training (no
  Progress analytics, no Calendar scheduling): **Session** (default — today's session preview: focus,
  exercise list, **Start session**), **Readiness** (a workout-focused card — readiness score +
  recommended intensity Easy/Moderate/Hard + per-muscle recovery for chest/back/legs/shoulders/arms +
  a recommended focus, from `fitnessInsights.readinessFromHistory`/`intensityFromReadiness`/
  `muscleRecovery` over `useProgressStats`), **Splits** (the user's `fetchSplits` list as premium
  cards → `my-splits`), **Workouts** (the user's `fetchTemplates` list + search → `my-workouts`).
  Quick Workout / History / Library stay as a secondary link row under any segment. The hub renders
  **even on a rest day / when nothing is scheduled** (the Session segment shows an empty state while
  Readiness/Splits/Workouts stay usable — the old separate "nothing scheduled" screen is gone).
  **Discarding** an unstarted session now **fully cancels** it — drops it from the plan (status
  `rescheduled`, so it's ignored by the streak + never re-synced) **and** removes its synced calendar
  event (best-effort, `removeWorkoutFromCalendar`) so no ghost workout lingers. The **finish screen**
  (`workout-complete.tsx`) uses the `Elevation` depth ramp. The **live
  session runner is deliberately untouched** — every hub change is inside the `!sessionActive` branch,
  and Splits/Workouts actions route to the existing screens (single source of truth). Hub/loading/empty headers carry only the wordmark + avatar — no back
  button (it's a tab, not a pushed screen); only the live session keeps its chevron-down
  leave-to-hub control. You only enter the live logger deliberately (hub button, or an
  explicit start from Home / Quick Workout which pass a `workoutId`), and the `workout_logs` row +
  timer are created **on start, not on view** — so browsing the hub never spawns a phantom session.
  **Load lifecycle:** the hub reloads on every tab focus (never mid-session; in-flight +
  15s-freshness guards), so completions, new plans, and date changes are always reflected; a
  passed `workoutId` param is **consumed** via `setParams` after starting, so re-starting the same
  workout re-triggers cleanly, and finishing resets the tab behind the summary so returning shows
  a fresh hub.
  The live session builds per-exercise **prescriptions** (autoregulation + periodization + readiness
  + feedback bias), pre-fills sets, smart exercise swaps, form guide +
  exercise GIFs, and a **first-time hint** (start light + warm up) on never-trained lifts.
  **Set logging is instant:** tapping ✓ logs the set immediately (light haptic, rest timer
  auto-starts at the workout's effective rest); **RPE is an optional post-log follow-up bar**
  that updates the `set_logs` row — it never gates logging or the timer. Each set row has a
  **trash icon** (confirm → local removal + server-side `set_logs` delete + renumbering of later
  sets). A **"+ Add Exercise"** button mid-session opens the picker then an explicit **"this
  session only vs. permanently"** choice (permanent = scheduled row + the owning split day).
  The header's labeled **Pause** control opens a sheet — **Resume later** (progress saved; open
  log resumes from hub/restart) or **End workout** (finishes, or discards a zero-set session
  including its log row). Exercise completion plays a medium haptic and **auto-expands the next
  incomplete exercise**. The hub carries an **Edit workout** chip → `edit-session` modal.
  **Gym reality (July 2026):** every exercise has a **⋯ menu** — Swap (equipment-aware),
  **Move to end** (machine occupied — come back later), **Move up/down** (reorder mid-workout,
  persisted to the scheduled row's `exercise_ids`), and **Skip for today** (removes from the
  session + its logged sets, keeps it in the plan). **Warm-up sets** (`set_logs.is_warmup`):
  "+ Warm-up" inserts a W-tagged set before the first unlogged set; warm-ups render as `W` /
  "warm-up" and are **excluded from PREV, progression, and every volume/PR aggregation** (prs,
  useProgressStats, wrapped, weeklyReport, exercise-progress, session-detail, workout-history,
  friend overview) — completion treats a warm-up-only session as empty. A **session-note FAB**
  writes `workout_logs.notes` ("bench felt heavy today"), loaded on resume and shown in
  session-detail. A **one-time first-session coach overlay** (localStorage-gated) explains
  logging / rest / the ⋯ menu / pause. **PERF:** the PREV/prescription history query is bounded
  (`.limit`) + warm-up-filtered instead of scanning all-time `set_logs`.
  **Honest time estimates** (`lib/durationEstimate`): hub + header use a realistic static
  estimate (prescribed rests + per-exercise setup/transition time) scaled by a **historical pace
  factor** (median actual/planned over recent sessions), and once sets land the header shows an
  **adaptive "~N min left"** blending observed pace with the static per-set cost.
  **Gym-proofing:** the session timer and rest timer are **wall-clock-based** (locking the phone
  never freezes them), the rest timer finishes with a **vibration + a scheduled OS notification**
  (covers a locked phone) instead of an Alert, the screen stays awake during a live session
  (`expo-keep-awake`), and an **open log left behind by a killed app is adopted and its sets
  rehydrated** (stale ones are zero-length-closed) so no duplicate `workout_logs` rows are ever
  minted. **Complete Workout has guardrails**: a 0-set completion is blocked and a <50%-logged one
  asks first — an accidental tap can't mint a fake session into streak/consistency/adaptation.
  **Offline honesty:** starting a session verifies the `workout_logs` row actually inserted
  (otherwise an alert + stay on the hub — never a session where nothing can save); a set whose
  `set_logs` insert fails is visibly un-checked (one "didn't save" alert per session, the
  unchecked ✓ tells the rest — and the un-check is a no-op if the exercise was swapped out while
  the insert was in flight, instead of crashing on the missing row); and Complete only celebrates
  after the completion writes verify — a failed save keeps the session live with a "tap Complete
  again" alert instead of showing confetti over an unsaved workout. All three failure alerts
  classify the error through `saveErrors.describeSaveError`, so an expired session in the gym
  isn't mislabeled "check your connection". The rest-length picker is a branded `OptionSheet`
  (60/90s/**2min suggested**/3min/**custom stepper**) rather than an Alert (Android caps alerts at
  3 buttons); the pick **persists as that workout's rest** (`lib/restPrefs`, SQLite localStorage)
  and drives the auto-started rest after every set.
  On finish updates logs, fires adaptation re-eval, and routes to the celebration screen. When
  nothing is scheduled the hub shows the Quick Workout empty state (never a dead end); hub links
  include **History** (`workout-history`).
- **Celebration** (`workout-complete.tsx`): momentum lead (trained-despite-missing / volume vs last
  week / streak), aggressive **PR highlights**, streak/consistency spike, difficulty check-in, share.
- **Weekly Report** (`weekly-report.tsx`): the "am I improving?" recap — workouts vs last week,
  volume %Δ, estimated strength gains, weight trend, consistency, new PRs; shareable.
- **Plan Explainer** (`plan-explainer.tsx`): explains the current mesocycle phase (volume/intensity/
  recovery dials) and when the next deload lands; opened by tapping the Home phase banner.
- **Home** also surfaces a **goal countdown** ("12 weeks to lose 10 lbs"), a rich next-workout empty
  state (never a blank calendar) — which shows an actionable **Start now** only when the next session
  is today, otherwise a **locked "Scheduled for <day>"** state plus an "add a workout today" link —
  and a Sun/Mon weekly-report entry.
- **Layout:** screens with a fixed bottom CTA give their `ScrollView` `flex: 1` (so it scrolls
  instead of pushing the footer off-screen) and pad the footer by the bottom safe-area inset on
  edges-`top` modals — so action buttons are always reachable on every device.
  **Every bottom sheet pads its bottom by `max(safe-area inset, spacing)`** (profile modals,
  Edit/Add-workout, time picker, form guide, share sheet, option sheet, custom-exercise sheet)
  so actions clear the home indicator; input-bearing sheets (body log, edit profile, custom
  exercise, split day editor) wrap in `KeyboardAvoidingView`, and input-bearing screens
  (travel mode's label field, availability, profile-setup, workout builder) use keyboard insets
  so the keyboard never covers a field or its Save button. Long option lists inside sheets
  (equipment, injuries) scroll within a capped height so Save stays reachable on small phones.
- **Progress** (`(tabs)/progress.tsx`): the **Fitness Intelligence dashboard** — restructured into
  labelled sections (Hero → Momentum → Consistency → Coaching → Trends → Records → Journey) that lead
  with a *decision*, not a raw number. **All prior cards are kept** (consistency ring, streak, next
  milestone, completion rate, Pro-gated volume chart, weight trend, PRs, share cards, empty/error/
  loading). Added on top (from `lib/fitnessInsights` + `components/ProgressCards`): a **Tempo Score
  hero** with "why" bars, **Readiness** (history-based, works with no health hardware), **Momentum**,
  a weekly **consistency predictor**, a GitHub-style **consistency heatmap**, a **Weekly Review** card
  (opens the full `weekly-report`), a 3-day **workout forecast**, **Tempo Insights** (optimal-window +
  behavioural patterns + muscle-balance nudge), a **training-frequency** graph (1M–1Y range), a
  **muscle-balance** radar (`react-native-svg`), a **strength-progress** top-movers list (→
  `exercise-progress`), and a **journey timeline**. Data comes from `useProgressStats` (extended
  additively to also expose `logTimes` + `muscleSets` + `strengthSets` from its existing set-log query
  — no new fetches). Profile no longer duplicates any of the performance cards (see below).
- **Profile** (`(tabs)/profile.tsx`): identity + config surface. The **level/XP hero** now also shows
  a **Pro badge** (gold, when `useProAccess().isPro`), a **streak chip**, and **member-since**. Below
  it (`components/ProfileCards.tsx`): a **Fitness Identity card** (goal · frequency · session length ·
  equipment · active split, as chips — from `profile` + `fetchActiveSplit`) and a **Tempo Insights
  grid** (WHOOP/Oura-style stat tiles: workouts, streak, consistency, PRs, volume, readiness — from
  `useProgressStats` + `readinessFromHistory`; no new fetches beyond the split). Hero uses
  `Elevation.e2`, cards `e1`. This surfaces stats *on Profile as identity*, distinct from Progress's
  analytics dashboard. Profile keeps **Body
  Stats** (weight + body-fat + waist trends, progress-photo capture — the only place to *log* a
  measurement; "View trend" links to Progress), saved exercise swaps, a
  **"Right Now"** section (temporary/personal adjustments — **travel mode + injuries**, surfaced at
  the top of settings rather than buried in the plan), **My Plan** (workouts/splits/history/library +
  goal/experience/days/equipment/Change Plan), settings (availability, calendar — connect **and
  disconnect** Google/device, **notifications
  toggle**, legal), edit profile, sign out, account deletion.
- **Quick Workout** (`quick-workout.tsx`): pick minutes + focus → generated session with a "why" and
  "why it counts"; one tap to start.
- **Availability / Travel** modals: set work/school/sleep/unavailable windows, and a temporary
  travel-equipment override.
- **Scheduling mode:** a `scheduling_mode` profile pref (`auto` default / `manual`) decides whether
  Tempo places & re-slots workout *times* on its own. **Connecting a calendar does not force auto** —
  it's chosen in onboarding (schedule step) and toggled in Profile → Settings → **Automatic
  Scheduling**. In `manual` mode `autoScheduleUpcoming`/`resolveCalendarConflicts` self-guard and
  no-op (the calendar is still read for busy times / event sync); the user owns the times.
- **Calendar sync:** in auto mode scheduling is automatic (placed around the calendar at plan/split
  creation + conflict auto-resolve on app open). Connecting a calendar (Profile → Calendar →
  **`calendar-setup`** — a dedicated screen now, replacing the old `Alert.alert` checklist for
  connect + a second `Alert.alert` for disconnect; Google inline OAuth or device) is for reading
  busy times / scheduling around real life — it does **not**
  start writing to the calendar. **"Add workouts to my calendar" is opt-IN (default OFF)**, a separate
  Settings toggle independent of scheduling mode: `lib/calendarAutoSync.autoSyncEnabled` treats only an
  explicit `true` as on. Turning it **on** (with a calendar connected) runs `syncUpcomingWorkouts`
  (adds upcoming, not-yet-synced workouts on app open + after scheduling); turning it **off** runs
  `purgeSyncedWorkouts`, which deletes every Tempo-added event so the calendar returns exactly to how
  it was. (The old manual "Smart Schedule My Week" screen was removed.) A **"Remove all Tempo events"**
  Settings action (`calendarAutoSync.removeAllTempoEvents`) goes further — beyond the events Tempo still
  tracks, it sweeps each connected calendar by Tempo's title (`Tempo · …`/`Tempo: …`) and color across
  ±18 months (`deleteTempoGoogleEvents` / `deleteTempoDeviceEvents`) to clear **orphans** left by
  reinstalls or manual edits, then clears any lingering DB pointers. Non-Google accounts (Apple/email)
  attach Google Calendar via `linkIdentity`, which needs **Supabase "manual linking" enabled**; when it
  isn't, connect fails cleanly as `link_unavailable` (→ "use the device calendar") instead of leaking
  the raw backend error. When the Google identity is already ANOTHER Tempo account's login (user
  signed in with Google once, now on an Apple/guest account), the redirect carries
  `identity_already_exists` — surfaced as **`identity_taken`** with copy telling them to sign back
  in with Google or use the Device Calendar (calendar-setup.tsx — the post-onboarding connect
  surface; calendar connection is no longer part of the onboarding `schedule` step).
  **Fixed bug:** when Google's refresh token is revoked/expired, the token edge function correctly
  deletes the stored row and returns `409 reconnect_required` — but `getGoogleAccessToken()` used to
  discard that signal and every caller (`calendarSync.getCalendarEventsForRange` in particular)
  swallows fetch failures to `[]` so the feed never breaks — net effect, Google events silently
  vanished forever with zero indication why ("used to work, now nothing shows" — likely because the
  OAuth consent screen is still in Google's "Testing" publish status, which auto-expires refresh
  tokens after 7 days; that's a Google Cloud Console setting, not something fixable from the repo).
  `CalendarAuthService` now exposes `googleCalendarNeedsReconnect()`, set whenever that specific
  reason is detected; Home shows a "Google Calendar needs reconnecting" banner (tap → calendar-setup)
  and calendar-setup shows the same banner inline.
- **workout-complete**: streak/consistency spike, difficulty check-in (feeds adaptation), Wrapped
  share cards.

### 3.3 Components (`src/components/`, ~27)
**`TempoSheet`** — the shared bottom sheet every other sheet in this list is built on. Built on
React Native's own **`<Modal>`** (`animationType="slide"`, transparent, bottom-anchored), NOT a
third-party sheet lib. Takes `visible`/`onClose`/`scroll`/`snapPoints`/`style`; `snapPoints[0]` sets
a fixed sheet HEIGHT (e.g. `['92%']`), omit it and the sheet sizes to content capped at 90%.
`scroll` wraps children in a `ScrollView` (flex-fill when a fixed height is given, else `flexShrink`
so it hugs short content but scrolls when tall). Backdrop tap and the handle both dismiss.
`KeyboardAvoidingView` keeps inputs above the keyboard (the old body-measurement keyboard-covers-Save
bug).
  - **Why RN `<Modal>`, not `@gorhom/bottom-sheet` (do not regress):** it *was* briefly gorhom, but
    on this stack (RN 0.85 / React 19 / new architecture) gorhom's imperative `present()` rendered
    **nothing** in release builds — no sheet, no backdrop — so every sheet-opening button (Edit
    Profile, Log Weight, Sign Out, every OptionSheet, the pickers) appeared dead while handlers,
    state, scrolling and navigation all worked. RN `<Modal>` presents in its own native window: it
    can't silently no-op, needs no provider/reanimated/gesture-handler, and renders **above**
    `presentation:'modal'` screens (so sheets opened from workout-builder/edit-session/etc. work too).
    Pure-JS → ships via `eas update`, no native rebuild. The only gorhom left is an unused
    `BottomSheetModalProvider` at the app root (harmless; can be removed later).
`EditWorkoutSheet`, `ExerciseFormSheet`, `ExerciseMedia`, `RecoveryCheckIn`, `ShareCardSheet`,
**`SaveProgressSheet`** (the single guest → permanent-account upgrade surface, §1.1 — Apple/Google
buttons over `lib/accountLinking`, shared by the Profile card and the post-3rd-workout modal;
account-protection wording, never a hard gate),
`WrappedCard`, `TimePickerSheet`, `LoadingCard` (shimmer skeleton), `ErrorBanner`,
**`CustomExerciseSheet`** (create/edit a custom exercise), **`ExercisePickerSheet`** (search library +
custom, add to a workout — the fast in-context picker used by `split-editor`/`edit-session`; the
main workout-builder flow now opens `exercise-library` directly instead, for its richer equipment
filter), **`AddWorkoutSheet`** (calendar "add a workout": build new / saved
workout / starter template → builder), **`OptionSheet`** (the branded bottom-sheet option picker —
replaces every multi-option `Alert.alert` menu, which Android caps at 3 buttons; items take a
`destructive` flag that renders red — the affordance Alert's `style:'destructive'` gave Delete
rows; used for starter
workout/split presets, "use a saved workout", template actions in My Workouts, split actions in
My Splits, and the runner's rest-length picker; the remaining confirm/picker stragglers were
migrated onto it too — Profile's Change-Plan + "remove all Tempo events", Home's remove-from-calendar,
and the runner's skip-exercise + swap-exercise picker, the last of which had silently dropped its
4th+ substitute past Android's 3-button alert cap), **`Avatar`** (the shared profile picture — chosen
icon+colour, or now a real uploaded photo, read from the auth store; used in every header so none
fall back to a default icon — `lib/avatar.uploadAvatar()` picks + uploads to the new public
`avatars` Storage bucket, `supabase/add_avatar_storage.sql`, RLS-scoped to `<user_id>/…`, and writes
the resulting public URL straight into the existing `user_profiles.avatar_url` column, which
`parseAvatar()` already rendered as an image for any `http(s)` value — no schema change needed),
themed primitives, plus a `ui/` set. **Brand & delight set (all dependency-free, Reduce-Motion
aware):**
- **`motion`** — `PressableScale`, `FadeInView`, `PopIn`, `Shimmer`, `ScreenTransition`,
  `useReducedMotion`, `useScreenFocused`. Entrances run on plain JS `Animated` and follow one hard
  rule: **content can never get stuck invisible** — components render at rest (visible), dip to
  the hidden pose only in the tick the animation starts, and play on first screen *focus* (screens
  mount unfocused under `lazy: false`). Reanimated `entering` animations were removed — they could
  silently skip on new-arch mid-transition mounts, which was the root cause of the "blank until
  revisit" bug. Even started native-driver animations proved able to die silently (clipped list
  rows on a cold start froze the Home week feed's event rows invisible/half-faded), so every
  entrance also arms a **JS failsafe deadline** that force-snaps values to rest just after the
  animation should have ended — a dead animation now costs the animation, never the content. `PressableScale` is a full TouchableOpacity drop-in (the Pressable itself is the
  animated, styled element, so flex/absolute layout applies to the real touch target; all
  Pressable props pass through) and is used on every primary button, option card, day cell,
  segment, chip, and RPE/set control across Home, Train, Progress, workout-complete, and
  onboarding. `ScreenTransition` wraps each tab screen's content and plays a soft rise+fade every
  time the tab regains focus — the cross-tab transition, owned by the screen instead of the
  navigator so an interrupted switch can never strand a scene hidden.
- **`brand`** — `TempoWordmark` (the runner/clock **glyph mark** — `assets/images/tempo-glyph.png`
  tinted with the primary — then the lowercase wordmark + a metronome dot that double-beats on focus;
  pass `mark={false}` to drop the glyph, e.g. under the sign-in hero logo). `TempoPulse` (the 4-bar
  rhythm mark; loading + celebration accents), `PulseLoader`, `ScreenHeader` (masthead + primary
  tick/hairline rule). The glyph now rides in every masthead (all tabs + onboarding steps) and a
  brand footer on Profile, so the actual logo — not just the wordmark text — carries the brand.
  **`ScreenHeader` is now the one shared masthead across every screen** — the 4 root tabs, the live
  workout runner, and all ~21 secondary/modal screens. Props: `title` (omit → wordmark leads),
  `subtitle`, `right` (trailing action(s)), `leading` (dismiss/back affordance — presence flips the
  header to a balanced, centered layout with the title/wordmark between the two sides; when the sides
  differ in width, e.g. the runner's Pause vs avatar, the masthead is optically- not pixel-centered),
  `rule` (the amber tick + hairline, default `true`), and `size` (`'md'` = 24px root tabs, `'sm'` =
  18px + no pulse for the runner and modals). Two siblings ride alongside it: **`DismissButton`**
  (`kind` `'chevron'` | `'x'` | `'back'` — the single source for every modal/pushed-screen dismiss
  affordance, replacing the ~21 hand-rolled copies) and **`HeaderActions`** (a gap'd row wrapper so
  `right` can hold several actions, e.g. Home's readiness ring + avatar). Avatars stay per-screen
  (Home renders a photo via `parseAvatar`/`expo-image`; the runner a glyph) rather than being pulled
  into the primitives file.
- **`AnimatedRing`** — SVG-free circular progress that animates every value change (two clipped
  half-circle fills on one Animated value). Used by Home's weekly target and workout-complete's
  weekly ring. **`SvgProgressRing`** is the real-SVG sibling (gradient stroke-dashoffset, on
  `react-native-svg`) used specifically by Progress's Consistency Score, where a gradient stroke
  reads closer to the Apple-Fitness/WHOOP reference than a flat fill — additive, not a replacement,
  so Home/workout-complete are untouched. **`SvgLineChart`** — small line+area chart (fixed viewBox +
  `preserveAspectRatio="none"` so it fills its container without measuring), first used for
  Progress's weight trend. **`SvgGrowBar`** — the volume chart's gradient-filled, animated bar
  (same viewBox trick, normalized 0–100 width so it fills whatever a flex column gives it); also
  now backs **Exercise Progress's** per-session est-1RM bars, so that recap screen's chart matches
  the Progress tab instead of using a one-off flat-color bar.
- **`celebration`** — `ConfettiBurst` (one-shot, tasteful, auto-unmounts) + `CountUp` (stats tick
  up to their value; lands on the final number even if interrupted).
- **`ProgressCards`** — the Fitness Intelligence dashboard cards (`TempoScoreHero`, `ReadinessCard`,
  `MomentumCard`, `PredictorCard`, `ConsistencyHeatmap`, `ForecastStrip`, `InsightsCard`,
  `JourneyTimeline`, `SectionLabel`). Pure presentational — fed pre-computed `lib/fitnessInsights`
  outputs by the Progress screen; reuse `SvgProgressRing`/`CountUp`/`FadeInView`/`PressableScale` and
  the new `glass`/`Elevation`/`metricHero` tokens so they match the rest of the app.
- **`HeroGlow`** — a reusable soft accent blob (a large low-opacity `*Glow`-colored circle) placed
  behind a single hero ring/metric per screen for premium depth without a native blur module. Static,
  Reduce-Motion-safe. Used by the Progress Readiness ring; reusable on Today/Profile heroes.
- **`EmptyState`** — illustrated empty states (geometric View-built art: calendar/barbell/chart/
  moon/flash + floating brand sparks) with title/body/CTA. Used app-wide — the three tabs **plus**
  Workout History, Weekly Report, Plan Explainer, Exercise Progress, and My Splits — so every
  full-screen empty moment is illustrated + on-brand rather than a line of grey text. (Tight
  *section* empties inside a populated screen, e.g. My Workouts' per-section lists, stay as text —
  a full illustration per section would overwhelm.)
- **`TempoTabBar`** — the floating dock (see 3.1).

### 3.3a Motion & celebration pass
Cross-tab feel = the dock (icon pop + primary tick spring on select) + each screen's
`ScreenTransition` focus entrance — scene-level `shift` animation stays removed for reliability.
Root-stack pushes default to a native `slide_from_right` (modals keep their slide-up; sign-in →
tabs fades). Day/Week/Month calendar crossfade (keyed `FadeInView`),
staggered feed/hub entrances, `PressableScale` on primary actions. **Session runner:** progress bar
eases forward per logged set (`AnimatedFill`), set checks `PopIn`, per-exercise "Done" chip, rest
pill pops in with a draining time bar, Complete button flips success-green when every set is banked.
**workout-complete:** confetti burst (bigger with PRs), badge pop, `CountUp` streak/consistency/
duration, weekly-target `AnimatedRing`. **Progress:** ring sweep + count-ups, chart bars grow in
staggered. (The old "Achievement unlocked" confetti toast was removed when achievements merged into
badges — the "new badge" signal is now the unviewed-count on the Profile badges button.)
**Onboarding plan-preview:** staggered reveal + a narrated `TempoPulse` build sequence.
**Branded loading, everywhere:** full-screen and section loads render Tempo's `PulseLoader`/`TempoPulse`
metronome mark (with a contextual caption — "Loading your splits…", "Building your session…") instead
of a generic OS `ActivityIndicator` — Home/feed loads use `LoadingCard` shimmer skeletons, and the
feed shows the skeleton (not a rest-day/empty state) whenever the visible range has no items but a
fetch is in flight — e.g. right after Change Plan clears the old schedule. The stock
spinner is now reserved only for tight in-button saving states. All motion honors OS Reduce Motion.

### 3.2a0 Program / Split layer (the user's overall schedule)
- A **split** (`splits` table) is the user's weekly training schedule — Push Pull Legs,
  Upper/Lower, a custom split. It's a 7-day weekday→workout pattern; each non-rest day carries
  a self-contained workout (`exercise_ids` + per-exercise `config`, snapshotted from a saved
  template or assembled inline) so it survives template edits/deletes. **One split is active
  at a time** (partial-unique index).
- **Every user has a split, even on an auto plan.** Generating a plan mirrors it into a
  `kind='auto'` split (`ensureAutoSplit`) so it shows up in My Splits with a **PROGRAM** badge and
  can be toggled like any custom split. A user who then builds their own has two entries and flips
  between them; **exactly one schedule drives the calendar**. Activating a **custom** split retires
  the plan and materializes the split; activating the **program** mirror (`activateAutoPlan`)
  *regenerates* the periodized plan from the current profile (schedule + equipment + injuries),
  preserving the mesocycle rather than laying down a static copy.
- `lib/splits.ts` — CRUD + active-split management (`setActiveSplit`, `dayToDraftItems`, day
  builders, `ensureAutoSplit`). `lib/splitSchedule.ts` — **`activateSplit`** (retires the generated
  plan's + other splits' today-forward scheduled sessions through `retireWorkouts.
  sweepScheduledPlanRows`, the same FK-safe sweep the plan generator uses — synced calendar events
  and reminders are cleaned up, log-referenced rows are marked instead of deleted; then marks
  active, materializes, and in auto mode calls `autoScheduleUpcoming`. Returns
  `'activated' | 'activated_pending' | 'failed'`: once the split is active, a materialize failure
  (offline mid-chain) is **'activated_pending'** — the callers say "sessions appear next time
  you open the app online" instead of a false "try again", and `refreshActiveSplit` lays them
  down on the next app open), **`activateAutoPlan`** (regenerate the program mirror), and
  **`materializeSplit`/`refreshActiveSplit`** — the split analogue of `generatePlan`'s insert loop:
  lays the weekly pattern onto the calendar as ordinary `scheduled_workouts` rows (`source='split'`,
  `split_id` set) over a rolling 28-day horizon, idempotent so app-open can extend the window.
  Everything downstream (feed, runner, auto-scheduling, calendar sync, missed sweep) works
  unchanged — split workouts are commitments, so the missed sweep includes them.
- Entry points: **Profile → My Plan → My Splits** and **My Workouts → My Splits** → `my-splits`
  (list/activate) → `split-editor` (author). Generating a plan (Change Plan) deactivates any
  active custom split so the two never compete.
- **Split editor reliability + UX (July 2026 overhaul):** the "Use a saved workout" picker is
  rendered **inside** the day-editor `Modal` (as a sibling Modal it silently never presented on
  iOS and could strand an invisible touch-eating backdrop — the "editor freezes" bug); saved
  workouts are **prefetched on mount + refreshed on focus** so a just-saved workout is instantly
  assignable; whole-week hydration is **one batched exercises query** (`daysToDraftItems`)
  instead of 7 sequential round-trips; day cards show exercise count + estimated duration +
  rest/assigned badges with LayoutAnimation. **Create-workout round-trip:** an empty day offers
  "Saved workout" / "New workout"; the latter hops to `workout-builder?forSplit=1`, which hands
  the saved template id back through **`lib/handoff.ts`** (single-slot, consumed-on-read mailbox);
  the split editor's focus effect assigns it to the pending day and reopens the day editor — the
  user never hunts for the workout they just built.

### 3.2a User-created workouts & custom exercises
- **Custom exercises** live in the shared `exercises` table (`user_id` + `is_custom`), so they work
  everywhere built-ins do — building, scheduling, logging, PRs, progress. RLS: built-ins
  (`user_id IS NULL`) public; custom rows owner-only. `lib/customExercises.ts` (CRUD + unified search
  + `metricsFor`). **`metricsFor`** picks the logged columns: cardio → duration+distance, mobility →
  duration, **pure-bodyweight strength moves → reps only (no pounds — bodyweight has no external
  load), isometric holds (plank/wall-sit/hang/lever) → seconds**, everything else → weight+reps.
- **Workout builder** (`lib/workoutBuilder.ts`): assemble exercises with per-exercise
  sets/reps/weight/duration/distance → save a reusable **`workout_templates`** row and/or schedule it
  as a `scheduled_workouts` row (`source='custom'`, prescription in `exercise_config`). Custom
  scheduled workouts render in the calendar feed; the runner honors their config and shows
  metric-aware set columns (incl. duration/distance, logged into `set_logs.duration_sec/distance_m`).
- Entry points: Home "Build a workout" row + Profile → "My Workouts".

### 3.4 Hooks / services / constants / store
- **Hooks:** `useProgressStats` (aggregates stats/PRs), **`useRefreshOnFocus`** (invalidate a
  screen's query roots on every tab re-focus — skips the first focus; reads keys through a ref so
  fresh literals don't re-arm the effect), color-scheme/theme hooks.
- **Services:** `calendarService` (device calendar), `calendarSync` (write workouts to a calendar),
  `googleCalendar/` (OAuth + Calendar API + config).
- **Constants:** `theme.ts` — **one design language, two modes** (the old Classic/Craft fork is
  gone). `inkDark` (default: cool near-black ink surfaces, the **electric-blue** brand primary
  `#4E8BFF`, ember secondary accent for attention/heat, **`gold`/`goldSoft`** for records) and
  `paperLight` (warm near-white + deep electric blue `#0058BC`), exported as `Palettes` + the
  `Palette` type. Identity lives in the components/motion, not a paint swap.
  Every palette carries `fontDisplay`/`fontDisplayBold`/`fontNumeric` tokens (**Bricolage
  Grotesque** display + **JetBrains Mono** numerals). **JetBrains Mono is now reserved for the live
  runner instrument** (countdown timer + set/weight/reps columns, where tabular alignment matters);
  every stat card, tile, ring and duration (profile, progress, home, quick-workout, reports,
  celebration) uses the Bricolage display face, so numbers read as one consistent, premium voice
  rather than a "code-y" mono. A shared **`Motion`** export (fast/base/slow durations + spring)
  keeps the whole app on one clock. `BottomTabInset` reflects the floating dock (96).
  **Redesign foundation (additive — no existing token changed):** every palette also carries
  `glass`/`glassBorder`/`glassHighlight`/`scrim` (premium depth), `chartGrid`/`chartAxis`/`chartLabel`
  (Progress charts), and `warning`/`readyHigh`/`readyMed`/`readyLow` (forecast/readiness good·caution·
  risk). `Typography.metricHero` (64px) for the single biggest number; `Radius` gains semantic
  `chip`/`card`/`sheet`/`pill`; `Motion` gains `micro`/`celebrate`/`stagger`; a new `Elevation` ramp
  (e0–e3) sits alongside the kept `CardShadow`; and soft `primaryGlow`/`emberGlow`/`goldGlow` for the
  new `HeroGlow` component. **Confirmed visual direction = "Enriched-Calm"** — calm calendar-first
  base + disciplined functional accents (blue dominant, ember=energy/streaks, gold=records/milestones)
  + depth + one soft glow per screen; no wall-to-wall gradients, stock photos, or tactical copy. The
  design strategy + direction review live in `DESIGN_STRATEGY.md`; execution plan in `~/.claude/plans/`.
- **Theme engine:** `src/theme/` — a Zustand store (`useThemeStore`, persisted to the SQLite-backed
  `localStorage`, **default dark**) drives live dark/light switching. Screens read colors via
  `useTheme()` and build styles with `useThemedStyles(makeStyles)` so a mode change re-renders the
  whole app; `ThemeTransitionOverlay` (mounted in the root layout) crossfades the switch. The
  toggle lives in **Profile → Settings → Appearance**; the root layout's nav theme + status bar
  follow the active mode. (`useDesignMode`/`DesignPalettes` were removed with the design fork;
  the brand signature — lowercase `tempo` wordmark with pulsing dot, primary tick + hairline rule —
  now ships unconditionally via `components/brand`.)
- **Store:** `stores/auth.ts` (session, profile, sign-out; on auth change it identifies the user to
  analytics/crash, registers the push token, sweeps missed workouts, and refreshes adaptation).
  **Profile fetches distinguish "no row" from "couldn't ask"**: a failed fetch (offline blip,
  token refresh race) keeps the current in-memory profile instead of nulling it — nulling used to
  bounce an onboarded user back into onboarding mid-session — and the last-known-good profile is
  cached per user in localStorage (`tempo.profile.<uid>`), so an **offline cold start** still
  renders the tabs (the layout gate needs `onboarding_complete`) with the persisted query cache.
  `TOKEN_REFRESHED` events (fired on every app foreground by the AppState-driven autoRefresh)
  **skip the profile re-fetch** when a profile is already held; the `user_signup` vs `login`
  analytics split keys on a *confirmed* missing row (`res.ok && !profile`), never on a failed
  fetch — a returning user on a fresh install with a network blip is a login, not a signup.
- **`stores/entitlements.ts`** (Tempo Pro, §10) — two facts: `proEnabled` (the dormant remote flag)
  and `isPro` (the RevenueCat entitlement). A feature is `locked` only when `proEnabled && !isPro`,
  so while dormant nothing is gated. `useProAccess()` exposes the state; `useProGate()` wraps a
  paid feature *action* — `requirePro(context)` returns true (proceed) when unlocked, else routes to
  the custom paywall (`/paywall?context=…`) and returns false. Loaded/synced in `_layout.tsx` on
  each session change; a live RevenueCat listener fires `trial_started` / `trial_converted` /
  `subscription_cancelled` on entitlement transitions. The declarative layer is
  **`components/ProGate`** — `<ProGate feature>` renders children when unlocked (or dormant) and a
  branded `ProLockCard` (icon + benefit + "Unlock with Pro" → paywall) when locked, plus `ProBadge`.
  **First live gate:** the Progress tab's **Advanced Analytics** — the volume-trends card is wrapped
  in `<ProGate feature="advanced_analytics">` and the strength-trend deep-dives (PR-browser +
  per-lift `exercise-progress`) route through `requirePro`; free keeps the consistency ring, streak,
  next milestone, completion rate, recent-PR list, and weight trend. **The custom paywall**
  (`app/paywall.tsx`) reads the live offering (dynamic prices, auto-computed annual savings %,
  free-trial CTA when configured), Restore, and Terms/Privacy (→ `/legal`); dormant-safe and
  StoreKit-compliant. **Redesign:** value-prop hero (glow) → `PAYWALL_POINTS` feature cards → a
  **Free-vs-Pro comparison table** (kept honest to the real gating in `proFeatures.ts`) → the live
  plan cards + trial note → a "less than a coffee a week" value line → **trust indicators** (Secure ·
  Private · No ads · Cancel anytime). No fake testimonials (deliberately — real ones can be dropped
  in later). All purchase/restore/offering logic unchanged. Everything ships DORMANT — flip
  `app_config.pro_enabled` (or allow-list a uid) to go live with no rebuild. On Profile, the Pro
  upgrade/manage rows now live in their own **Subscription** section (shown only while Pro is live).

### 3.5 Domain logic (`src/lib/`, ~36 modules)
- **Planning & progression:** `generatePlan` (4-week periodized plan from goal/experience/equipment;
  **respects hard constraints** — never-train weekdays from unavailable blocks + `training_days`,
  and **injuries** via the same restriction mapping Quick Workouts use; supports **2–6 days/week
  including weekend-only** via constraint-aware day-slot selection). It programs **only from the
  curated `is_core` pool** (the ~160 staple movements) so a 1,300-exercise search library can't
  degrade generated plans. **Engine v2 — coach-quality selection (`lib/exerciseProgramming.ts`):**
  the old engine built sessions from the 8 coarse `movement_pattern` buckets, which miscategorise
  for programming (biceps curls are `pull`, cleans are `hinge`, and calf raises / leg curls / leg
  extensions collapse into `squat`/`hinge`) — so leg days read as random lists with bad order +
  duplicate deadlifts. A pure, shared **classifier** now derives a fine **slot**
  (squat/hinge/lunge/knee_flexion/quad_iso/calf/h_push/v_push/chest_iso/triceps/h_pull/v_pull/
  rear_delt/lat_raise/biceps/core/cardio/carry), a **role** (power/compound/isolation/core/cardio),
  and a lift **family** from `primary_muscles` + name keywords + pattern (no DB migration — those
  columns already exist). Session templates are **ordered `SlotSpec` lists** (power → primary →
  secondary → accessory → isolation → finisher) per goal × split; `selectForSlots` fills them
  enforcing **role fit** (a compound slot rejects isolation work), **anti-redundancy by family**
  (never two deadlift variants), **per-focus rotation** (the FIRST Legs day opens with the canonical
  back squat, later ones vary), **affinity fallback** for thin equipment, and the time budget. Pools
  group **by slot** (mobility excluded). `extendActivePlan` + `restampFuturePlanForExperience` share
  the path. Validated against the real 163-row core pool (full-gym Legs = Squat → Good Morning →
  Bulgarian → Leg Curl → Leg Extension → Calf; dumbbells-only adapts to Goblet Squat + DB variants).
  Prescriptions are **role-aware** (`buildPrescription` takes the classified role: primary compounds
  heavier/lower-rep + full rest, isolations higher-rep + short rest — within the goal, so
  autoregulation + periodization stay live), and the runner hub shows a **"Why this workout?"**
  sheet (`lib/sessionRationale.ts`) explaining the order in plain language.
  **Duration is goal-accurate**: `progression.estimateSessionMinutes` computes real
  wall-clock time = warm-up + Σ sets×(work + rest) using the goal's actual inter-set rest (strength
  a full 3 min, athletic ~2.5, hypertrophy ~90 s), and `exerciseCountForDuration` inverts it to pick
  how many lifts fit the user's preferred length for that goal — so a 45-min strength day is a few
  heavy lifts with full rest, a 45-min fat-loss day is a longer circuit. Replacing a plan also
  **cleans up the retired sessions' synced calendar events + reminders**, and **mirrors the program
  into My Splits** (`ensureAutoSplit`). **Replacing is FK-safe and self-healing**
  (`lib/retireWorkouts.ts`): `workout_logs.scheduled_workout_id` has no cascade, so one
  ever-started session used to make the old block's bulk DELETE fail silently (one atomic
  statement) while the plan was still marked abandoned — stranding 'scheduled' rows that the
  partial unique index `scheduled_workouts_one_plan_per_day` then used to reject **every** future
  plan insert ("Something went wrong" on every Change Plan, permanently). `clearActivePlans` now
  sweeps **all today-forward** still-scheduled plan-linked/split rows (not just the active
  plan's — this heals already-poisoned accounts; past rows are left for the missed-workout sweep
  so a not-yet-judged session still becomes 'missed'), releases their calendar events + reminders,
  hard-deletes the never-started rows, marks log-referenced ones `'rescheduled'` (already hidden
  app-wide), and **throws on any write failure** so the UI reports a real error before a
  duplicate schedule can be inserted — all via the shared `retireWorkouts.sweepScheduledPlanRows`. Its **`extendActivePlan` rollover** runs on app open: when
  <7 days of plan remain it materializes the next 4-week block — `week_index` keeps counting, the
  mesocycle wave cycles via `weekProgression`, and the new block reflects the *current* profile +
  `adaptation_mode` — **so the plan never just ends at week 4**. The runway/week-count *decision*
  (the exact logic the "4-week cliff" bug lived in) is factored into the pure, unit-tested
  **`planRollover`** module (`PLAN_RUNWAY_DAYS` / `planNeedsExtension` / `planExtensionWeeks` +
  the shared `formatLocalDate` that `generatePlan.formatDate` delegates to); `extendActivePlan`
  now orchestrates the DB reads/writes around it. See the test suite in §8.
  `periodization` (mesocycle: overload weeks + scheduled deload; modes normal/recovery/deload/
  maintenance), `progression` (autoregulated per-exercise load via RPE + rep targets + the
  session-duration model), `adaptation` (workout-feel feedback + the engine that flips
  `adaptation_mode` from real signals and re-stamps future weeks).
- **Experience auto-progression (`experienceProgression`):** the plan *grows with the user*. The
  onboarding experience level (beginner/intermediate/advanced) shapes exercise difficulty and how
  aggressive periodization is — but it's a starting point, not a permanent label. `adaptation` is
  the reactive DOWN direction (overreached → recovery/deload); this is the earned UP direction.
  `maybePromoteExperience` runs after each completed session and graduates the user one tier when
  they've earned it — driven by **completed-session count** (movement competency), pulled forward by
  repeated **"too easy"** feedback, and **gated** so a user the reactive layer is backing off
  (recovery/deload, or recent "too hard") is never promoted. Beginner → intermediate comes quickly
  (~10 sessions, or 6 with a sustained "too easy" signal); intermediate → advanced is earned
  (~36 sessions). On promotion it persists the new level, audits it in `adaptation_events`, and calls
  **`generatePlan.restampFuturePlanForExperience`** — which re-selects level-appropriate exercises and
  re-computes the periodization directive for *every upcoming plan session in place* (not just the
  next rollover block), so the level-up changes tomorrow's workout, not next month's. It surfaces as
  a branded **"LEVEL UP" celebration** on `workout-complete` (gold card + a second confetti fall);
  onboarding's experience step tells users up front that Tempo advances them automatically, so
  picking "Beginner" carries no penalty.
- **Scheduling:** `quickWorkout` (time-boxed session engine), `quickSuggestion` (feeds Home's
  contextual Quick Workout row), `smartSchedule` /
  `autoSchedule` (place workouts around calendar free time; `autoSchedulingEnabled` gates this by
  `scheduling_mode`), **`moveWorkout`** (`resyncMovedWorkout` — the single re-sync path every
  reschedule flows through: re-points the synced calendar event *and* the local reminder at a
  moved workout's new time; used by both auto-movers and Home's one-tap reschedule, so the
  calendar never disagrees with the app), `reschedule` (slot suggestion for moves +
  `suggestTimeOnDate` — a calendar-aware time on a specific day, powering the builder's smart
  pre-fill), `dedupeSchedule`, `unavailability`, `ignoredEvents`.
- **Program / Split layer:** `splits` (split CRUD + active-split management + day hydration +
  **`ensureAutoSplit`** — mirrors the auto-generated program into My Splits as a `kind='auto'`
  split so every user, even on an auto plan, has an activatable split; its `days` are a read-only
  preview built from the plan's upcoming sessions), `splitSchedule` (`activateSplit` /
  `materializeSplit` / `refreshActiveSplit` — lay a custom weekly split onto the calendar as
  `source='split'` workouts; **`activateAutoPlan`** — activating the program mirror *regenerates*
  the periodized plan from the current profile rather than materializing a static copy, so the
  mesocycle/deload logic is preserved. Exactly one schedule drives the calendar: activating a custom
  split retires the plan, activating the program retires custom splits). **The auto mirror is a
  read-only projection of the plan and is NEVER materialized** — `materializeSplit`/`refreshActiveSplit`
  hard-skip `kind='auto'`, and `ensureAutoSplit` self-heals by deleting any future `source='split'`
  rows an older build wrongly laid under the mirror, so a plan day can never render twice (once as
  `plan`, once as `split`). Exactly one schedule drives the calendar.
- **Starter templates:** `starterTemplates` — app-provided workout presets (Push/Pull/Legs/Upper/
  Lower/Full Body/Bodyweight) and split presets (PPL, PPL-3day, Upper/Lower, Full Body) that
  correspond: `applySplitPreset` fills a split's week **and** saves each of its workouts into the
  user's `workout_templates` library. Surfaced as "Start from a template" in the workout-builder
  (`?presetId`) and split-editor, and as Templates in `AddWorkoutSheet`.
- **Recovery & context:** `recovery` (readiness check-ins), `trainingLoad` (rest-day advice),
  `missedWorkouts`, `substitutions` (saved exercise swaps, ranked by curated match → muscle overlap
  → popularity), `travelMode` (the equipment-override record + summaries), **`travelSchedule`**
  (`syncTravelSchedule` — while travel mode is on, rewrites every upcoming plan/split session to
  exercises the current gear supports, stashing the original in `scheduled_workouts.travel_restore`
  and restoring it exactly when travel ends; runs on app open and after save/clear).
- **Body & progress:** `bodyMeasurements` (history + weight/body-fat/waist trend math),
  `progressPhotos` (image pick + private upload), `wrapped` (share cards: weekly/streak/PR/goal/
  monthVolume/topLifts/weightTrend), `achievements`, `avatar`.
- **Insights & motivation:** `weeklyReport` (the Sunday recap engine — workouts/volume/strength/
  weight/consistency), `prs` (per-session weight/e1rm/rep PR detection), `goalProjection`
  (goal-countdown ETA from weight trend + strength max), **`streak`** (`sessionStreak` — the one
  streak definition, shared by stats/wrapped/achievements: **consecutive completed sessions**;
  rest days never break it, a missed/skipped commitment does — so a Mon/Wed/Fri user can actually
  build one; the server `streak_at_risk` push follows the same philosophy).
- **Fitness Intelligence (`fitnessInsights.ts`, new — powers the Progress-dashboard redesign):**
  pure derivations over the data Tempo already has (scheduled_workouts status, workout_logs
  `started_at`, set_logs) that turn Progress from a stats page into a coach that explains behaviour.
  **Composes** the existing engines rather than duplicating them — `computeMomentum` (habit-
  sustainability score off `tempoScore`+`streak`), `readinessFromHistory` (a check-in-free readiness
  from recovery gap + `trainingLoad.consecutiveTrainingDays`, complementing `recovery.ts`),
  `optimalWindow` / `successPatterns` (real time-of-day + weekday patterns from log timestamps),
  `workoutForecast` (3-day fatigue outlook), `consistencyPredictor` (weekly-goal projection),
  `consistencyHeatmap` (GitHub-style adherence grid), `frequencySeries`, `muscleBalance`,
  `strengthTrends` (per-lift start→now top movers), `journeyTimeline`, `intensityFromReadiness` +
  `muscleRecovery` (Train tab readiness), and **`muscleIntelligence`** (Body Map: per-group status/
  recovery/volume-trend + an overall balance score, over the coarse `muscle_group` only — no
  fabricated per-fine-muscle stats). Every output ships a human message and honest empty states; no
  invented numbers. 19 unit tests (`__tests__/fitnessInsights.test.ts`).
- **Body Intelligence / Muscle Map** (`app/muscle-map.tsx` + `components/MuscleMap.tsx`): a signature,
  **Pro-gated** feature reached from a card in Progress → Coaching. A clean geometric SVG figure
  (front/back, `react-native-svg` shapes — motivational, not medical) with tappable, status-coloured
  muscle zones (green optimal · amber attention · red recovering · purple growing), a **muscle-balance
  score** with per-group bars, per-muscle detail (frequency, weekly sets, recovery %, last trained,
  volume trend + Train/See-progress actions), and auto insights. New Pro id `muscle_intelligence` in
  `proFeatures.ts` (+ a paywall point). **Gating is dormant-safe**: `useProGate().locked` is only true
  once Pro is LIVE and the user isn't subscribed — then free users get a premium *preview* (dimmed map
  + locked detail + a feature-specific "Unlock Muscle Intelligence" upsell); while Pro is dormant
  everyone sees it in full. The map has a **Status** mode (status colours + recovery-% callout bubbles
  on the least-recovered muscles) and a **Heatmap** mode (7/30/90-day training-stimulus glow). A
  **post-workout teaser** on `workout-complete` surfaces it at a high-intent moment (only when locked).
  The figure is built from organic SVG shapes over a silhouette — a photoreal anatomical body just
  needs a real `.svg` asset dropped in with the same group ids + fills.
- **User workouts:** `customExercises` (custom-exercise CRUD + `metricsFor` + `EXERCISE_COLUMNS`),
  `workoutBuilder` (drafts, templates, scheduling, duplicate, duration estimate).
- **Origin labelling:** `workoutOrigin(source)` maps a scheduled workout's `source` to a
  "who made this" chip — **Tempo** (sparkles, for `plan`/`quick`/`smart`) vs **Yours** (person, for
  `custom`/`split`) — shown on Home feed cards, the Train hub, and workout history, so a Tempo "Push"
  day is visibly distinct from the user's own "Push" day. My Splits mirrors this: the program split
  reads **BY TEMPO**, custom splits read **YOURS**.
- **Exercise library & search:** **`exerciseSearch`** is the one client-side library search, shared
  by the picker and the Exercise Library screen: `useExerciseLibrary` caches the whole library
  (React Query, 10-min stale); `searchLibrary` does instant, ranked, alias-aware token matching
  ("rdl" → romanian deadlift, "ohp", "pushup") with **AND semantics** (a query for "push" never
  returns pulls) and popularity tie-breaks; `groupFamilies` collapses near-identical variants
  (barbell/dumbbell/cable/machine versions of the same movement) into one representative row that
  expands on demand — so a search for "bench" isn't 40 rows. **`exerciseDb`** derives each imported
  row's ExerciseDB clip id + on-demand how-to steps straight from its UUID (see §5).
- **Exercise matching:** `equipmentMatch` (`expandEquipment` — "Full gym" implies
  barbell/dumbbells/**kettlebell**/bands/**pull-up bar**; ALL equipment matching goes through
  **`canPerform`**: generatePlan, quick workouts, swaps, substitutions, travel adaptation).
  Equipment now distinguishes **`pull_up_bar`** (a bar/dip station/rings) from truly-**`bodyweight`**
  (floor only): `needsApparatus(name)` flags the ~80 library moves tagged `bodyweight` that actually
  need something to hang from/dip on (pull-ups, chin-ups, dips, muscle-ups, hanging raises, inverted
  rows, suspension work), so a "No equipment" user isn't handed dips they can't do — they're gated
  behind selecting the pull-up-bar option (onboarding **equipment** step, Profile equipment editor,
  **travel mode**; the exercise-library browse filter splits the same way — "No equipment" = floor
  only, "Pull-up bar" = the apparatus moves). A thin no-equipment Pull day then degrades via
  `PATTERN_AFFINITY` (below). Plan generation treats experience as a per-pattern
  PREFERENCE (one tier above the user's level kept as backup, never displacing in-level picks),
  and session padding is **focus-aware** (`PATTERN_AFFINITY`: a thin Pull day borrows hinge/core
  work and then stops — a short honest session, never a "Pull day" of planks). Machine/cable
  exercises are seeded `beginner` (migration `fix_machine_exercise_levels.sql`, applied).
- **Infra:** `supabase` / `supabase.native` (clients — the native client ties
  `auth.startAutoRefresh()`/`stopAutoRefresh()` to `AppState`, because RN timers freeze in the
  background: without it the JWT could expire unnoticed and the first save after a long resume
  failed with an opaque "Something went wrong" that succeeded on retry),
  **`retireWorkouts`** (`sweepScheduledPlanRows` — the ONE sweep both plan generation and split
  activation run, so the victim predicate can't drift between them: selects today-forward
  still-'scheduled' plan/split rows (past rows are left for the missed-workout sweep to judge —
  retiring them would erase the 'missed' signal adaptation feeds on), releases calendar
  events/reminders in parallel (`releaseScheduledRows`), then FK-safe-retires
  (`retireScheduledWorkouts`); see Planning),
  **`saveErrors`** (`describeSaveError`/`isAuthError`/`isNetworkError` — maps a failed save to
  actionable copy: offline vs expired-session vs server. The auth branch fires a background
  `refreshSession()` so its "Tempo is refreshing it — tap Try Again" copy is true at every call
  site. Used by onboarding saves, the runner's start/set/complete writes, quick-workout start,
  Home's skip, split-editor template loads, and sign-in), `analytics` (PostHog, typed events),
  `crashReporting` (Sentry), `pushTokens` (register/enable device push — **never prompts for
  permission itself**; onboarding's primed ask and the Profile toggle own the OS prompt),
  `notifications` (local pre-workout reminder — now gated at its single choke point by the
  device-local `pre_workout` pref — + **rest-done notification** + `hasReminderPermission`
  probe for no-prompt background paths),
  **`notificationPrefs`** (per-rule opt-outs, §6.1: account-level server rules in
  `user_profiles.notification_prefs` via `loadNotificationPrefs`/`setServerRuleEnabled`, read by
  the retention-push function; the device-local pre-workout reminder via
  `get/setPreWorkoutEnabled`; `DEFAULT_PREFS` all-on to preserve prior behavior),
  **`returningUser`** (§5.1: `getReturningState` derives a 3/7/30-day absence tier from the last
  completed session + the next scheduled one — drives Home's returning-user hero),
  **`purchases`** (§10 — the ONLY module touching react-native-purchases / -ui; guarded like
  `haptics` so a pre-rebuild JS reload no-ops instead of crashing, and entitlement reads fail
  *closed*: `configurePurchases`/`identifyPurchases`/`resetPurchasesUser`, `fetchIsPro` +
  `addProUpdateListener`, `restorePurchases`, and — for the **custom** paywall (`app/paywall.tsx`) —
  `getProOffering` (the dashboard's current offering), `purchaseProPackage` (returns
  `{ok,isPro,cancelled}`, distinguishing a real failure from a user cancel), and
  `packageHasIntroOffer` (free-trial detection). The hosted-UI helpers
  `presentPaywall`/`presentPaywallIfNeeded` remain as fallbacks and `presentCustomerCenter`
  powers Profile's "manage subscription"; `PRO_ENTITLEMENT` + SDK keys from env, **no product IDs
  or prices hardcoded** — the paywall renders whatever the current offering contains),
  **`proFeatures`** (§10 — the typed gated-feature registry: `ProFeatureId` + `PRO_FEATURES` upsell
  copy (title/benefit/icon) so every lock card + the paywall speak one voice from one place, plus
  `PAYWALL_POINTS`, the honest delivered-value bullets the paywall lists — never advertises an
  unbuilt feature),
  **`proConfig`** (§10 — `fetchProEnabled` reads the `app_config` `pro_enabled` row on app open:
  the dormant-launch flag, defaults hard to OFF, with a per-account allow-list for private testing),
  **`units`** (lb/kg display preference — persisted per
  device like the theme; storage is ALWAYS lbs, every training surface converts at the UI edge:
  runner inputs/targets/PREV, progress, profile tiles + body stats + log entry, history,
  session detail, weekly report, PR lines, builder; toggle in Profile → Settings → Units.
  Deliberately still lbs: Wrapped share cards/captions, goal-projection copy, achievement
  milestones, and waist stays inches), `exerciseGif` (RapidAPI media), `account` (delete),
  **`accountLinking`** (guest → permanent account, §1.1: `linkGuestAccount('google'|'apple')`
  attaches the identity onto the existing anonymous user via **`linkIdentity()`** — NEVER
  `signInWithOAuth`/`signInWithIdToken`, which would swap the session and orphan all the guest's
  data — mirroring `CalendarAuthService`'s safe pattern incl. the post-exchange "did the user id
  change?" guard and `identity_already_exists` handling; `link_unavailable` when the project's
  "manual linking" setting is off. Also `countCompletedWorkouts` and the durable, per-user,
  force-close-proof `guestSavePromptSeen`/`markGuestSavePromptSeen` gate for the one-time
  post-workout prompt, `GUEST_SAVE_PROMPT_AFTER = 3`),
  `types` (domain types).
- **Session UX & social (July 2026 overhaul):**
  **`durationEstimate`** (realistic session-length model: per-exercise `SETUP_SEC` transition +
  sets×(work+rest); `adaptiveRemainingSec` blends observed logging pace with the static per-set
  cost — trust ramps to ~85% observed after ~7 sets; `fetchPaceFactor` = clamped median
  actual/planned over the last 12 completed sessions. Used by the runner's hub estimate +
  live "~N min left", `workoutBuilder.estimateDurationMin`, and `splitSchedule`'s materializer),
  **`haptics`** (the app's tactile vocabulary — `tapLight`/`tapMedium`/`success`/`warning` on
  expo-haptics with a guarded require + Vibration fallback, so a dev client built before the
  module exists never crashes), **`restPrefs`** (per-workout rest-length preference keyed by
  workout focus, SQLite-localStorage-persisted; `SUGGESTED_REST_SEC = 120`),
  **`handoff`** (single-slot consumed-on-read mailbox for "create X, return, auto-use it" flows —
  currently split-editor ↔ workout-builder), and
  **`social`** (friends/privacy/shares data layer: search + friend CRUD over the RPCs,
  `fetchFriendOverview` incl. client-side streak from settled sessions, `fetchFriendTemplates`
  (RLS-gated), `copyTemplateToLibrary` + `importWorkoutShare` — attributed "Push (Jacob's)"
  copies that drop unreadable custom exercises gracefully, `createWorkoutShare`/`fetchWorkoutShare`
  with 8-char lookalike-free codes and `shareUrl`).

---

## 4. Backend (Supabase — live project `rtoahppnekykgmjukujm`)

### 4.1 Tables (~18; RLS scopes rows to the owner except where the social layer deliberately widens reads)
- **user_profiles** — goal, experience, equipment, days/week, availability (wake/bed/work/school,
  preferred time, flexibility, training days, unavailable blocks), `bodyweight_lbs` cache,
  `injuries`, `travel_mode`, `ignored_events`, calendar prefs, **`scheduling_mode`** (`auto`/`manual`).
- **programs** / **exercises** — program templates + the exercise library: **~1,360 built-in
  movements** (imported from the ExerciseDB catalog by `mobile/scripts/build-exercise-library.mjs`,
  seed `supabase/seed_exercise_library_v2.sql`) across push/pull/squat/hinge/core/cardio/carry/
  **mobility** patterns. Columns **`is_core`** (the ~160 staples the plan/quick engines program
  from), **`popularity`** (0–100 search-rank signal), and **`muscle_group`** (chest/back/shoulders/
  arms/core/legs/glutes/cardio/mobility filter bucket) were added by `add_exercise_library_v2.sql`.
  Imported rows carry EMPTY instructions (the app fetches how-to steps + the form GIF from
  ExerciseDB on demand, keyed off the row's UUID — see §5); the original hand-written seed + 12
  hand-authored staples keep inline instructions. `exercises` also holds **custom** user exercises
  (`user_id`, `is_custom`, `category`, `notes`, `tracking_metrics`); RLS keeps built-ins public and
  custom rows owner-only.
- **workout_templates** — reusable user-built workouts (`exercise_ids` + per-exercise `config`).
- **splits** — the Program/Split layer: a named weekly weekday→workout pattern (`days` jsonb,
  `is_active`; one active per user). **`kind`** is `custom` (user-built) or `auto` (the mirror of
  the generated program — one per user, surfaced in My Splits; see §3.5). Activating one materializes
  `scheduled_workouts` (custom) or regenerates the plan (auto).
- **user_plans** — the active plan: program, dates, `current_week`, `adaptation_mode`, status.
- **scheduled_workouts** — every planned/quick/smart/**custom**/**split** session: date/time, focus,
  `exercise_ids`, status, calendar link, `source`, **`week_index` + `progression`**,
  **`exercise_config`** (per-exercise prescription for user-built workouts), **`split_id`**
  (links split-sourced sessions back to their split), and **`travel_restore`** (jsonb stash of the
  pre-travel exercises so travel-mode swaps revert exactly — see §3.5).
- **workout_logs** / **set_logs** — actual sessions and per-set reps/weight/RPE/**duration/distance**;
  `set_logs.is_warmup` flags warm-up sets (excluded from PREV/progression/volume/PRs everywhere).
- **adaptation_events** — audit of feedback + auto-periodization decisions.
- **exercise_substitutions** — saved per-user swaps.
- **calendar_connections** / **google_calendar_tokens** — calendar linkage (Google refresh token is
  service-role-only).
- **body_measurements** — time-series weight / body-fat % / waist / progress-photo path.
- **device_tokens** — Expo push tokens per device (`enabled` flag).
- **notification_log** — every retention push attempt (status/error/ticket) for debugging + analytics.
- **waitlist** — marketing capture.
- **friendships** — the social graph: one row per pair (`requester_id`/`addressee_id`,
  `status` pending→accepted, unordered-pair unique index). RLS: parties only; requester inserts
  pending; addressee accepts; either deletes (decline/cancel/unfriend).
- **workout_shares** — snapshot sharing: an 8-char `code`, owner + `owner_name`, `name`,
  **`kind`** (`workout` | `split`), `exercises` jsonb ([{id,name}] so previews render even when the
  viewer can't read a custom exercise), `config`, **`days`** (jsonb split snapshot when kind='split'),
  **`equipment`** (distinct required gear for preview chips), `est_duration_min`. Any signed-in user
  can read (the link is the capability); owner inserts/deletes.
- **user_profiles identity columns** — **`username`** (unique, `^[a-z0-9_]{3,20}$`) + **`friend_code`**
  (unique 6-char, no lookalikes), backfilled for existing rows and auto-set on insert by the
  `user_profiles_identity` trigger. The friend code is the out-of-band "add me" handle; the
  username disambiguates duplicate display names.
- **user_profiles privacy columns** — `privacy_workouts` / `privacy_stats` / `privacy_activity`
  (`public|friends|private`, default `friends`). Enforced by the `Friends can view templates`
  RLS policy on `workout_templates` and inside the `friend_overview` RPC.
- **Social RPCs (SECURITY DEFINER, authenticated-only):** `search_profiles(q)` (name / @username /
  exact friend-code, code matches first) + `get_public_profiles(ids)` (name/avatar/username
  discovery without opening `user_profiles` RLS), `are_friends(a,b)`, `friend_overview(target)`
  (privacy-gated totals — workouts / sets / **volume** (warm-ups excluded) / **favorite muscle** /
  goal / member-since — + settled sessions for client-side streak math + recent activity),
  **`friend_feed()`** (accepted friends' completed sessions, last 14 days, activity-privacy-gated;
  each row now also carries `workout_id` + a `reaction_count` / `i_reacted` summary),
  **`friends_leaderboard()`** (workouts-this-week for you + accepted friends, stats-privacy-gated),
  and — social upgrade Stage 1 — **`friends_leaderboard_v2()`** + **`current_session_streak(uid)`**
  (`add_social_leaderboards.sql`, **applied**). v2 returns every rank input per member in one call
  (this-week scheduled/completed/active-days, current streak, and 28-day Tempo Score components:
  due/completed/weeks-met-goal/goal-per-week); `current_session_streak` mirrors `lib/streak.ts` in SQL.
  The **Tempo Score itself is computed client-side** in `lib/tempoScore.ts` (0–1000, consistency-only,
  no strength inputs; frequency counts only *completed* sessions so it can't be gamed — 8 unit tests
  assert a consistent beginner out-scores a flaky advanced lifter) so the formula is OTA-tunable.
  `social.tsx` renders the trio as a 3-tab board (Weekly Consistency / Streak / Tempo Score) with
  client-side sort (`fetchLeaderboardV2` + `sortLeaderboard`). Full design: `SOCIAL_UPGRADE_PLAN.md`.
  **Social upgrade Stage 2 — badges + richer feed** (`add_social_badges.sql`, **applied**;
  `lib/badges.ts`): the **single** achievement system (the old `lib/achievements.ts` grid was merged
  in and removed from Progress; `computeLevel` stays for the player level). 12 badges — consistency,
  milestone (First Workout / 30 · 100 Sessions / Ton · 100K Club, from all-time totals), competitive,
  social — Ionicons + bronze/silver/gold tiers, rendered in the Achievements tile language by
  **`BadgeShelf`**. Progress's "Next Milestone" card now points at the closest locked badge. Reached
  via a **badges button on the Profile header** (next to Friends, with an **unviewed** count that
  clears when you open the **`badges` modal screen** — the trophy case: all badges, earned lit /
  locked dimmed with progress). Friend profiles show their earned badges inline.
  Derived ones (Perfect Week, Consistency Champion, 30-Day Streak) light up from
  session history; competitive (Weekly Winner, Top 3 Monthly) live in **`user_badges`**, awarded by
  the idempotent **`claim_competitive_badges()`** RPC run on app open (`syncSocialOnOpen` in the auth
  store, which also publishes the user's streak-milestone rows). **`activity_events`** (streak/
  perfect-week/badge, RLS + dedupe) feeds **`friend_events()`**; the Friends screen merges it with
  completions chronologically. `friend_overview()` now also returns `stored_badges` + `days_per_week`
  and computes a friend's `earned_badges` in `fetchFriendOverview`. 15 unit tests (tempoScore+badges).
  **Social upgrade Stage 3 — private groups** (`add_social_groups.sql`, **applied**; `lib/groups.ts`):
  `groups` + `group_members` (RLS via SECURITY-DEFINER `is_group_member()` to avoid policy recursion);
  RPCs `create_group` / `join_group` (by invite code) / `leave_group` (owner-leave deletes the group) /
  `list_my_groups` / **`group_leaderboard(gid)`** (the `friends_leaderboard_v2` shape scoped to a
  group's members, members-only). UI: a **Groups** section on the Friends screen (list · create · join
  by code) + a **`group-detail`** modal (shareable code, member-scoped board, leave/delete). The
  three-tab board is now the shared **`LeaderboardBoard`** component used by both friends and groups
  (`mapLeaderboardV2Rows` maps either RPC's rows). End-to-end verified on the live DB.
  **Social upgrade Stage 4 — social scheduling** (`add_social_scheduling.sql`, **applied**;
  `lib/availability.ts` + `lib/scheduling.ts`): the differentiator — coordinate workouts around real
  schedules. `privacy_availability` knob (default friends); `friend_availability(target)` returns a
  mutual friend's coarse availability (sleep/work/school/training-days/blocks + busy workout slots,
  no titles), privacy-gated. The pure `availability` engine (`freeWindows` → `overlapWindows` →
  `suggestSharedSlots`, 9 tests) turns two people's schedules into shared free times. Friend profile →
  **"Schedule together"** (`ScheduleTogetherSheet`) suggests slots and sends a `workout_invite`;
  `respond_workout_invite('accept')` schedules the session for **both** users (`partner_id` links the
  pair) — surfaced in a **WORKOUT INVITES** section on the Friends screen (accept/decline). Completing
  a `partner_id` workout earns the **Workout Partner** badge (via `claim_competitive_badges`).
  End-to-end verified on the live DB (send → accept → both scheduled). **Accountability push nudges**
  extend the `retention-push` edge function (no schema change — `notification_log.type` is free text,
  prefs are generic jsonb): **partner_reminder** (a workout with a friend is tomorrow → "don't leave
  them hanging", evening) and **friend_competition** (Thursday evening, one workout from passing a
  friend). Both respect the per-rule opt-out (new toggles in `notificationPrefs.ts` + Profile) and the
  one-push-per-run cap; taps deep-link via `data.screen` (`social` route added). *Still deferred:
  automatic social reschedule when a slot breaks.*
  **Activity reactions** — a single "nice work" (🔥) on a friend's feed row: table
  `activity_reactions` (reactor_id, workout_id → scheduled_workouts, unique per pair; RLS owner-only)
  toggled through the SECURITY DEFINER `toggle_activity_reaction(target_workout)` RPC, which validates
  `are_friends` + completed-session visibility and returns the fresh count/state; the client
  (`lib/social.toggleActivityReaction`) updates the feed row optimistically and reconciles. The
  reaction control only renders when a row has a `workout_id`, so the feed still works if the
  migration isn't applied yet. Migrations: `add_social.sql` + **`add_social_v2.sql`** (identity, feed,
  leaderboard, split shares, warm-up column — both **applied**) + **`add_activity_reactions.sql`**
  (table + RLS + feed/toggle RPCs — **applied**).

### 4.2 Edge Functions (Deno)
- **delete-account** — App-Store-required full account + data wipe (service role, JWT-scoped to caller).
- **google-calendar-token** — securely stores/uses the user's Google refresh token server-side.
- **retention-push** — the server-driven retention engine: evaluates per-user rules (**weekly_report**
  on Sunday evenings; **missed_workout** as the daytime "session still open" nudge; **streak_at_risk**
  only when *today's scheduled session* is still open in the evening — **never on a planned rest
  day**, matching the session-based streak; free-time gap; reactivation), sends via the Expo
  Push API in batches, logs every send, and disables dead tokens. **Per-rule opt-out (§6.1):**
  reads each user's `user_profiles.notification_prefs` and skips any rule the user turned off
  (`reactivation` is always-on and not user-exposed; every other rule defaults on). A missing
  column/row falls back to all-on, so the filter is a safe no-op until the migration is applied.

### 4.3 Scheduling & storage
- **pg_cron** job `retention-push-hourly` invokes `retention-push` every hour (via `pg_net`).
- **Storage:** private **`progress-photos`** bucket with per-user-folder RLS, and a **public
  `avatars`** bucket (`add_avatar_storage.sql`) — public because avatars are shown to friends
  elsewhere in the app and need no signed-URL refresh cycle; write access is still RLS-scoped to
  each user's own `<user_id>/…` folder.
- **Migrations:** SQL files in `mobile/supabase/` (`schema.sql`, `seed_*`, and incremental `add_*`
  migrations) — all applied to the live project. Recent: `add_exercise_library_v2` (is_core/
  popularity/muscle_group + backfill) & `seed_exercise_library_v2` (the ~1,300-row import),
  `add_travel_schedule` (`scheduled_workouts.travel_restore`), `add_split_kind` (`splits.kind` +
  one-auto-per-user index), `fix_days_per_week_allow_six` (user_profiles check widened 2–5 → 2–6;
  the UI has offered 6 days since the constraint-aware generatePlan work, so picking 6 failed every
  profile save with "Something went wrong"), and **`add_social`** (friendships, privacy columns,
  social RPCs, friend-template policy, workout_shares — see §4.1). The library import is regenerated by
  `mobile/scripts/build-exercise-library.mjs` (reads the ExerciseDB catalog, emits the seed SQL).

---

## 5. Integrations
- **Google Calendar** (OAuth via `expo-auth-session` + the token edge function) and **device
  calendar** (`expo-calendar`, offered on iOS **and Android**) — Tempo reads busy times to
  schedule around real life. **Connecting Google never swaps the Supabase user**: Google-auth
  users re-consent via OAuth (with a post-exchange identity check), while guest/Apple users go
  through `linkIdentity()` (requires "manual linking" enabled on the Supabase project; fails safe
  with a clear error when it isn't — previously this flow could silently replace a guest/Apple
  session and strand all their data). **Disconnecting is first-class**: Profile → **Disconnect
  Calendar** drops the server-side Google refresh token (`disconnectGoogleCalendar`) and clears the
  app's synced-event references (calendar events already created stay in Google); the device "stop
  using" path turns off auto-add, clears the chosen calendar + event references, and points to system
  Settings for the OS-owned permission Tempo can't revoke itself.
- **Auth:** Apple (`expo-apple-authentication`), Google, guest (Supabase anonymous). Guests can
  upgrade to a permanent account without losing history via `lib/accountLinking` (§1.1) — the same
  `linkIdentity()` path the calendar connect uses, surfaced through `SaveProgressSheet` from a
  guest-only Profile card and a one-time modal after the 3rd completed workout. (Apple linking uses
  Apple's *web* OAuth, so it needs an Apple **Services ID** + return URL configured in Supabase
  Auth — unlike the native Apple sign-in button; Google is the fully-proven path. Both fail soft.)
- **Push:** Expo Push API (server-driven) + local `expo-notifications` for the 30-min pre-workout
  reminder.
- **Media:** exercise GIFs are self-hosted, not fetched live. They used to be requested straight
  from the ExerciseDB image endpoint (RapidAPI) on every device on every view — that's a *shared*
  quota (RapidAPI BASIC = 690 req/month total across **all** installs), so it exhausted almost
  immediately and most exercises silently stopped showing a clip. Fixed by caching each GIF exactly
  once: `mobile/scripts/backfill-exercise-media.mjs` downloads each exercise's GIF from RapidAPI
  (throttled, resumable, stops cleanly on the monthly quota) and uploads it to the public Supabase
  Storage bucket `exercise-gifs` (`add_exercise_gif_storage.sql`); the same run also backfills
  `exercises.instructions` for imported rows still empty, straight from the ExerciseDB detail
  endpoint, using the same free quota. `src/data/exerciseMedia.ts` resolves an exercise's form GIF
  from three sources in priority order: **(1)** bundled local GIFs (`mobile/assets/exercise-gifs/`)
  for the 8 the remote library lacked; **(2)** a curated UUID→clip map for the original
  hand-written seed (with optional "close variant" notes); **(3) derivation** — the ~1,300 imported
  rows EMBED their ExerciseDB clip id in their UUID (`edb00000-0000-4000-8000-<id>`), so
  `lib/exerciseDb.exdbIdForExercise` recovers the id. Either way the app now builds a Supabase
  Storage URL (`${EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/exercise-gifs/<id>.gif`) and
  never calls RapidAPI live for images — an exercise not yet backfilled just 404s like a genuine
  gap. `EXPO_PUBLIC_RAPIDAPI_KEY` is now build/backfill-time only for the image path; `exerciseGif`
  still does a live RapidAPI name-search as a last resort for custom user exercises with no
  embedded id (low volume, can't be pre-cached). Since the 690/month cap covers ~1,300 exercises
  ×2 calls (GIF + instructions), a full backfill takes a few monthly re-runs of
  `npm run backfill:media` (needs a `SUPABASE_SERVICE_ROLE_KEY` env var, never committed) —
  already-cached/backfilled exercises are always skipped, so re-running is safe. **Fixed bug:** the
  curated/derived clip's `<Image>` in `ExerciseFormSheet` had **no `onError` handler at all** —
  since almost every one of the ~1,300 imported rows takes this path, a single failed request
  rendered nothing with no fallback. Now retries the same request once, then falls back to the
  "form video coming soon" illustration only after both attempts fail.
- **Analytics/crash:** PostHog + Sentry.

---

## 6. Key flows
1. **Onboarding → plan:** capture goal/experience/equipment/calendar/availability (+ optional
   starting weight) → `generatePlan` builds a periodized 4-week plan around the user's hard
   constraints (never-train days, injuries) → auto-scheduled around the calendar → primed
   notification ask → reminders set + push token registered.
1a. **Plan rollover:** on app open, when <7 days of plan remain, `extendActivePlan` materializes
   the next 4-week block (mesocycle repeats, honoring the current profile + adaptation mode) —
   the plan never ends.
2. **Daily home:** unified schedule + readiness + block-phase + Quick Workout wedge.
3. **Run a workout:** prescriptions blend reactive autoregulation with the week's periodization; RPE
   logged per set; completion updates streak/consistency and re-evaluates `adaptation_mode`.
4. **Quick Workout:** minutes + focus → highest-impact session that fits, persisted as today's session.
5. **Adapt (both directions):** missed sessions / "too hard" feedback flip the plan into
   recovery/deload and re-stamp future weeks; conversely, consistent completed sessions (pulled
   forward by "too easy" feedback) graduate the user's experience level beginner → intermediate →
   advanced, immediately re-stamping upcoming sessions with harder variations + a real overload
   wave and celebrating the level-up.
6. **Retention loop:** hourly cron → `retention-push` → targeted nudges → deep-link back into the app.
7. **Body tracking:** log weight/body-fat/waist (+ optional photo) → trend feedback on Profile.
8. **Weekly recap:** Sunday-evening push + Home card → Weekly Report (improvement scorecard) → share.
9. **Motivation surfaces:** momentum celebration + PR highlights after each session; goal countdown
   and rich next-workout empty state on Home; tap the phase banner for the plan explanation.

---

## 7. Telemetry, privacy, store-readiness
- **Analytics events:** `app_open`, signup/login, `onboarding_complete`, `session_start/end`,
  quick-workout generated, workout feedback, share-card opened — with platform + app-version props.
- **Privacy/compliance:** in-app Privacy Policy + Terms (`legal.tsx`, opened from the sign-in footer
  **and** Profile → Privacy & Terms — the sign-in links were previously dead text, now wired),
  in-app **account deletion** (App Store Guideline 5.1.1(v)), per-user RLS everywhere, Google token
  kept server-side only. Publicly mirrored on the marketing site (`web/`): `privacy.html`,
  `terms.html`, `delete-account.html` (hosted at `fittempo.app/...`). The **privacy policy carries the
  Google API Services "Limited Use" disclosure** required to pass OAuth verification for the sensitive
  `calendar.events` scope. Filled-in submission answers (OAuth verification steps, App Store **App
  Privacy** + Play **Data safety**) live in `STORE_SUBMISSION.md`; console-upload logos in `brand-assets/`.
- **Store assets:** the app icon is a **full-bleed white** 1024² (`icon.png`, alpha stripped →
  Apple-safe), rebuilt from the runner/clock glyph so there is **no black frame**; the Android
  adaptive icon is a white `backgroundColor` + isolated-glyph `foregroundImage` (the accidental
  guide-template `backgroundImage` and the dangling `monochromeImage` reference are removed);
  `notification-icon.png` is a **white glyph silhouette** (Android tints notification icons to a
  monochrome mask, so the old full-colour icon showed as a white square); `splash-icon.png` is the
  white rounded badge shown on the dark splash on both platforms. In-app brand assets:
  `tempo-logo.png` (white-tile badge), `tempo-mark.png` (transparent two-tone glyph), `tempo-glyph.png`
  (white silhouette for `tintColor`). `app.json` carries permission strings + export-compliance flag;
  `eas.json` has build env + submit scaffold; launch steps in `LAUNCH.md`.
- **Sign in with Apple:** `ios.usesAppleSignIn: true` in `app.json` (the entitlement native Apple
  auth needs — its absence was why it failed on real builds). Still requires the "Sign in with Apple"
  capability enabled on the Apple Developer App ID + the Apple provider configured in Supabase Auth.
  The sign-in screen renders Apple's **official** `AppleAuthentication.AppleAuthenticationButton`
  (black in light mode / white in dark, so it's always compliant + on-brand) and a custom Google
  button carrying the real Google mark (`Ionicons logo-google`) — the old literal "G" / blank Apple
  glyph are gone.
  Offering Apple also satisfies Apple's rule that a third-party login (Google) obliges an Apple option.
- **iOS 17 calendar permissions:** `NSCalendarsFullAccessUsageDescription` +
  `NSCalendarsWriteOnlyAccessUsageDescription` are declared alongside the legacy
  `NSCalendarsUsageDescription`, so calendar access prompts correctly on iOS 17+.
- **Bundle identifiers:** iOS `com.fittempo.app`, Android `com.fittempo.app` (the original
  `com.tempo.app` was unavailable on Apple).
- **OTA updates (EAS Update):** `expo-updates` configured — `app.json` has `updates.url`
  (`https://u.expo.dev/<projectId>`) + `runtimeVersion.policy: appVersion`; each `eas.json` build
  profile declares a matching `channel` (`development` / `preview` / `production`). JS/asset-only
  changes ship with `npx eas update --branch <channel> --message "…"` (no rebuild). Native/config
  changes (new modules, plugins, permissions, SDK bumps, or a `version` change — runtimeVersion is
  tied to app version) still require a full `eas build` + TestFlight submit.

---

## 8. Known gaps / roadmap
- ~~No monetization anywhere (no paywall / subscriptions / billing)~~ **Built, shipped DORMANT
  (§10)**: RevenueCat via `react-native-purchases` + `-ui` (`lib/purchases`), the entitlement store,
  Profile Upgrade + Customer Center rows, and a post-first-workout paywall trigger — the ENTIRE
  system is gated behind the `app_config.pro_enabled` remote flag (`lib/proConfig`), defaulted OFF,
  so the public v1 is free-only and Pro turns on later with one SQL update (no rebuild/resubmit).
  While dormant every gate is unlocked, so the free app is unchanged. **Native module → needs an
  `eas build`.** **Now delivered (Depth & horizon model):** a **custom on-brand paywall**
  (`app/paywall.tsx`, dynamic pricing from the current offering — monthly/annual, auto-computed
  savings, trial CTA, Restore, Terms/Privacy), the `proFeatures` registry + `ProGate`/`ProLockCard`/
  `ProBadge` gating primitives, and the **first live gate: Advanced Analytics** (volume trends +
  strength-trend deep-dive on Progress). The engine stays FREE (plan generation, adaptation, quick
  workouts, logging, scheduling, basic progress) so free is fully functional. Dashboard
  prerequisites: the entitlement (`EXPO_PUBLIC_PRO_ENTITLEMENT`, currently `Tempo: Fitness Planner
  Pro` — must match exactly) + monthly ($4.99) / annual ($34.99) products in a **current offering** +
  Customer Center config; real `appl_` key is in `eas.json`. **Fast-follow Pro surfaces** (registry
  entries already stubbed, each a `<ProGate>` wrap away): smart scheduling optimization, muscle-group
  analysis + PR forecasting, long-horizon/goal-date planning, premium themes + app icons, and
  **Tempo Coach** (the tentpole). Migration `add_app_config.sql`.
- ~~Guests had no discoverable way to save their history off-device (data loss on reinstall/new
  phone)~~ **Done (§1.1)**: `lib/accountLinking` + `SaveProgressSheet` — a guest-only "Save your
  progress" card on Profile plus a one-time modal after the 3rd completed workout, both linking an
  Apple/Google identity onto the anonymous account via `linkIdentity()`. (Server-side prerequisite:
  "manual linking" enabled on the Supabase project — the calendar guest-link already relies on it;
  Apple *web* OAuth needs a Services ID in Supabase Auth for the Apple button specifically.)
- ~~Notification controls were all-or-nothing~~ **Done (§6.1)**: per-rule switches in Profile →
  App (`lib/notificationPrefs` + the retention-push filter) — mute one nag without silencing the
  rest. Server rules persist to `user_profiles.notification_prefs` (**migration
  `add_notification_prefs.sql` must be applied + the function redeployed**); the pre-workout
  reminder is device-local. All default on to preserve prior behavior.
- ~~A lapsing user's return was treated like any other day~~ **Done (§5.1)**: `lib/returningUser`
  drives a top-priority Home banner with 3/7/30-day states — resume the next session, one-tap into
  recovery mode (`applyAdaptationMode`), or a plan re-check (Change Plan) — all from existing data.
- Free-time-gap push uses a daytime heuristic (true calendar free/busy needs backend calendar sync).
- Progress-photo gallery / before-after compare (capture + storage exist; no timeline UI yet).
- HealthKit / Google Fit import; Apple Watch.
- ~~No automated test suite yet~~ **Started (§4.2/§11.2)**: Jest + ts-jest cover the deterministic
  core — `src/lib/__tests__/` has 82 tests over periodization (one deload / 4 weeks), progression
  autoregulation + duration math, the exercise classifier (~30-exercise fixture), streak continuity,
  goal-projection ETAs, and the **`planRollover`** cliff regression (horizon never < 7 days, no
  duplicated/dropped `week_index`). `npm test`. Config: `jest.config.js` + `tsconfig.jest.json`
  (transpile-only via ts-jest; the app's own `tsconfig.json` excludes `src/**/__tests__`). No RN/
  Supabase in the suite — pure logic only.
- ~~Progress tab rings/bars are hand-rolled `Animated.View`s, not real SVG~~ **Done**: `SvgProgressRing`
  (gradient stroke-dashoffset ring), `SvgLineChart` (the weight-trend math in `bodyMeasurements.ts`
  now actually has a chart, not just text numbers on Profile), and `SvgGrowBar` (gradient volume
  bars) all ship on `react-native-svg`. A small data-driven insight line ("+12% volume vs last
  week") sits under the volume chart — real deltas only, no generated copy.
- ~~Profile is not yet regrouped into clear sections~~ **Done**: split into Training / Social /
  Calendar & Scheduling / App / Account cards (was two mega-cards, "My Plan" + "Settings"). Username
  shows under the display name; avatar is tappable → real photo upload; Body Stats links out to the
  new Progress trend chart instead of duplicating it.
- ~~The same stats (streak / workouts / volume / badges), the achievements grid, and PRs render on
  both Profile and Progress~~ **Done**: Profile's stat grid, achievements grid, and PR card were
  removed. Progress is now the sole stats/achievements/PR home; Profile is identity + config, with
  the level/XP hero as its one glanceable stat. Body Stats (logging) and Exercise Swaps (config)
  intentionally stay on Profile.
- Exercise-library "too many hyper-specific variants" complaint: partially addressed (family
  collapse is now the default view + shortest-name tie-break for the representative); no further
  data-level curation/pruning has been done.

---

*See also `LAUNCH.md` (iOS/Android launch guide) and `CLAUDE.md` (build/run + project conventions).*
