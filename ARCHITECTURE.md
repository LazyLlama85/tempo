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
- **Onboarding stack** `onboarding/`: `goal → experience → equipment → schedule` (2–6 days/week;
  choose a calendar — Google via account-safe linking, or the device calendar on **both**
  platforms — **and** an **auto vs. manual scheduling mode**) `→ availability → plan-preview`
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
  profile-setup. The **experience step's preview** is a real "session at this level" card —
  icon chip + 3-bar intensity meter + three sample lifts with set×rep prescriptions per level
  (replacing the old gray placeholder box), and the screen scrolls on small phones.
  `plan-preview` also guards double-taps with a **ref latch** (state alone can't stop two taps
  in one frame), proactively refreshes the auth session before the save chain, auto-retries once
  after a silent token refresh on JWT failures, and maps failures to actionable copy (offline vs
  session vs server — `lib/saveErrors.ts`) with Try Again / Not now actions; the availability
  step has the same silent refresh-retry. **`onboarding_complete` flips only AFTER `generatePlan`
  succeeds** (a separate update), so a mid-chain failure + force-quit can't produce an
  "onboarded" account with no plan at next launch.
- **Other screens/modals:** `sign-in`, `quick-workout`, `availability`,
  `travel-mode`, `legal` (Privacy + Terms), `workout-complete`, `weekly-report` (Sunday
  progress recap), `plan-explainer` ("why this week" periodization explanation),
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
  (barbell/dumbbell/cable versions under one expandable row) → the form-guide sheet; entries on the
  Workouts hub + Profile), **`exercise-progress`** (one lift's strength story: per-session best est-1RM bars,
  best-ever tiles, Δ vs a month ago; opened from PR rows on Progress/Profile and from
  session-detail), **`edit-session`** (edit any scheduled session — incl. Tempo-generated — from
  the hub's "Edit workout" chip: add/remove/reorder exercises, pin sets/reps; only *touched*
  exercises get a pinned `exercise_config` entry so untouched plan exercises keep adaptive
  targets), **`social`** (Friends home: **your @username + friend-code card** with copy/share,
  live search by **name / @username / friend code**, requests, **friend-activity feed**, a
  **friends-only weekly leaderboard**, friends list, paste-a-code share redemption, tap-to-cycle
  privacy rows), **`friend-profile`** (privacy-gated @handle + member-since, streak / longest /
  this-week cards, totals — workouts / sets / **volume in display unit** / favorite muscle / goal /
  this-month — recent activity + browsable workouts with "Save to My Workouts" attributed copies),
  **`shared-workout`** (share-link landing for a **workout or a whole split** — metadata chips
  (exercises/days · ~duration · equipment) + one-tap import), and **`w/[code]`** (deep-link route
  for `tempo.app/w/<code>` / `tempo://w/<code>` → shared-workout).

### 3.2 Screen responsibilities
- **Home / Schedule** (`(tabs)/index.tsx`): unified day/week/month calendar; merges plan workouts
  with live device + Google calendar events; readiness ring; **block-phase banner** (where you are
  in the mesocycle); a **weekly-target card** ("2 of 3 sessions" + bar — the winnable loop for a
  3×/week plan); a **contextual Quick Workout suggestion row** (`lib/quickSuggestion` — free
  calendar gap / recently missed / momentum restart; hidden whenever today already has a session);
  **Add Workout** entry + FAB (opens `AddWorkoutSheet` → build new / pick a saved
  workout / pick a starter template, scheduled onto the selected day via the builder);
  missed-workout reschedule; rest-day advice; travel
  banner; "ignore event" to free time; recovery check-in entry. Today's workout flips to a
  gentle **overdue "still on for this?"** state an hour past its start (ember treatment +
  Reschedule / Skip), a workout a calendar event now overlaps shows a **proactive "move it?"**
  one-tap reschedule (the felt-intelligent case in manual mode, where times aren't auto-moved),
  and a completed card gets a **Details** action into `session-detail`. On open, Home also runs
  **plan rollover** (`extendActivePlan` + re-place times), the split horizon refresh, conflict
  resolution, and a **14-day reminder reconciliation sweep** (newly materialized or auto-moved
  sessions always carry a correct 30-min reminder; never prompts for permission).
- **Workout runner** (`(tabs)/plan.tsx`): a **hub** and a **live session** in one tab.
  Tapping the tab (no `workoutId` param) lands on the **hub** — the day's session previewed
  (focus, exercise list, sets) with a **Start session** button, plus Quick Workout / My Workouts /
  My Splits / Schedule links. Hub/loading/empty headers carry only the wordmark + avatar — no back
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
- **Progress** (`(tabs)/progress.tsx`): stats, PRs, charts/history.
- **Profile** (`(tabs)/profile.tsx`): gaming-style level/XP hero, achievements grid, PRs, **Body
  Stats** (weight + body-fat + waist trends, progress-photo capture), saved exercise swaps, a
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
  creation + conflict auto-resolve on app open). Connecting a calendar (Profile → Calendar, Google
  inline OAuth or device) is for reading busy times / scheduling around real life — it does **not**
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
  in with Google or use the Device Calendar (profile.tsx + onboarding/schedule.tsx).
- **workout-complete**: streak/consistency spike, difficulty check-in (feeds adaptation), Wrapped
  share cards.

