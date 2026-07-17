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
- **Tabs** `(tabs)/`: **`index`** ("Today" — Home/Schedule), **`plan`** ("Plan", formerly "Train" —
  hub + workout runner), **`progress`**, **`profile`** ("You"). All four mount at startup
  (`lazy: false`) so switches are instant and nothing mounts mid-transition; the stock bar is replaced by
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
  **`schedule` also captures the time-budget question (B3.3)** — MINUTES PER SESSION (30/45/60/75/90,
  pre-filled from the saved profile on Change Plan re-entry) — previously never asked anywhere, so
  every new user silently got a hardcoded 45-minute `preferred_duration_min`. This is a real input,
  not cosmetic: it flows through `availability` → `plan-preview` and directly sets
  `preferred_duration_min`, which `generatePlan`'s `exerciseCountForDuration` uses to decide how many
  exercises fit a session. Then `plan-preview`
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
  durable `firstWorkoutCompleted` flag. **Bug fix, 2026-07-16:** `workout-complete.tsx`'s celebration
  no longer trusts that local flag alone — it's device-local storage, so a reinstall, a new device, or
  an account that already had real workout history before this flag existed all read it as unset,
  which wrongly showed "First workout complete" (day-one messaging + its own paywall trigger) to an
  established user (reported: completed an ad-hoc workout outside their regular split and got the
  day-one celebration). Now defaults to false and only flips true once the real completed-workout
  count (`useProgressStats`, already fetched for this screen) confirms `totalWorkouts <= 1` — the same
  "never trust a device-local fire-once flag for a factual claim, check the real count" principle
  already applied to B3.2's progressive disclosure. `plan.tsx`'s `first_workout_started`/
  `first_set_logged` analytics still key off the same local flag (lower stakes — no user-visible text,
  just funnel accuracy) and weren't changed in this pass; a future cleanup could align them too.
  **Profile → Replay App Tour** re-arms it (and also clears the
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
  scroll of stacked cards. **`plan_tour` (new, 2026-07-17):** a second spotlight tour for the Plan
  tab — calendar (Week/Month + reschedule), current split, and the library doors — armed at the same
  new-user moment as the others and fired independently on Plan's own first post-welcome focus (a
  user may open Plan before ever settling on Home, so it doesn't wait on `home_tour` completing).
  Adding it required generalizing `TutorialOverlay.tsx`'s previously-hardcoded
  `activeTour === T.homeTour ? HOME_TOUR_STEPS : EMPTY_STEPS` ternary into one lookup,
  `lib/tutorial.ts`'s new `TOUR_STEPS: Record<TutorialId, TutorialStep[]>` — the single place both
  the overlay and `stores/tutorial.ts`'s step-completion/skip/replay logic now read from, so adding
  a future tour is purely "new id + new step array," no ternary to touch. **Profile → Replay App
  Tour** now re-arms both `home_tour` and `plan_tour` together.
- **Other screens/modals:** `sign-in`, `quick-workout`, `availability`,
  **`settings`** (new, 2026-07-16/17 — every "how the app behaves" row moved off Profile: Calendar &
  Scheduling, Notifications, Subscription, Tester Tools, App, Account, sign-out/delete; reached via
  Profile's header gear icon, registered in `_layout.tsx` as a `slide_from_bottom` modal),
  `travel-mode` (now Pro-gated-but-teased — see §10), `legal` (Privacy + Terms), `workout-complete`, `welcome` (post-onboarding reveal),
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
  exercise links to its trend; **no longer pure read-only (2026-07-16/17)** — tapping a logged set
  opens it inline-editable (weight/reps/duration/distance per its tracked fields, plus a "per side?"
  toggle when it has a weight), saving an `UPDATE` to the existing `set_logs` row and calling
  `invalidateTrainingData` so volume/PR numbers — always derived live from `set_logs`, never cached —
  reflect the correction immediately; see the runner's matching edit flow below), **`exercise-library`** (browse/search the whole ~1,360-move library —
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
- **Home / Today** (`(tabs)/index.tsx`) — **IA redesign, 2026-07-16 (Phase 1 of 2, plan approved by
  the founder after a full Working Method write-up):** Home is now **today only**. The audit's own
  #1 finding — *"make the hero a day-timeline, not a to-do card"* — plus a founder-flagged density
  complaint (too much to scroll through: Day/Week/Month, a range row, a weekly-target card, a
  calendar strip, a flat list) drove a real IA split, not just a visual pass: **all multi-day
  scheduling (Day/Week/Month, "Reschedule my whole week," the calendar strip) moved to the Plan
  tab** (formerly Train — see below), which now owns the whole week. Home fetches only today's
  `scheduled_workouts` + today's calendar events (`todayStr` on both query keys — no more
  week/month range fetch), merges them into one time-sorted `todayItems` list (the exact same
  merge/hero-pick logic that used to run per-day across a whole `dayGroups` array, now collapsed to
  one day), and renders them on a **vertical timeline**: a continuous decorative rail line
  (`components/DayTimeline.tsx`'s `TimelineRail`) behind the naturally-flowing, **completely
  unchanged** `renderWorkout`/`renderEvent` cards, with a `GapRow` between items showing the real
  free time between them ("2h 15m free") — `lib/dayTimeline.ts`'s new `buildDayGaps` (pure,
  unit-tested), extending the same module the first day-timeline pass added earlier the same day.
  Deliberately **not** time-proportional / absolutely-positioned by minute (card heights vary too
  much — a MISSED badge, an overdue prompt, a conflict note all add height — and this RN0.85/
  React19/new-arch stack already has a history of silent rendering bugs this session); the rail is
  a single decorative element behind ordinary document flow, carrying none of that per-item risk.
  This supersedes the same-day's first pass (`DayTimelineStrip`, a horizontal ruler above the list)
  — the founder's own device screenshot showed it reading as a weak afterthought, so it's gone,
  replaced by making the card list itself the timeline.
  **Hierarchy pass (2026-07-16, after the founder's device review of the first attempt):** the
  first version put a rail next to the *existing dense card* and changed nothing else — the founder
  correctly called it noise with no hierarchy ("too many elements competing at the same size and
  intensity"). The structural fix: **the timeline is a DISPLAY; the action bar is separate and sits
  BELOW it** (matching the reference design, where `Start Session` is outside the timeline entirely).
  So `renderWorkout` now renders only status/title/one meta line, and a single `renderHeroActions`
  bar underneath the whole timeline owns the primary CTA + focus caption + the "lacking time?" link.
  Both read the same `workoutState(w)` helper so display and action can't disagree about what state
  today's session is in. Secondary actions (Add to Calendar, Details, Edit, Skip) moved into the
  tap-to-expand state — one tap away, **not removed**. Added an **eyebrow + big headline**
  ("SCHEDULED TODAY" / "Your Window to Build Muscle", the goal in the user's own language) as the
  hierarchy anchor. Two real bugs fixed in the same pass: the readiness chip and the primary glow
  were both rendering on **completed** workouts — readiness advice about a decision already made,
  and a finished session as the loudest thing on screen. **Context strip:**
  `ContextItem` gained `chipOnly`, implementing the audit's explicit "demote goal countdown,
  block-phase, and 3 of the 4 banner types → one calm chip row" — goal/block/report/travel can now
  never take the banner slot (they were out-shouting today's session at the top of the screen); the
  banner is reserved for something needing an ACTION or reporting something BROKEN (missed,
  calendar-disconnected, welcome-back). Their `primary()` renderers are intentionally kept (dead but
  one flag-flip from being re-promoted). **Weekly target** rebuilt: the old ring + bar showed the
  same number twice — now one bar, a `N / target` count, and a line that says where you stand.

  **Round 2 (same day, second device review):** the rail line now fades in/out at each end instead
  of cutting hard past the first/last item — `components/DayTimeline.tsx`'s `TimelineRail` measures
  its own rendered height (`onLayout`) and draws a real `react-native-svg` `LinearGradient`
  (0→1→1→0 opacity stops) rather than a percentage-based CSS fade, so the fade length
  (`RAIL_FADE_PX`, 26px) stays constant whether the day has two items or ten; guarded against a
  fade longer than a very short rail. **All-done day gets its own screen, not the regular
  timeline**: `dayComplete` (every scheduled workout today is `'completed'`) switches Home to a
  completion card — a checkmark, "Session Complete," real logged minutes + lifted volume (summed
  from `set_logs` for today's actual `workout_logs`, warm-ups excluded, matching every other volume
  calculation in the app — **not** a fabricated number) — followed by a "NEXT UP" row (the existing
  `nextWorkout` query, already fetched) and each finished session collapsed to a quiet reachable row
  (→ `session-detail`), never a glowing struck-through card with no CTA. The headline personalizes
  to "Nice work, {first name}." off `profile.display_name`'s first token (falls back to a name-free
  greeting if the value looks like an email or is implausible). **A two-tile stats row** closes the
  screen: Total Volume (all-time, with an 8-week sparkline reusing `stats.weekVolumes` — the exact
  bars Progress's own chart already computes, zero new data) and Sessions + current streak.
  **Deliberately no heart-rate/steps tile** despite the founder's reference design showing one —
  Tempo has no HealthKit integration (B5.2, unbuilt); a fabricated biometric number would be worse
  than the tile not existing. Both tiles gate on `stats.totalWorkouts > 0` so a brand-new account
  doesn't see an all-zero row.
  **Hero card gets three additions** (still the same `renderWorkout` function, hero-branch only):
  a **readiness chip** ("88% ready · go hard," reusing `readinessFromHistory`/`intensityFromReadiness`
  off the SAME `useProgressStats(userId)` call Home already made — zero new queries — tapping through
  to Progress, which owns the full readiness card); **tap-to-expand** on the hero title, revealing a
  lazily-fetched (only once expanded) exercise-name list + `describeSession()`'s "why this workout"
  headline (a lightweight peek query — `id, name, movement_pattern, primary_muscles` — deliberately
  NOT the full prescription/warmup/log-resuming load `plan.tsx`'s runner does); and a **"Lacking
  time?" escape hatch** (audit: *"add this inline"*) that marks today's session skipped (reusing the
  existing `skipWorkout` path) and routes to the existing `/quick-workout` generator for a real
  15-minute session, confirmed via `OptionSheet` first — deliberately NOT a new "shrink this session"
  abbreviation engine, which would have been much larger, unrequested scope.
  **Today's-context strip** (`contextItems` array, unchanged from before this redesign): the
  contextual banners — missed-workout reschedule, Google-reconnect, travel-mode, rest-day advice,
  block-phase (mesocycle position), goal-countdown ETA, weekly-report nudge (Sun/Mon), Quick Workout
  suggestion (`lib/quickSuggestion`) — stay priority-resolved so at most one shows as a full banner,
  the rest as swipeable chips. **Weekly-target card** moved to directly under the timeline (the
  audit: *"the single best retention mechanic on the screen — keep it prominent"*) instead of above
  everything else. **Empty-day states simplified**: rest day with a real next session ahead shows
  the existing "YOUR PLAN / next workout" card; a genuinely empty plan (no session today or ahead)
  shows one "Add a workout" prompt — the old third branch (rest day within an otherwise-populated
  *week* range) no longer applies now that Home has no week range to compare against.
  **Add Workout** FAB (opens `AddWorkoutSheet`, defaults to today); "ignore event" to free time;
  recovery check-in entry (the header ring — separate from the readiness chip above, this is where
  you *log* a check-in). On open, Home still runs plan rollover, split-horizon refresh, conflict
  resolution, and the 14-day reminder reconciliation sweep, and the `AppState`-driven missed-workout
  re-check on a new calendar day — none of that changed. **Home tour**: the old two-step "this is
  your calendar" + "your next session" pair collapsed into one step (`lib/tutorial.ts`
  `HOME_TOUR_STEPS`) anchored on the timeline itself, since there's no separate calendar strip left
  on Home to spotlight on its own; the anchor now wraps the ENTIRE conditional render (loading/error/
  empty/timeline) in one always-present `View` so the tour target survives every branch, matching
  the invariant the old per-day anchor relied on. **Not yet on-device verified** — flagged 🔍, needs
  the checklist in `EXECUTION_STATUS.md`'s session log before this can be trusted, same discipline
  as every other live-UI batch this session.
- **Plan** (`(tabs)/plan.tsx`, formerly "Train" — **IA redesign Phase 2, 2026-07-16**): a **hub**
  and a **live session** in one tab; the tab file/route is unchanged, only the label and the hub
  content. Plan now owns **all multi-day scheduling** (moved from Home in Phase 1): a `[Week |
  Month]` toggle + range row + a **"Reschedule my whole week"** icon button (the exact
  `lib/reschedule.ts` engine, UI relocated verbatim from Home) sit above a week strip / month grid
  (`renderDayCell`, also moved from Home, using Plan's own lightweight `plan_cal_workouts` range
  query — day/status only, no calendar-event merge, since Plan's calendar only needs to know which
  days have a workout for the dots). **Tapping a day** shows that day's session below the calendar:
  selecting **today** shows the full pre-existing session card (hero focus, readiness chip, exercise
  list, "why this workout," Start/Resume — unchanged, since the runner's own `workout` state always
  resolves to today's session regardless of what's selected in the calendar); selecting **any other
  day** shows a lighter read-only summary (focus, time, duration, exercise count) with an **Edit**
  button into `edit-session.tsx`. Below that: a condensed **CURRENT SPLIT** card (name, days/week,
  split-day labels, **Edit Split** → `my-splits`) — the audit's "one Programs door," replacing the
  old full Splits list. Then **LIBRARY & TOOLS**: three simple navigation rows (Exercise Library,
  Manage Workouts, History) — not an inline searchable list; that removed the old segmented
  Workouts view's own template-browsing UI, since `my-workouts` already does that job.
  The `[Week | Month]` month grid carries a **dot legend** (Scheduled / Done / Missed) — without it
  a month of numbers is an unexplained colour code — and the selected-day card names the day it's
  showing ("THURSDAY, JUL 16 · SCHEDULED"), since "Rest day" alone gave no clue which cell you tapped.
  **The old 4-way segmented control (`components/TrainSegments.tsx`: Session/Readiness/Splits/
  Workouts) is gone, file deleted** — none of its non-Session segments survived in a form the new
  design still needed: **Readiness** moved to a chip on the session card (tapping through to
  Progress's full `ReadinessCard` + muscle-map, the same "point of decision, not a full tab"
  treatment Home's hero chip got in Phase 1) — the underlying `readinessFromHistory`/
  `intensityFromReadiness` computation stays, feeding the same chip; **Splits**' full list became
  the condensed current-split card above; **Workouts**' inline list became a nav row. `muscleRecovery`
  (only ever feeding the deleted `TrainReadinessView`) is unused now too. **Not touched, still
  runner-critical:** `muscleTimeline` → `weeklySetsByGroup` (B5.4's real weekly-set counts per
  muscle group) still feeds `buildPrescription`'s MRV cap at all 3 live call sites — that's a
  completely separate concern from the display-only readiness chip and was never part of the
  segmented-control cleanup. The hub renders **even on a rest day / when nothing is scheduled today**
  (today's session branch shows an empty state; the calendar, split card, and library rows stay
  usable regardless).
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
  + feedback bias), pre-fills sets, smart exercise swaps, form guide + exercise GIFs. **Coach card
  decluttered (bug fix, 2026-07-16):** the set rows are already pre-filled with the exact target
  reps/weight (`initialSets` seeds `reps` from `p.repHigh`, `lbs` from `p.suggestedWeight`), so the
  card above them no longer repeats a redundant "N reps × M sets" line — it now shows only when
  there's a genuine trend to report (`p.direction !== 'new'`: GO UP/HOLD/BACK OFF + the specific
  reason, e.g. "You cleared 12 reps last time — add 5 lbs."), which is exactly the "final-set,
  improved-from-last-time" signal worth surfacing. A brand-new exercise (no logged history for that
  exact `exercise_id`) shows no card at all now — removed the boilerplate "First time on this lift?"
  paragraph that repeated on every such exercise; the pre-filled rep target is already visible in the
  first set row. (Note: exercise-selection **rotation** for week-to-week variety means a specific
  `exercise_id` often really is new even for an experienced user on a long-running split — the card
  reflects that honestly rather than fabricating a trend that doesn't exist; a future iteration could
  track progression per movement-pattern/slot instead of exact exercise id to reduce how often that
  happens, not attempted here.)
  **Scheduling / split-recovery bug fixes (2026-07-16/17, direct founder reports):** (1) "Reschedule
  my whole week" (`lib/reschedule.ts`'s `rescheduleWholeWeek`) only ever re-slotted EXISTING
  `scheduled_workouts` rows — if a split day had been deleted/skipped first, it stayed missing after
  a reschedule. Now calls the same fill logic `materializeSplit` (`lib/splitSchedule.ts`) already uses
  for the active split, for each weekday in the horizon with no live row, BEFORE re-slotting — so a
  reschedule can't skip re-creating a day that should exist. (2) A soft-deleted day
  (`status:'skipped'`, the established remove-a-workout pattern — never a real `DELETE`) was
  permanently orphaned: `materializeSplit`'s "already taken" existing-dates query had no status
  filter, so it read a skipped date as occupied forever. Fixed the query to exclude
  `status = 'skipped'` (a skipped date now reads as open again — `'rescheduled'` days still correctly
  stay excluded, since those are genuinely superseded by a plan/split change, not a single-day
  removal) — this alone means the next app-open split-horizon refresh self-heals a skipped day with
  no user action. Plan's day-card also gained an immediate affordance so the user isn't stuck waiting
  for that sweep: selecting a day the active split expects a workout on, but has none for, shows
  "Unscheduled this week — Add it back" with a one-tap button that re-runs the same fill logic for
  just that day. (3) Plan's hub said "No session scheduled today" even once today's only session was
  already completed — `loadWorkout()`'s fallback only ever queried for a `'scheduled'` row; it now
  falls back to checking for a `'completed'` row on today's date and shows "Today's session is done"
  instead of the generic empty state. (4) Connecting/reconnecting a calendar left a stale-looking
  workout until a force-quit — `calendar-setup.tsx` fired `syncUpcomingWorkouts` fully fire-and-forget
  with zero query invalidation, and Home's `range_events` key wasn't in `useRefreshOnFocus`'s list
  either. Fixed at both ends: `calendar-setup.tsx` now invalidates `['range_events', userId]` +
  `['scheduled_workouts', userId]` after every connect/disconnect path, and `lib/queryInvalidation.ts`'s
  shared `TRAINING_KEYS` gained `['range_events']` + `['plan_cal_workouts']` so this exact class of
  staleness can't recur at any other mutation call site either (the same fix covers the "onboarding
  scheduled nothing until calendar connected" report — `generatePlan` always wrote the rows
  immediately; the stale-query gap was the real cause, surfacing differently on first run).
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
  **Editable completed sets + unilateral weight (2026-07-16/17):** a logged set could previously only
  be fixed by delete-and-redo (`removeSet`). Tapping a done set now re-opens it as editable inputs;
  saving issues an `UPDATE` to the existing `set_logs` row (`saveSetEdit`) instead of a new insert,
  then calls `invalidateTrainingData` — `session-detail.tsx` gained the identical tap-to-edit-inline
  pattern (see §3.1), since "logged it wrong, want to fix it after the fact" is squarely a
  post-session need too. A new **"×2 per side" toggle** next to the weight input (both surfaces)
  covers unilateral work with **no schema change**: `lib/unilateralPrefs.ts` (mirrors
  `lib/restPrefs.ts`'s device-local, per-exercise-name-keyed localStorage pattern exactly) remembers
  the choice per exercise, and the typed number is doubled into `weight_lbs` at write time — every
  existing volume/PR calculation, which already reads `weight_lbs` directly, needed zero changes.
  **Quick Workout re-scoping / session-active signal (2026-07-16/17):** the founder kept the GO tab
  button but asked that it not compete with a live session. New one-boolean `stores/sessionActive.ts`
  (matches the size/shape of small existing stores like `stores/entitlements.ts`) — `plan.tsx` syncs
  its local `sessionActive` state into it on mount/change and resets it false on unmount; siblings
  can't share React state directly, hence the store. `components/TempoTabBar.tsx`'s GO button reads
  it and hides (`pointerEvents:'none'`) while a session is live.
  **Active-session Focus Mode (2026-07-16/17):** a new full-screen, ADDITIVE view for whichever set is
  currently in play — `components/FocusMode.tsx`, built after the founder's own reference screenshot
  (large center ring, rest timer with −/+ adjust, form-reference preview, Skip/Done taking up the
  whole screen, "especially for the rest timer"). Auto-opens when a rest timer starts
  (`restSecondsLeft` goes non-null right after `startRest(...)`); a manual "Focus" button on the
  exercise-card header opens it too. The ring (reusing `SvgProgressRing`, not new SVG code) shows a
  live countdown while resting or the target-rep count while active; −/+ adjusts rest duration live;
  the form preview reuses the exact same `getExerciseGifSource` resolution the exercise card's own
  thumbnail already uses (curated clip → RapidAPI ExerciseDB clip → none), fetched once, not
  re-fetched. Skip/Done wire to the exact existing handlers — `stopRest()` (skip while resting),
  `removeSet()` (skip while not resting), `handleSetDone()` (done either way) — **no new logging
  semantics**, just a different full-screen frame around the same state. Everything the runner
  already had — the scrollable exercise list, ⋯ menu, RPE bar, warm-up toggle, trash, add-exercise,
  Pause sheet — keeps working completely unchanged; Focus Mode is a second way to view the SAME
  state, closing it returns to the normal list with nothing lost.
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
- **Profile** (`(tabs)/profile.tsx`): identity + history surface — **trimmed to just that in the
  2026-07-16/17 Settings split** (below). The **level/XP hero** shows a **Pro badge** (gold, when
  `useProAccess().isPro`), a **streak chip**, and **member-since**, plus a new **header gear icon**
  (`router.push('/settings')`). Below it (`components/ProfileCards.tsx`): a **Fitness Identity card**
  (goal · frequency · session length · equipment · active split, as chips — from `profile` +
  `fetchActiveSplit`) and a **Tempo Insights grid** (WHOOP/Oura-style stat tiles: workouts, streak,
  consistency, PRs, volume, readiness — from `useProgressStats` + `readinessFromHistory`; no new
  fetches beyond the split). Hero uses `Elevation.e2`, cards `e1`. This surfaces stats *on Profile as
  identity*, distinct from Progress's analytics dashboard. Profile keeps **Body Stats** (weight +
  body-fat + waist trends, progress-photo capture — the only place to *log* a measurement; "View
  trend" links to Progress), saved exercise swaps, a **"Right Now"** section (temporary/personal
  adjustments — **travel mode** (now Pro-gated-but-teased, see §10 above) **+ injuries**), **Training**
  (workouts/splits/history/library + equipment/Change Plan; **Primary Goal and Experience are now
  independently editable** — see below), and the Social section (Friends, gated on activation). Sign
  out, account deletion, calendar/notifications/appearance/units/tester-tools all **moved to the new
  `app/settings.tsx`** (route registered in `_layout.tsx` as a `slide_from_bottom` modal), reached via
  the header gear icon: Calendar & Scheduling (availability, calendar connect/disconnect,
  auto-scheduling toggle, add-to-calendar toggle, remove-all-Tempo-events), Subscription (Pro
  upgrade/manage, tester-gated), Tester Tools, App (notifications master + 7 sub-switches, appearance,
  units, Replay App Tour), Account (Privacy/Terms), Sign Out, Delete Account. This is a pure
  relocation — every row kept its exact existing handler/behavior, just moved files.
  **Goal/Experience independent edits (2026-07-16/17):** both rows were previously read-only display
  text, forcing the full "Change Plan" re-onboarding wizard (`/onboarding/goal`) for even a
  single-field change. Now tappable → a small `OptionSheet` → `saveTrainingField(field, value)`:
  `UPDATE user_profiles`, then calls `restampFuturePlanForExperience(supabase, userId)` (the same
  function `lib/experienceProgression.ts` already uses for automatic level-up promotions — it
  re-selects every upcoming session's exercises against whatever's currently in `user_profiles` and
  silently skips any focus it can't map to the new template set, so it can never corrupt the
  schedule), then `invalidateTrainingData(queryClient)`. **Days Per Week deliberately stays
  read-only** — changing it alone would leave the split's day count structurally wrong (the template
  set `restampFuturePlanForExperience` builds is keyed by `days_per_week`, so most old sessions'
  focuses would stop matching and go un-restamped) — still requires the full "Change Plan" regen.
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
  and calendar-setup shows the same banner inline. **Read-failure diagnostics
  (`CalendarApiService.describeReadError` + `getLastCalendarReadError()`):** when the token mints fine
  but the Calendar *Data API* rejects the read (valid token, but the **Calendar API isn't enabled on
  the Google project** or the token lacks the **`calendar.events` scope** — the classic break after
  flipping the OAuth app to "In production" without registering the scope), the read paths
  (`fetchUserEvents`/`fetchUserBusySlots`) no longer swallow it blindly: they parse Google's error
  `reason`, attach a fix hint, and report it via `captureApiError('gcal_read', …)` to Sentry — so a
  silently-empty timeline is diagnosable instead of a mystery (`getCalendarEventsForRange` still
  degrades to `[]` for the UI so the feed never blanks).
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
  - **No `Alert.alert` confirmations from inside a sheet (do not regress):** a system `Alert`
    (`UIAlertController`) cannot present over an open `TempoSheet` `<Modal>` on iOS — it silently
    no-ops, so a confirm dialog fired from within a sheet appears to "do nothing". `EditWorkoutSheet`'s
    "Remove from schedule" hit exactly this (tap Remove → nothing happened); it now uses an **in-sheet
    inline confirm** (Keep it / Remove) plus **inline error text** for the save/remove failure paths
    (those `Alert`s were silent for the same reason). Rule: confirmations and error feedback that live
    inside a sheet must render as in-sheet UI (an inline row, or a nested `TempoSheet`/`OptionSheet` —
    nested Modals DO present), never `Alert.alert`. Single-button post-action toasts elsewhere share
    the flaw but fire after the action and rarely need to be seen, so they're low-priority.
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
- **`TempoTabBar`** — the floating dock (see 3.1). Its GO button reads `stores/sessionActive.ts` and
  hides while a live session is mounted (2026-07-16/17).
