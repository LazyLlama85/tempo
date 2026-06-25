# Tempo — System Architecture & Feature Overview

A detailed description of everything Tempo is — frontend, backend, features, data, integrations.

---

## 1. What Tempo is
A **fitness operating system that adapts to your real life**. Instead of a static program, Tempo
generates a periodized training plan, schedules it around your actual calendar, adapts week-to-week
from your performance and recovery, and — the wedge feature — turns any spare 5–60 minutes into a
purposeful **Quick Workout**. One shared promise: *"no matter how busy your day gets, Tempo keeps
you moving."*

- **Platforms:** iOS + Android (Expo/React Native), iOS bundle id `com.tempo.app` / Android package `com.fittempo.app`, v1.0.0. A separate
  static **web** marketing site lives in `web/`.
- **Auth modes:** Apple Sign In, Google OAuth, and guest/anonymous.

---

## 2. Tech stack
- **Mobile app** (`mobile/`): Expo SDK ~56, React Native 0.85, React 19, **expo-router** (file-based
  routing, typed routes, React Compiler on), dark-mode-first design system.
- **Client state:** **zustand** for auth/session (`src/stores/auth.ts`); **TanStack Query** for all
  server data (caching, refetch, error→Sentry funnel).
- **Backend:** **Supabase** — Postgres (with Row-Level Security), Auth, Edge Functions (Deno),
  Storage, and `pg_cron` + `pg_net` for scheduling.
- **Telemetry:** **PostHog** (product analytics) + **Sentry** (crash/error). Both no-op without keys.
- **Fonts/UI:** Inter (`@expo-google-fonts/inter`), `@expo/vector-icons` (Ionicons), `expo-image`,
  `react-native-reanimated`, `react-native-gesture-handler`, `expo-glass-effect`.

---

## 3. Frontend

### 3.1 Navigation & routes (`src/app/`, expo-router)
- **Root** `_layout.tsx`: wraps the app in `QueryClientProvider` + dark `ThemeProvider`, loads
  fonts, initializes analytics + crash reporting, wires the React Query error→`captureApiError`
  funnel, routes notification taps to the right screen, and Sentry-wraps the root.
- **Tabs** `(tabs)/`: **`index`** (Home/Schedule), **`plan`** (active workout runner), **`progress`**,
  **`profile`**.
- **Onboarding stack** `onboarding/`: `goal → experience → equipment → schedule` (connect calendar)
  `→ availability → plan-preview → profile-setup`.
- **Other screens/modals:** `sign-in`, `quick-workout`, `smart-scheduler`, `availability`,
  `travel-mode`, `legal` (Privacy + Terms), `workout-complete`, `weekly-report` (Sunday
  progress recap), `plan-explainer` ("why this week" periodization explanation).

### 3.2 Screen responsibilities
- **Home / Schedule** (`(tabs)/index.tsx`): unified day/week/month calendar; merges plan workouts
  with live device + Google calendar events; readiness ring; **block-phase banner** (where you are
  in the mesocycle); Quick Workout wedge + FAB; missed-workout reschedule; rest-day advice; travel
  banner; "ignore event" to free time; recovery check-in entry.
- **Workout runner** (`(tabs)/plan.tsx`): loads a session, builds per-exercise **prescriptions**
  (autoregulation + periodization + readiness + feedback bias), pre-fills sets, RPE capture, rest
  timer, smart exercise swaps, form guide + exercise GIFs; on finish updates logs, fires adaptation
  re-eval, and routes to the celebration screen.
- **Celebration** (`workout-complete.tsx`): momentum lead (trained-despite-missing / volume vs last
  week / streak), aggressive **PR highlights**, streak/consistency spike, difficulty check-in, share.
- **Weekly Report** (`weekly-report.tsx`): the "am I improving?" recap — workouts vs last week,
  volume %Δ, estimated strength gains, weight trend, consistency, new PRs; shareable.
- **Plan Explainer** (`plan-explainer.tsx`): explains the current mesocycle phase (volume/intensity/
  recovery dials) and when the next deload lands; opened by tapping the Home phase banner.
- **Home** also surfaces a **goal countdown** ("12 weeks to lose 10 lbs"), a rich next-workout empty
  state (never a blank calendar), and a Sun/Mon weekly-report entry.