### 3.3 Components (`src/components/`, ~26)
`EditWorkoutSheet`, `ExerciseFormSheet`, `ExerciseMedia`, `RecoveryCheckIn`, `ShareCardSheet`,
`WrappedCard`, `TimePickerSheet`, `LoadingCard` (shimmer skeleton), `ErrorBanner`,
**`CustomExerciseSheet`** (create/edit a custom exercise), **`ExercisePickerSheet`** (search library +
custom, add to a workout), **`AddWorkoutSheet`** (calendar "add a workout": build new / saved
workout / starter template → builder), **`OptionSheet`** (the branded bottom-sheet option picker —
replaces every multi-option `Alert.alert` menu, which Android caps at 3 buttons; items take a
`destructive` flag that renders red — the affordance Alert's `style:'destructive'` gave Delete
rows; used for starter
workout/split presets, "use a saved workout", template actions in My Workouts, split actions in
My Splits, and the runner's rest-length picker), **`Avatar`** (the shared profile picture — chosen
icon+colour or photo, read from the auth store; used in every header so none fall back to a
default icon), themed primitives, plus a `ui/` set. **Brand & delight set (all dependency-free, Reduce-Motion
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
- **`AnimatedRing`** — SVG-free circular progress that animates every value change (two clipped
  half-circle fills on one Animated value). Used by Home's weekly target, Progress's consistency
  score, workout-complete's weekly ring.
- **`celebration`** — `ConfettiBurst` (one-shot, tasteful, auto-unmounts) + `CountUp` (stats tick
  up to their value; lands on the final number even if interrupted).
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
staggered, and a one-time gold "Achievement unlocked" toast + confetti when a new achievement
unlocks (seen-set tracked in localStorage `tempo.seenAchievements`; first visit only records the
baseline). **Onboarding plan-preview:** staggered reveal + a narrated `TempoPulse` build sequence.
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

### 3.5 Domain logic (`src/lib/`, ~36 modules)
- **Planning & progression:** `generatePlan` (4-week periodized plan from goal/experience/equipment;
  **respects hard constraints** — never-train weekdays from unavailable blocks + `training_days`,
  and **injuries** via the same restriction mapping Quick Workouts use; supports **2–6 days/week
  including weekend-only** via constraint-aware day-slot selection). It programs **only from the
  curated `is_core` pool** (the ~160 staple movements) so a 1,300-exercise search library can't
  degrade generated plans, sorting each pattern pool by popularity and capping it for week-to-week
  variety. **Duration is goal-accurate**: `progression.estimateSessionMinutes` computes real
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
  `adaptation_mode` — **so the plan never just ends at week 4**.
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
  `notifications` (local pre-workout reminder + **rest-done notification** + `hasReminderPermission`
  probe for no-prompt background paths), **`units`** (lb/kg display preference — persisted per
  device like the theme; storage is ALWAYS lbs, every training surface converts at the UI edge:
  runner inputs/targets/PREV, progress, profile tiles + body stats + log entry, history,
  session detail, weekly report, PR lines, builder; toggle in Profile → Settings → Units.
  Deliberately still lbs: Wrapped share cards/captions, goal-projection copy, achievement
  milestones, and waist stays inches), `exerciseGif` (RapidAPI media), `account` (delete),
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
  **`friend_feed()`** (accepted friends' completed sessions, last 14 days, activity-privacy-gated),
  and **`friends_leaderboard()`** (workouts-this-week for you + accepted friends, stats-privacy-gated).
  Migrations: `add_social.sql` + **`add_social_v2.sql`** (identity, feed, leaderboard, split shares,
  warm-up column — both **applied**).

### 4.2 Edge Functions (Deno)
- **delete-account** — App-Store-required full account + data wipe (service role, JWT-scoped to caller).
- **google-calendar-token** — securely stores/uses the user's Google refresh token server-side.
- **retention-push** — the server-driven retention engine: evaluates per-user rules (**weekly_report**
  on Sunday evenings; **missed_workout** as the daytime "session still open" nudge; **streak_at_risk**
  only when *today's scheduled session* is still open in the evening — **never on a planned rest
  day**, matching the session-based streak; free-time gap; reactivation), sends via the Expo
  Push API in batches, logs every send, and disables dead tokens.

### 4.3 Scheduling & storage
- **pg_cron** job `retention-push-hourly` invokes `retention-push` every hour (via `pg_net`).
- **Storage:** private **`progress-photos`** bucket with per-user-folder RLS.
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
- **Auth:** Apple (`expo-apple-authentication`), Google, guest (Supabase anonymous).
- **Push:** Expo Push API (server-driven) + local `expo-notifications` for the 30-min pre-workout
  reminder.
- **Media:** ExerciseDB via RapidAPI (`EXPO_PUBLIC_RAPIDAPI_KEY`). `src/data/exerciseMedia.ts`
  resolves an exercise's form GIF from three sources in priority order: **(1)** bundled local GIFs
  (`mobile/assets/exercise-gifs/`) for the 8 the remote library lacked; **(2)** a curated
  UUID→clip map for the original hand-written seed (with optional "close variant" notes);
  **(3) derivation** — the ~1,300 imported rows EMBED their ExerciseDB clip id in their UUID
  (`edb00000-0000-4000-8000-<id>`), so `lib/exerciseDb.exdbIdForExercise` recovers the GIF **and**
  the on-demand how-to steps with no shipped lookup table. `exerciseGif` remains the legacy
  name-search fallback for anything without a verified clip.
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
- Free-time-gap push uses a daytime heuristic (true calendar free/busy needs backend calendar sync).
- Progress-photo gallery / before-after compare (capture + storage exist; no timeline UI yet).
- HealthKit / Google Fit import; Apple Watch.
- No automated test suite yet (pure logic is structured for it).

---

*See also `LAUNCH.md` (iOS/Android launch guide) and `CLAUDE.md` (build/run + project conventions).*