- **`FocusMode`** (new, 2026-07-16/17) — the full-screen active-set view described in §3.2's Plan
  section (large `SvgProgressRing`, rest −/+ adjust, form preview, Skip/Done). Purely presentational —
  every prop is read from state the runner (`(tabs)/plan.tsx`) already owns; ADDITIVE, not a
  replacement for the runner's existing exercise-card list.

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
**Onboarding plan-preview:** staggered reveal + a narrated `TempoPulse` build sequence, **then (B3.3)
the real week ahead** — after generation succeeds, a 7-day strip fetched from the just-created
`scheduled_workouts` (not a mockup) animates in one day at a time (`FadeInView`, staggered ~90ms/day),
each day showing its real workout + time or "Rest day"; a "Continue" tap then does the exact
navigation (`profile-setup` / back into the app) that used to happen immediately. Skips straight to
that navigation, unchanged, if the fetch fails or the week is genuinely empty — never shows a
misleading all-rest-days screen. Tutorial arming for new users happens *before* this fetch, so a
force-close during the reveal still leaves the account correctly armed.
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
  **Bug fix (2026-07-16/17):** the existing-dates "already taken" check used to have no status
  filter, so a soft-deleted (`status:'skipped'`) day read as permanently occupied and was never
  refilled — now excludes `status = 'skipped'` (reads as open again; `'rescheduled'` still correctly
  stays excluded, since that's a genuine supersession, not a single-day removal). `lib/reschedule.ts`'s
  `rescheduleWholeWeek` now calls this same fill logic for any missing split day before re-slotting
  the week, so "reschedule my week" can restore a deleted day instead of only re-slotting what already
  exists. Everything downstream (feed, runner, auto-scheduling, calendar sync, missed sweep) works
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
- **`stores/sessionActive.ts`** (new, 2026-07-16/17) — a one-boolean store (`active`/`setActive`), the
  only shared signal between the Plan tab's runner and its sibling `TempoTabBar` (siblings can't share
  React state directly). Set true while a live session is mounted, false on unmount/pause/finish;
  `TempoTabBar`'s GO button hides while it's true, so Quick Workout never competes with an in-progress
  session.