- **Progress** (`(tabs)/progress.tsx`): stats, PRs, charts/history.
- **Profile** (`(tabs)/profile.tsx`): gaming-style level/XP hero, achievements grid, PRs, **Body
  Stats** (weight + body-fat + waist trends, progress-photo capture), saved exercise swaps, plan
  settings (goal/experience/days/equipment/**injuries**/travel), settings (availability, calendar,
  **notifications toggle**, legal), edit profile, sign out, account deletion.
- **Quick Workout** (`quick-workout.tsx`): pick minutes + focus → generated session with a "why" and
  "why it counts"; one tap to start.
- **Smart Scheduler / Availability / Travel** modals: connect Google Calendar, set
  work/school/sleep/unavailable windows, and a temporary travel-equipment override.
- **workout-complete**: streak/consistency spike, difficulty check-in (feeds adaptation), Wrapped
  share cards.

### 3.3 Components (`src/components/`, ~18)
`EditWorkoutSheet`, `ExerciseFormSheet`, `ExerciseMedia`, `RecoveryCheckIn`, `ShareCardSheet`,
`WrappedCard`, `TimePickerSheet`, `LoadingCard`, `ErrorBanner`, themed primitives, plus a `ui/` set.

### 3.4 Hooks / services / constants / store
- **Hooks:** `useProgressStats` (aggregates stats/PRs), color-scheme/theme hooks.
- **Services:** `calendarService` (device calendar), `calendarSync` (write workouts to a calendar),
  `googleCalendar/` (OAuth + Calendar API + config).
- **Constants:** `theme.ts` (colors, spacing, radius, shadows).
- **Store:** `stores/auth.ts` (session, profile, sign-out; on auth change it identifies the user to
  analytics/crash, registers the push token, sweeps missed workouts, and refreshes adaptation).

### 3.5 Domain logic (`src/lib/`, ~34 modules)
- **Planning & progression:** `generatePlan` (4-week periodized plan from goal/experience/equipment),
  `periodization` (mesocycle: overload weeks + scheduled deload; modes normal/recovery/deload/
  maintenance), `progression` (autoregulated per-exercise load via RPE + rep targets), `adaptation`
  (workout-feel feedback + the engine that flips `adaptation_mode` from real signals and re-stamps
  future weeks).
- **Scheduling:** `quickWorkout` (time-boxed session engine), `quickSuggestion`, `smartSchedule` /
  `autoSchedule` (place workouts around calendar free time), `reschedule`, `dedupeSchedule`,
  `unavailability`, `ignoredEvents`.
- **Recovery & context:** `recovery` (readiness check-ins), `trainingLoad` (rest-day advice),
  `missedWorkouts`, `substitutions` (saved exercise swaps), `travelMode`.
- **Body & progress:** `bodyMeasurements` (history + weight/body-fat/waist trend math),
  `progressPhotos` (image pick + private upload), `wrapped` (share cards: weekly/streak/PR/goal/
  monthVolume/topLifts/weightTrend), `achievements`, `avatar`.
- **Insights & motivation:** `weeklyReport` (the Sunday recap engine — workouts/volume/strength/
  weight/consistency), `prs` (per-session weight/e1rm/rep PR detection), `goalProjection`
  (goal-countdown ETA from weight trend + strength max).
- **Infra:** `supabase` / `supabase.native` (clients), `analytics` (PostHog, typed events),
  `crashReporting` (Sentry), `pushTokens` (register/enable device push), `notifications` (local
  pre-workout reminder), `exerciseGif` (RapidAPI media), `account` (delete), `types` (domain types).

---

## 4. Backend (Supabase — live project `rtoahppnekykgmjukujm`)

### 4.1 Tables (~16, all with RLS scoping rows to the owner)
- **user_profiles** — goal, experience, equipment, days/week, availability (wake/bed/work/school,
  preferred time, flexibility, training days, unavailable blocks), `bodyweight_lbs` cache,
  `injuries`, `travel_mode`, `ignored_events`, calendar prefs.
- **programs** / **exercises** — program templates + the exercise library (incl. a **mobility**
  movement pattern with real stretch/mobility moves).
- **user_plans** — the active plan: program, dates, `current_week`, `adaptation_mode`, status.
- **scheduled_workouts** — every planned/quick/smart session: date/time, focus, `exercise_ids`,
  status, calendar link, `source`, **`week_index` + `progression`** (periodization directive).
- **workout_logs** / **set_logs** — actual sessions and per-set reps/weight/RPE.
- **adaptation_events** — audit of feedback + auto-periodization decisions.
- **exercise_substitutions** — saved per-user swaps.
- **calendar_connections** / **google_calendar_tokens** — calendar linkage (Google refresh token is
  service-role-only).