- **`stores/entitlements.ts`** (Tempo Pro, §10) — two facts: `proEnabled` (the dormant remote flag)
  and `isPro` (the RevenueCat entitlement). A feature is `locked` only when `proEnabled && !isPro`,
  so while dormant nothing is gated. `useProAccess()` exposes the state; `useProGate()` wraps a
  paid feature *action* — `requirePro(context)` returns true (proceed) when unlocked, else routes to
  the custom paywall (`/paywall?context=…`) and returns false. Loaded/synced in `_layout.tsx` on
  each session change; a live RevenueCat listener fires `trial_started` / `trial_converted` /
  `subscription_cancelled` on entitlement transitions. The declarative layer is
  **`components/ProGate`** — `<ProGate feature>` renders children when unlocked (or dormant) and a
  branded `ProLockCard` (icon + benefit + "Unlock with Pro" → paywall) when locked, plus `ProBadge`.
  **B2.1 re-fenced the gate** (audit finding: analytics doesn't convert, scheduling does — "monetized
  on its weakest feature"). Progress's Advanced Analytics (volume-trends card, PR-browser, per-lift
  `exercise-progress`) is now **free**, unconditionally — no `ProGate`/`requirePro` left on it.
  **First real gate:** Home's **"Reschedule my whole week"** button (B1.3b) — `handleWeekReschedule`
  calls `requirePro('schedule_optimization')` before opening the confirm sheet. Deliberately scoped
  to just that one-tap action, NOT the free, always-on background auto-scheduler (`autoSchedule.ts`)
  that already silently time-optimizes every user's plan around their calendar — gating the ambient
  engine would break existing free users' current experience overnight, which is a live regression,
  not a re-fence (see `proFeatures.ts`'s `schedule_optimization` comment, which spells out this
  distinction so a future call site doesn't accidentally gate the ambient engine by reusing the same
  feature id). Muscle Intelligence (`muscle-map.tsx`, plan.tsx's readiness tab, the post-workout
  teaser) is unchanged — still gated, out of this batch's scope. **Travel Mode is a new gate
  (2026-07-16/17):** a new `travel_mode` id in `proFeatures.ts`; Profile's "Right Now" → Travel Mode
  row is wrapped in `<ProGate feature="travel_mode" compact>`, and `travel-mode.tsx` itself also
  checks `useProGate().locked` and renders a `ProLockCard` in place of the equipment/duration form
  when locked — belt-and-suspenders so a locked user can't reach the form via a deep link either,
  matching `muscle-map.tsx`'s own screen-level gating pattern. Dormant-safe like every other gate:
  byte-identical while `proEnabled` is false. **The custom paywall**
  (`app/paywall.tsx`) reads the live offering (dynamic prices, auto-computed annual savings %,
  free-trial CTA when configured), Restore, and Terms/Privacy (→ `/legal`); dormant-safe and
  StoreKit-compliant. **Redesign:** value-prop hero (glow) → `PAYWALL_POINTS` feature cards → a
  **Free-vs-Pro comparison table** (kept honest to the real gating in `proFeatures.ts`) → the live
  plan cards + trial note → a "less than a coffee a week" value line → **trust indicators** (Secure ·
  Private · No ads · Cancel anytime). No fake testimonials (deliberately — real ones can be dropped
  in later). All purchase/restore/offering logic unchanged. Everything ships DORMANT — flip
  `app_config.pro_enabled` (or allow-list a uid) to go live with no rebuild. The Pro upgrade/manage
  rows live in a **Subscription** section on the new `app/settings.tsx` screen (moved off Profile in
  the 2026-07-16/17 Settings split below; shown only while Pro is live).
  **Tester Tools (Pro on/off switch):** the store also holds `tester` (may this account use the
  switch) + `devProOverride` (`null` real · `true` force-Pro · `false` force-free, persisted via the
  `localStorage` idiom, survives the RevenueCat listener). `useProAccess()` honors the override
  **only while `tester` is true**, forcing `proEnabled` on so a tester previews BOTH the free/paywall
  and unlocked experiences without a purchase — and so any lingering override goes inert the moment
  tester access is revoked (no ex-tester stuck paywalled-after-paying, or comped forever). `tester`
  is remote-gated by `proConfig` — `app_config.pro_enabled.tester_tools: true` (beta), or membership
  in `test_user_ids`/`pro_user_ids` — and is **not** tied to the global `enabled` flag, so turning
  Pro live for the public at launch never exposes the switch. UI: a **Tester Tools** section on
  Profile (only when `tester`) with the Pro switch + a "use real subscription state" reset. Ships
  OTA — no rebuild — but appears only once the founder flips `tester_tools` on.

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
  sheet (`lib/sessionRationale.ts`) explaining the order in plain language. **Adaptation legible in
  the runner (audit §12 Personalization):** the deload/peak-week banner now renders
  `workout.progression.note` — the real, phase-specific coaching line from `periodization.ts`'s
  per-mode tables — instead of one flat hardcoded string for every deload. A *scheduled* deload
  ("Planned recovery — lighter with less volume so you supercompensate") now reads differently from
  a *reactive* one `refreshAdaptation` triggered by missed sessions / "too hard" feedback ("You've
  been grinding — this week is a deliberate step back to recover"), which is exactly the audit's own
  complaint that "personalization you can't perceive doesn't retain." **Volume landmarks (B5.4,
  `lib/volumeLandmarks.ts`, new):** MEV/MRV weekly-set ranges per coarse muscle group (`exercises.
  muscle_group` — chest/back/shoulders/arms/legs/core), MRV scaled by experience (beginners lower,
  advanced higher; MEV holds steady). `buildPrescription` takes an 8th **optional** `weeklyVolume`
  arg — omit it and behavior is byte-for-byte unchanged (tested) — that CAPS (never floors) this
  exercise's sets so the muscle group's real completed volume this week can't exceed its weekly MRV,
  appending an honest note to the prescription's `reason` only when it actually changes something.
  `(tabs)/plan.tsx` feeds it from `muscleTimeline` (already fetched for the readiness card — **zero
  new queries**) filtered to the current week, plus the signed-in profile's `experience`. Deliberately
  a CAP only, not full two-way titration (auto-adding sets under MEV would silently inflate session
  length in ways the duration model doesn't expect) — the scientifically urgent half (protect against
  overtraining) without the cross-workout live-aggregation complexity the floor direction would need.
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
  pre-fill; also **`rescheduleWholeWeek`** — the one-call "reschedule my whole week" wedge action:
  re-lays every upcoming session across the best DAYS+times at once, resyncing each moved event,
  running even in `manual` mode since it's an explicit request), **`weekReschedule`** (the pure,
  unit-tested planner behind it — `planWeekReschedule` composes `scoreDay`+`findVariedSlot` to
  assign one recovery-spaced workout per day, never dropping a session. **Preserves split order
  (bug fix, 2026-07-16):** workouts are processed in original chronological order and a `minDay`
  floor prevents a LATER workout from ever landing BEFORE an EARLIER one — without this, two
  workouts with different muscle regions could leapfrog each other purely because one scored
  marginally better for an earlier day (reported: Pull grabbed today's slot while Push, actually due
  today, got pushed to Saturday) — recovery scoring still picks the best day among what's left, it
  just can't reorder which specific workout gets which day anymore), `dedupeSchedule`,
  `unavailability`, `ignoredEvents`. **UI (B1.3b):** a header icon button on Home
  (`(tabs)/index.tsx`, next to the readiness ring) opens a 2-tap `OptionSheet` confirm, then calls
  `rescheduleWholeWeek` behind a single-flight guard; success/empty/error all resolve to a plain
  `Alert` (moved-of-total count, "nothing to reschedule", or `describeSaveError`'s offline/auth/
  server copy on failure) and invalidates the `scheduled_workouts`/`missed_workouts` queries so the
  calendar reflects the new slots immediately. Fires `week_reschedule_used` (moved, total) — the
  payable-moment event B2.2 will hang the paywall trigger on.
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
  streak definition, shared by stats/wrapped/achievements: **completed sessions across consecutive
  training days**. It's **day-aware and source-aware**: rest days never break it; a day you completed
  ANY session counts even if another session that day was missed/skipped (e.g. the plan slot you
  replaced); and **opportunistic `source:'quick'` workouts you added but didn't finish are ignored
  entirely** — a skipped/missed quick workout never breaks the streak (it was never a commitment).
  Only a missed/skipped *committed* session with no completion that day breaks it. `StreakRow` carries
  an optional `source`; `useProgressStats` selects it and applies the same rule to `consistency_pct`.
  The server `streak_at_risk` push follows the same philosophy.
- **Scheduling impact (`schedulingImpact.ts`, new — quantifies the wedge):**
  `summarizeSchedulingImpact` (pure, unit-tested) + `fetchSchedulingImpact` count completed
  **Tempo-authored** sessions (source `plan`/`quick`/`smart`, deliberately **excluding** the user's
  own `custom`/`split` workouts, so the number only ever credits Tempo's contribution) — making the
  scheduling wedge visible and honest ("Tempo planned & scheduled N of your workouts around your
  week"), with no fabricated "workouts you'd have skipped" guesses. Surfaced as a **Weekly Report**
  card (this-week count, hidden at zero), a personalized **paywall** proof line (all-time count,
  hidden below 3), and — **B1.1, closing the gap to a primary tab** — a **Progress** stat card
  (all-time + this-week, hidden at zero) right after Completion Rate, so the wedge is visible on a
  bottom-tab screen, not only on side screens reached by tapping through. `TEMPO_SCHEDULED_SOURCES`
  is the single source of truth for "by Tempo".
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
  `muscleRecovery` (also feeds Plan's session-card readiness chip — see §3.2), and
  **`muscleIntelligence`** (Body Map: per-group status/recovery/volume-trend + an overall balance
  score, over the coarse `muscle_group` only — no fabricated per-fine-muscle stats). Every output
  ships a human message and honest empty states; no invented numbers. 19 unit tests
  (`__tests__/fitnessInsights.test.ts`). **B5.1:** Progress's
  `ReadinessCard` carries an honest disclosure ("Recovery is estimated from your recent sessions...")
  — "Estimated from your recent training and rest time — not a wearable measurement." The WHOOP-style ring UI otherwise implies a physiological signal
  (sleep/HRV/resting HR) this heuristic doesn't have; the caption makes the actual input honest
  without needing HealthKit (B5.2) to say something true today.
- **Body Intelligence / Muscle Map** (`app/muscle-map.tsx` + `components/MuscleMap.tsx`): a signature,
  **Pro-gated** feature reached from a card in Progress → Coaching. An **anatomically-real** muscular
  figure rendered from `react-native-body-highlighter` (MIT, SVG-only, on top of the already-installed
  `react-native-svg` — JS-only, no rebuild) with tappable, status-coloured muscle zones (green optimal ·
  amber attention · red recovering · purple growing), a **muscle-balance
  score** with per-group bars, per-muscle detail (frequency, weekly sets, recovery %, last trained,
  volume trend + Train/See-progress actions), and auto insights. New Pro id `muscle_intelligence` in
  `proFeatures.ts` (+ a paywall point). **Gating is dormant-safe**: `useProGate().locked` is only true
  once Pro is LIVE and the user isn't subscribed — then free users get a premium *preview* (dimmed map
  + locked detail + a feature-specific "Unlock Muscle Intelligence" upsell); while Pro is dormant
  everyone sees it in full. Three map modes: **Status** (status colours + recovery-% callout bubbles),
  **Heatmap** (7/30/90-day training-stimulus glow), and **Rank** (per-muscle training tier
  Beginner→World Class from `fitnessInsights.muscleRank` — most→least trained, for the "how developed"
  Progress view). (The old **Train → Readiness** segment also embedded this body map — removed along
  with the rest of the segmented control in the 2026-07-16 Plan redesign; Progress's Body
  Intelligence card is now the only surface for it, still **Pro-gated** the same way — free = dimmed
  + a lock overlay, score/ring stays free.) A
  **post-workout teaser** on `workout-complete` surfaces it at a high-intent moment (only when locked).
  `MuscleMap`'s public API (`view` / `statusByGroup` / `heatByGroup` / `rankByGroup` / `mode` /
  `selected` / `onSelect` / `dimmed` / `bubbles` / `size` + the `muscleStatusColor` / `muscleTierColor`
  exports) is unchanged — internally each Tempo group maps to the library's fine muscle slugs per view
  (`GROUP_TO_SLUGS_FRONT/BACK`), colours are computed by the same status/heat/rank engine and passed as
  per-part `color`, and bubble anchors are re-derived from the anatomy path data (centroid per group,
  normalized to the 724×1448 viewBox) so recovery-% / rank callouts still land on the right muscle.
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
  **`activation`** (retention instrumentation — fires the one-time `activation_reached` +
  `calendar_connected` events behind durable per-user flags; analytics-only, see §7),
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
  **`unilateralPrefs`** (new, 2026-07-16/17 — the identical device-local pattern, keyed by
  lowercased/trimmed exercise name instead of workout focus, backing the runner + session-detail's
  "×2 per side" toggle),
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
  **Retention/activation instrumentation (`lib/activation.ts`):** `activation_reached` (fired **once**
  per user when the core loop is proven — a returning 2nd completed session; from `workout-complete`)
  and `calendar_connected` (fired **once** per user+provider the first time a calendar is connected —
  the wedge-adoption signal; from `calendar-setup` for Google + device and Home's device-add path).
  Both are de-duped by durable, per-user, force-close-proof localStorage flags (the same idiom as the
  tutorial + guest-save prompts), so PostHog can build the onboarding→activation funnel and split
  retention by calendar-adopters vs not. Analytics-only — no behavior change; no-ops without a key.
- **Progressive disclosure (B3.2, real behavior — unlike the analytics-only item above):** Social
  (Profile's header Friends icon + its "Social" section, which is also the only entry point to
  Groups) and Muscle Intelligence (Progress's "Body Intelligence" card + `workout-complete`'s
  post-workout teaser) are hidden until a user has **completed** `ACTIVATION_SESSIONS` (2) sessions
  — no network exists yet, so showing empty social surfaces to a day-1 user is overwhelm, not value
  (audit finding). Gated on `stats.totalWorkouts >= ACTIVATION_SESSIONS` — the same live number
  `useProgressStats` already fetches for the level/badges on the same screens — deliberately **not**
  the fire-once `tempo.activated.*` flag in `lib/activation.ts`, which only gets set the moment a
  user crosses the threshold and would read "not activated" (and wrongly hide the feature) for an
  already-engaged existing user whose flag was never retroactively set. The Friends icon has one
  exception: it still shows if there's a real pending friend request or invite, regardless of
  activation — hiding an actual notification would be a regression, not disclosure. Deep links (a
  notification tap routing to `/social`, a group-invite link) are untouched — only the discoverable
  entry points are gated, never the routes themselves.
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
  (`https://u.expo.dev/<projectId>`) + `runtimeVersion.policy: fingerprint`; each `eas.json` build
  profile declares a matching `channel` (`development` / `preview` / `production`). JS/asset-only
  changes ship with `npx eas update --branch <channel> --message "…"` (no rebuild). Native/config
  changes (new modules, plugins, permissions, SDK bumps) still require a full `eas build` + submit.
  - **Why `fingerprint`, not `appVersion` (changed 2026-07-15 after an Android beta crash):** with
    the old `appVersion` policy, runtimeVersion was frozen at `1.0.0`, so an `eas update` that used a
    **native module added after a build** was still delivered to that older binary → it referenced a
    native module that wasn't linked and **crashed on launch** (this is exactly what took down the
    Android closed-test build while iOS — built more recently — was fine). `fingerprint` derives the
    runtimeVersion from a hash of the native project, so an OTA update **only reaches binaries whose
    native layer actually matches** — a native drift now simply means "no update delivered" instead of
    a crash. Trade-off: existing `1.0.0` binaries won't receive fingerprint-targeted updates, so the
    fix is to rebuild + redistribute (which also carries the crash fix). Takes effect on the **next**
    build; in-flight builds are unaffected.
  - **Windows gotcha (`mobile/.gitattributes`, added 2026-07-15):** `@expo/fingerprint` hashes **raw
    file bytes**, so with Git `core.autocrlf=true` on Windows the local working tree (CRLF) hashes
    differently from the committed LF blobs the Linux EAS builder checks out. The two tracked files
    that feed the fingerprint — `.gitignore` and `eas.json` — must stay LF, or `eas build` fails the
    "Configure expo-updates" phase with *"Runtime version calculated on local machine not equal to
    runtime version calculated during build."* `mobile/.gitattributes` pins `eol=lf` on them (and on
    itself) so the hash is identical on both sides. If a **new** tracked file ever starts feeding the
    fingerprint, add it there too.

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
  `ProBadge` gating primitives. **B2.1 re-fenced the gate** (analytics doesn't convert; scheduling
  does): Advanced Analytics (volume trends + strength-trend deep-dive on Progress) is now **free**;
  the **first real gate is "Reschedule my whole week"** (`schedule_optimization`, Home's one-tap
  full-week re-plan — B1.3b) plus the pre-existing Muscle Intelligence gate. The free, always-on
  background auto-scheduler stays free — only the on-demand full re-plan is Pro. The engine stays
  FREE (plan generation, adaptation, quick workouts, logging, ambient scheduling, basic progress) so
  free is fully functional. Dashboard prerequisites: the entitlement
  (`EXPO_PUBLIC_PRO_ENTITLEMENT`, currently `Tempo: Fitness Planner Pro` — must match exactly) +
  monthly ($4.99) / annual ($34.99) products in a **current offering** + Customer Center config; real
  `appl_` key is in `eas.json`. **Fast-follow Pro surfaces** (registry entries already stubbed, each a
  `<ProGate>` wrap away): muscle-group analysis + PR forecasting, long-horizon/goal-date planning,
  premium themes + app icons, and **Tempo Coach** (the tentpole). Migration `add_app_config.sql`.
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
- ~~No automated test suite yet~~ **Started (§4.2/§11.2), extended into integration coverage (B5.5,
  2026-07-16, extended same day)**: Jest + ts-jest, 184 tests across 17 suites. `src/lib/__tests__/`
  covers the deterministic core (periodization — one deload/4 weeks; progression autoregulation +
  duration math + the B5.4 volume-landmark cap; the exercise classifier; streak continuity;
  goal-projection ETAs) and the **`planRollover`** cliff regression (horizon never < 7 days, no
  duplicated/dropped `week_index` — the "4-week plan cliff," one of the audit's three named recurring
  bug classes). `npm test`. Config: `jest.config.js` + `tsconfig.jest.json` (transpile-only via
  ts-jest; the app's own `tsconfig.json` excludes `src/**/__tests__`). **B5.5 added integration-style
  coverage for the other two named bug classes**, via a small purpose-built in-memory fake Supabase
  client (`lib/__tests__/fakeSupabase.ts` — eq/gte/lte/lt/in/or filters + delete/update/insert/
  maybeSingle, NOT a general Postgrest mock) plus `jest.mock()` on any native-module import
  (`expo-notifications`, `expo-web-browser`/`expo-auth-session`, Sentry) so these files can load under
  plain Node: **`retireWorkouts.test.ts`** + **`missedWorkouts.test.ts`** lock the "poisoned Change
  Plan" bug (a stranded `scheduled` row blocking the next plan's insert — the delete-fails-fall-back-
  to-mark path, the FK-safe log-referenced partition, and the ONE shared commitment predicate both
  plan-generation and split-activation must never drift apart on) and
  **`services/googleCalendar/__tests__/CalendarApiService.test.ts`** locks "silent Google vanish"
  (every read-failure reason correctly maps to its fix hint via `describeReadError`, the 401-retry-
  once-then-give-up flow, and the no-token `not_connected` short-circuit). **Same-day extension:**
  **`lib/__tests__/splitSchedule.test.ts`** locks the OTHER caller of the shared sweep —
  `activateSplit` retiring a stranded plan/split row on the SAME date the new split needs before
  materializing it (the exact collision that poisoned Change Plan for the split-activation path, not
  just plan generation), plus `materializeSplit`'s idempotent insert-into-horizon and its refusal to
  ever materialize the auto-plan mirror. Still no real network/DB — these are fakes/mocks, not live
  integration tests — but they exercise the actual Supabase-glue
  code paths the pure-logic suite above deliberately excluded, which is exactly where the named bugs
  actually lived.
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