- **body_measurements** — time-series weight / body-fat % / waist / progress-photo path.
- **device_tokens** — Expo push tokens per device (`enabled` flag).
- **notification_log** — every retention push attempt (status/error/ticket) for debugging + analytics.
- **waitlist** — marketing capture.

### 4.2 Edge Functions (Deno)
- **delete-account** — App-Store-required full account + data wipe (service role, JWT-scoped to caller).
- **google-calendar-token** — securely stores/uses the user's Google refresh token server-side.
- **retention-push** — the server-driven retention engine: evaluates per-user rules (**weekly_report**
  on Sunday evenings, missed workout, streak-at-risk, free-time gap, reactivation), sends via the Expo
  Push API in batches, logs every send, and disables dead tokens.

### 4.3 Scheduling & storage
- **pg_cron** job `retention-push-hourly` invokes `retention-push` every hour (via `pg_net`).
- **Storage:** private **`progress-photos`** bucket with per-user-folder RLS.
- **Migrations:** SQL files in `mobile/supabase/` (`schema.sql`, `seed_*`, and incremental `add_*`
  migrations) — all applied to the live project.

---

## 5. Integrations
- **Google Calendar** (OAuth via `expo-auth-session` + the token edge function) and **device
  calendar** (`expo-calendar`) — Tempo reads busy times to schedule around real life.
- **Auth:** Apple (`expo-apple-authentication`), Google, guest (Supabase anonymous).
- **Push:** Expo Push API (server-driven) + local `expo-notifications` for the 30-min pre-workout
  reminder.
- **Media:** RapidAPI exercise-GIF service (`exerciseGif`, key via `EXPO_PUBLIC_RAPIDAPI_KEY`) for
  most movements, plus **bundled local form GIFs** (`mobile/assets/exercise-gifs/`, wired in
  `src/data/exerciseMedia.ts` → `getLocalExerciseGif`) for the 8 the remote library lacked.
- **Analytics/crash:** PostHog + Sentry.

---

## 6. Key flows
1. **Onboarding → plan:** capture goal/experience/equipment/calendar/availability → `generatePlan`
   builds a periodized 4-week plan → auto-scheduled around the calendar → reminders set.
2. **Daily home:** unified schedule + readiness + block-phase + Quick Workout wedge.
3. **Run a workout:** prescriptions blend reactive autoregulation with the week's periodization; RPE
   logged per set; completion updates streak/consistency and re-evaluates `adaptation_mode`.
4. **Quick Workout:** minutes + focus → highest-impact session that fits, persisted as today's session.
5. **Adapt:** missed sessions / "too hard" feedback flip the plan into recovery/deload and re-stamp
   future weeks.
6. **Retention loop:** hourly cron → `retention-push` → targeted nudges → deep-link back into the app.
7. **Body tracking:** log weight/body-fat/waist (+ optional photo) → trend feedback on Profile.
8. **Weekly recap:** Sunday-evening push + Home card → Weekly Report (improvement scorecard) → share.
9. **Motivation surfaces:** momentum celebration + PR highlights after each session; goal countdown
   and rich next-workout empty state on Home; tap the phase banner for the plan explanation.

---

## 7. Telemetry, privacy, store-readiness
- **Analytics events:** `app_open`, signup/login, `onboarding_complete`, `session_start/end`,
  quick-workout generated, workout feedback, share-card opened — with platform + app-version props.
- **Privacy/compliance:** in-app Privacy Policy + Terms (`legal.tsx`), in-app **account deletion**
  (App Store Guideline 5.1.1(v)), per-user RLS everywhere, Google token kept server-side only.
- **Store assets:** app icon, splash, Android adaptive icons present; `app.json` carries permission
  strings + export-compliance flag; `eas.json` has build env + submit scaffold; launch steps in
  `LAUNCH.md`.

---

## 8. Known gaps / roadmap
- Free-time-gap push uses a daytime heuristic (true calendar free/busy needs backend calendar sync).
- Progress-photo gallery / before-after compare (capture + storage exist; no timeline UI yet).
- HealthKit / Google Fit import; Apple Watch.
- No automated test suite yet (pure logic is structured for it).

---

*See also `LAUNCH.md` (iOS/Android launch guide) and `CLAUDE.md` (build/run + project conventions).*
