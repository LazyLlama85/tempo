# Tempo — Execution Status (the living ledger)

> **READ THIS FIRST every session. UPDATE IT LAST every session.**
> Plan + workflow + prompts: `EXECUTION.md`. Diagnosis + scores: `PRODUCT_AUDIT.html`.
> Status legend: 🔲 Not Started · 🔄 In Progress · ✅ Completed · 🔍 Needs Review (on-device) · ⏸ Postponed · ❌ Rejected
>
> **Compacted 2026-07-17** (Phase 9 re-review): this file had grown into a second audit document —
> Current Focus alone was ~30 dense paragraphs. Compacted to the ledger (facts, unchanged) + a tight
> Current Focus (state, not narrative) + a condensed Session Log (one line per session before
> 2026-07-17; full prose for anything still open). Nothing is lost — `git log` has every commit
> message this used to duplicate, and `ARCHITECTURE.md` has the technical detail.

---

## ▶ CURRENT FOCUS *(the resume point)*

- **NEW (2026-07-20/21): the founder device-testing/bug queue is worked through — 12 fixes, each
  its own commit, `tsc` clean and the full suite green (255/255) throughout.** In order: (1)
  `lib/purchases.ts` no longer loads RevenueCat's native SDK on the web platform target — it was
  throwing "Invalid API key. Use your Web Billing API key." because the configured key is a mobile
  App Store/Play key and Tempo has no Web Billing product; every downstream call already no-ops on
  `!Purchases`, so skipping the load entirely on web was the whole fix. (2)–(5) `FocusMode.tsx`: the
  quick-edit save button's checkmark (read as a confusing second "confirm") is now a pencil, matching
  the runner list's own established icon language; "ALL DONE" used to be a dead disabled button and
  now closes into the runner's full exercise list; the per-set button reads "DONE WITH SET" instead
  of bare "DONE"; the running-coach Lottie box was enlarged (checked its aspect ratio against all 5
  other coach poses in the app — it already exactly matched the source asset's own ratio, so the
  clipping is baked into that specific free asset's mid-stride content, not a sizing bug — a real fix
  means swapping the asset). (6) `GoChooserSheet`/`TempoTabBar.tsx`: GO now always opens the
  today's-session-vs-Quick-Workout chooser, greying "TODAY'S PLAN" with why ("Complete — nice work" /
  "No session scheduled today") instead of silently auto-generating a Quick Workout when nothing was
  due — removed the now-dead instant-generate branch entirely. (7) Confirmed via direct SQL that 1285
  of 1297 imported exercises have no local "how to" instructions (matches the founder's report); added
  a `SECURITY DEFINER` RPC (`save_exercise_instructions`) so a successful live ExerciseDB fetch now
  persists back to the row instead of living only in an in-memory `Map` — every real view of a missing
  exercise closes that gap permanently, for everyone, compounding with (not duplicating) the founder's
  monthly batch-backfill script. Also fixed Pendulum Squat's genuine data gap (empty instructions AND
  empty `primary_muscles`). (8)–(9) A second scheduled workout on the same day was invisible on Home
  (no edit action on the non-hero card) and silently dropped entirely from Plan tab's day-detail card
  (`calWorkoutsByDate[date]?.[0]` discarded anything past the first) — both now show and let you edit
  every workout on the day. (10) Added real permanent exercise deletion from inside a live session:
  `user_profiles.excluded_exercise_ids`, checked by `generatePlan`, `quickWorkout`, and
  `splitSchedule`'s materialization (filters the split day's chosen `exercise_ids` before insert — the
  split's own saved JSON is never rewritten) via one shared helper (`lib/exerciseExclusions.ts`),
  enforced uniformly regardless of which system generated the session. (11) A new Pro
  `plate_calculator` gate (`lib/plateCalc.ts` + `components/PlateCalcSheet.tsx`) — greedy
  largest-first plate math, reached from the runner's per-exercise menu, pre-filled with the
  exercise's suggested weight. (12) Two founder questions resolved with **zero code work needed**:
  weekly-report push (`retention-push`'s `weekly_report` rule, Sunday evening, trained-this-week
  gated) is already fully wired AND confirmed LIVE — the `retention-push-hourly` pg_cron job is
  `active:true` and other push types have real delivered timestamps in `notification_log` (this
  ledger's earlier "cron SQL still commented out" status was stale — someone applied it since, likely
  around the TestFlight submission); multi-calendar's OAuth scope is confirmed live in
  `services/googleCalendar/config.ts` and the picker's error handling is complete — the only
  remaining step is an already-connected account reconnecting Google once to pick up the broader
  scope, which is an account action, not a code task. Full detail in `MASTER_FIX_PLAN.md`'s C3
  addendum and `PRODUCT_AUDIT.html`'s Update Log.
  **P1 (C4–C10) resumes next** — C4 is the accessibility batch.

- **NEW (2026-07-21): Quick Workout redesigned** (founder chose this as the next priority over
  Splits/Feed). Replaced 8 duration chips with one `Slider` (snaps to `QUICK_DURATIONS`); replaced
  the Push/Pull/Core/Legs/Cardio "Target Area" chips (movement-pattern jargon) with real body parts
  — Arms/Chest/Back/Shoulders/Legs/Core/Cardio — backed by a genuine muscle-group hard-filter
  (`targetMuscles` on `QuickContext`, grounded in the live `exercises.primary_muscles` vocabulary),
  not just a priority nudge; falls back to the unfiltered pool if a muscle group yields nothing.
  Training style + Equipment moved behind one "More options" disclosure. **The generated-workout
  preview card (title, "why," exercise list, "why it counts") is removed entirely** — explicitly
  confirmed with the founder first, since it's a real behavior change, not just decluttering: Start
  now goes straight into the runner, which already has full swap/skip/remove tools the read-only
  preview never had. `tsc` clean, full suite green (258/258, +3 new). Full detail in
  `ARCHITECTURE.md`'s Quick Workout entry.

- **2026-07-19: C2 (theme sweep) is done — the second P1 batch.** Built a shared
  `components/PRCard.tsx` (themed via `C.gold`/`C.onPrimary`, `variant="hero"` animated for
  `workout-complete.tsx`, `variant="compact"` static for `session-detail.tsx`) and replaced both
  files' duplicated, hardcoded `#B8860B` gold-card blocks with it — the bug was real: `#B8860B`
  doesn't adapt to the light "Paper" theme, rendering as a muddy dark gold. Also fixed
  `workout-complete.tsx`'s two `shadowColor: '#4E8BFF'` shadows to `C.primary` and its opaque
  `'#fff'` text/icons on brand-colored cards to `C.onPrimary` (left the established
  `rgba(255,255,255,x)` partial-opacity overlays alone — that pattern is already used the same way
  in 10+ other files, not a theme bug). Removed the dead `Colors` import from 14 files and dead
  `header`/`headerTitle`/`iconBtn` StyleSheet leftovers (from the earlier `ScreenHeader` migration)
  from 20 files — confirmed every removal was genuinely unused (grepped for `styles.header`-style
  references) before deleting, not a blind sweep. `tsc` clean, full suite green (245/245).
  **Next up: C3 (shared ProPill + unified loading component)** through C10 (dependency hygiene) —
  see `MASTER_FIX_PLAN.md`'s P1 section, each with its own Sonnet prompt.

- **2026-07-19: C1 (shared date utilities) is also done — the first P1 batch.**
  Added `lib/dates.ts` (DST-safe, local-time `todayStr`/`toDateStr`/`addDays`/`daysBetween`/
  `atMinute`) and migrated 18 modules that each had their own duplicate date-string helper,
  finding two real bugs along the way (not just duplication): `adaptation.ts`'s `weeksBetween`
  parsed dates as UTC while everything else is local; `social.ts`'s `syncSocialOnOpen` and
  `fetchFriendOverview` both computed "today" via `.toISOString().slice(0,10)` (UTC), which could
  misjudge a streak a day early for users behind UTC. `tsc` clean, full suite green (245/245).
  **Next up: C2 (theme sweep) through C10 (dependency hygiene)** — see `MASTER_FIX_PLAN.md`'s P1
  section, each with its own Sonnet prompt.

- **2026-07-19: `MASTER_FIX_PLAN.md`'s entire P0 (F1–F10) is done — 10 batches, each
  its own commit, `tsc` clean and the full suite green (237 tests) throughout.** In order: F1 fixed
  the plan-cliff bug (`week_offset` column, per-row rollover inserts) and F5 fixed the app-open race
  that caused it (removed the racing sweep from the auth listener, consolidated into one documented
  sequence in Home); F4 widened cache invalidation after that same sweep; F2 made all-day calendar
  events (vacation/flights/OOO) actually block auto-scheduling; F3 fixed five silent-write-failure
  sites (reschedule, experience promotion, adaptation restamp, quick-workout plan-move, auto-
  scheduler); F6 fixed split-users never triggering adaptation and the muscle-classifier substring
  bug (lateral delts/abductors double-tagged); F7 swept six screens' error states (weekly-report's
  infinite spinner, shared-workout's misleading "not found," social/my-workouts/group-detail's
  silent-empty failures) plus the GO button's stale-data race; F8 added the app's first-ever
  ErrorBoundary (previously a render crash was a blank white screen with no recovery); F9a made a
  RevenueCat entitlement-ID mismatch report itself loudly instead of forever looking like low
  conversion (F9b investigated and correctly NOT changed — the "unused" RapidAPI key is actually
  still load-bearing for 641 uncached exercises); F10 applied 4 backend migrations (hot-path
  indexes, tightened `workout_shares` RLS to owner-only + a SECURITY DEFINER RPC for the share-by-
  code lookup — verified live against the database before considering it done, dropped the fully-
  dead `calendar_connections` table, added `user_profiles.timezone` so retention-push judges
  "evening" against each user's real local time instead of the server's UTC clock) and redeployed
  the `retention-push` edge function. Full detail + exact files in `MASTER_FIX_PLAN.md` (each F
  section now marked ✅ DONE). **P0 is clear — P1 (craft/coherence, C1–C10) is next.**

- **2026-07-19, later: founder device-testing batch, mostly Focus Mode — 10 real fixes shipped,
  4 items flagged for a follow-up decision.** The founder tested the app and reported a dense list of
  issues, most concentrated in Focus Mode (unreachable buttons once the "how much did you do?" card
  appeared — no ScrollView existed; no RPE prompt; the auto-close effect closed the instant an
  exercise's LAST set logged, before rest/RPE/weight-entry ever got a chance to render for it — the
  same bug behind "abrupt switching"; a dead rest-timer-ring tap target; a confusing double-checkmark
  edit affordance) plus several across Home/Quick Workout/search/progression (no "Continue" copy for a
  paused session; an awkward empty dock notch when GO hides; no "Core" option in Quick Workout;
  "inner thigh" search not matching "hip adductor"; calf raises getting the same generic rep default
  as everything else). All fixed, each its own commit, `tsc` + full suite green throughout (218 tests).
  Full detail + what's still open (drag-to-reorder, a first-workout rest-time prompt, whether
  swap/remove should sync to the split like Add already does, a swipe-animation nice-to-have) is in
  `MASTER_FIX_PLAN.md`'s "2026-07-19 addendum" section — **read that before starting the next session**,
  since it names concrete next steps for the open items rather than leaving them vague. None of this
  touched the P0 ship-blockers (F1-F10) below — do those next, in order.

- **2026-07-19: a full codebase review produced `MASTER_FIX_PLAN.md` — execute its P0
  ship-blockers next, in order (F1→ F10).** A complete read of every screen, every domain-logic
  module, and the full platform layer (requested as "go through the product, treat today as publish
  day") found real, concrete defects independent of the M0-M6 strategy ledger below: a plan-generation
  bug (`week_index` overloaded to mean two things) that can silently empty a paying user's schedule;
  all-day calendar events not blocking auto-scheduling; five silent-write-failure sites; a likely
  RevenueCat entitlement-ID mismatch (paying users may never unlock Pro); a leaked RapidAPI key; no
  crash-fallback UI; no offline write queue; and a long tail of craft/accessibility/architecture debt
  (full detail + file:line refs in `MASTER_FIX_PLAN.md`). `PRODUCT_AUDIT.html` is re-scored to match —
  split into a **Product Score** (5.9/10, potential 8.2 — delivered quality) and a **Market Proof
  Score** (4.3/10, potential 7.8 — retention/conversion/PMF, unchanged), with 9 scorecard rows moved
  down on this session's newly-found evidence. **Next session's work is `MASTER_FIX_PLAN.md`'s P0
  batches (F1–F10), one at a time, each with its own copy-paste Sonnet prompt** — this takes priority
  over the M0-M6 ledger below until P0 is clear, since these are correctness bugs, not strategy bets.
  No app code was changed in this session — it was diagnosis + planning only.

- **Milestone:** M0 nearly closed (Google Calendar's root-cause reliability issue is fixed;
  retention instrumentation is the one real gap left). M1–M3's Claude-buildable scope is essentially
  **done** — the bottleneck has moved from "what to build" to **"verify what's built, then measure
  it."** See `EXECUTION.md` §1 for the redirected vital-few list.

- **NEW (2026-07-17): Google Calendar is approved for production.** This resolves the single
  most-cited reliability risk in `PRODUCT_AUDIT.html` — the OAuth app being stuck in "Testing" status
  auto-expired refresh tokens every 7 days, silently vanishing events. That root cause is gone.
  **B0.2 → ✅.** Still open: a real, time-based on-device confirmation that a connection now survives
  past 7 days (the fix removes the *cause*; nobody has watched a connection outlive a week yet). This
  also clears B1.5's (multi-calendar) sequencing gate — see `EXECUTION.md` §5.

- **2026-07-17: B1.5 (multi-calendar) built end-to-end, dormant.** The only item on the redirected
  vital-few list that was actually Claude-buildable (everything else is founder-only: PostHog funnel,
  on-device verification, pricing/trial, App Store listing). Code is done and verified
  (`tsc`+jest green); it stays inert until the founder adds the OAuth scope — see the B1.5 row below.

- **2026-07-17: four real bugs found via founder feedback + fixed, code-verified.** (1) **Days Per
  Week** was read-only, forcing the full "Change Plan" regen for even this one number — which, for a
  user on their OWN custom split, silently discarded it for a fresh Tempo-generated plan as a side
  effect. Now an independent field save (no restamp, no split/plan touch), matching Goal/Experience;
  Home's d30 "Review Plan" reactivation nudge (which had the exact same silent-switch risk with zero
  warning) now shows the same "this will replace your plan" confirm Profile's Change Plan already had.
  (2) **Streak zeroed mid-day**: swapping today's session to a Quick Workout (or any same-day skip)
  marked the original row `'skipped'` immediately, and `sessionStreak` treated that as a settled break
  instantly — before the replacement session was even started. Fixed: a miss/skip only breaks the
  streak once that day is genuinely in the past; today's own is judged tomorrow. (3) **Goal ETA chip**
  — when collapsed to a chip, tapping it dumped the user on the Progress tab, which has zero
  goal-projection UI (its top section is the unrelated Momentum card) — a real dead end, not a partial
  fix. Now opens the actual projection content (headline/sub/progress bar) in a sheet directly.
  (4) **GO tab button re-scoped**: used to always open the full Quick Workout picker+preview. Now
  checks today's schedule first — a still-due session wins outright (straight into the runner, no
  picker, no preview); only a genuinely rest/all-done day falls back to Quick Workout, and even then
  starts a sensibly-defaulted session immediately rather than showing the picker. `tsc` clean, full
  suite green (211/211, +2 from updated streak-behavior tests).

- **2026-07-17: critical fix — analytics had never actually been flowing.** `EXPO_PUBLIC_POSTHOG_KEY`
  was never set anywhere (not `eas.json`, not `.env.local`) — B0.1's ✅ was wrong; every `track()` call
  in the app had been a silent no-op in every build ever shipped. Fixed the key wiring, and — using
  the newly-connected PostHog MCP — built the B0.3 funnel + retention insights ahead of time on a new
  "Tempo — Activation & Retention" dashboard (id 1865254), empty until the next real build ships.
  Also added Focus Mode weight/reps logging during rest (founder ask) — see `ARCHITECTURE.md`.

- **2026-07-17: full "First-Launch Perfection" plan executed (8 batches) — onboarding + first
  experience, audit-driven, M4 freeze respected throughout (no new feature surfaces; monetization
  config deliberately untouched per the founder's own instruction to wait a month).** (1) Per-step
  onboarding funnel analytics — previously only `onboarding_complete` fired, zero visibility into
  drop-off. (2) Removed the redundant `/welcome` screen — the plan used to get "revealed" twice in a
  row. (3) **The core fix**: the reveal's "Already on your calendar" title was literally untrue for
  anyone who hadn't connected one (calendar connect isn't in onboarding's required path) — now
  honest, conditional copy plus an optional, skippable calendar tap-in right at the aha moment
  (reuses `calendar-setup.tsx`'s exact connect/error code, now shared via
  `services/googleCalendar/connectErrors.ts`). Also fixed sign-in's generic tagline to state the
  actual differentiator. (4) Badges + Progress's full dashboard now gate on `ACTIVATION_SESSIONS`
  (two named first-week-overwhelm residuals the earlier B3.2 batch missed). (5) Accessibility pass
  (RPE chips, onboarding chips, Focus Mode's rest ring, Dynamic Type caps) + `BottomTabInset`
  consistency; contrast-checked `outline`'s token (fails strict body-text AA, documented not
  changed). (6) A Home chip surfaces recent adaptation mode changes (missing-feature #15, was
  "partial"). (7) Drafted `APP_STORE_LISTING.md` + `ACTIVATION_DEFINITION.md` — founder-unblock
  documents executing the audit's own §16 prescription and B0.3's missing written definition.
  (8) This entry. `tsc` clean, full suite green (211/211) after every single batch, 7 scoped commits.
  **All held at code-verified** — none of this has touched a real device yet, same discipline as
  every other batch this session.

- **Founder's critical path this week:**
  1. **Ship a build with the new PostHog key** (preview or production — either wires up real data)
     — the single fastest way to unblock every M4 decision now that the funnel/retention insights
     are already waiting. `ACTIVATION_DEFINITION.md` is drafted for sign-off — the one open call in
     it (should activation gain a time window) is genuinely the founder's to make.
  2. **On-device test the built-but-unverified backlog** (below, now larger by one more batch) —
     this is the bigger blocker than any remaining code.
  3. **B2.3** (pricing/trial in RevenueCat, deliberately not touched this session per explicit
     instruction) and **B6.1** (App Store listing — `APP_STORE_LISTING.md` is drafted and ready to
     paste; someone still needs to take the actual screenshots) — founder-only, unblocked.

- **🔁 RECURRING (monthly, founder-only): exercise GIF/instructions backfill.** `scripts/backfill-exercise-media.mjs`
  caches each exercise's GIF + instructions from RapidAPI's ExerciseDB into Tempo's own public Supabase
  Storage bucket (`exercise-gifs`) — a ONE-TIME fetch per exercise; production never calls RapidAPI
  live once cached (confirmed: the bucket's RLS-safe, publicly-readable, and the app's
  `getExerciseGifSource` reads only from it — see `ARCHITECTURE.md`'s exercise-media section).
  **First real run executed 2026-07-17**: 688 GIFs cached (0 failures) before hitting the monthly
  RapidAPI quota — confirmed live in `storage.objects` (688 rows in the `exercise-gifs` bucket).
  This resolves the earlier discrepancy: the founder's "quota already exhausted" report did not
  match what was actually available on the key wired into `mobile/.env.local` — the live quota
  check (688/690 remaining) was correct, and the run consumed exactly that. 641 GIFs remain
  (script prioritizes curated originals → `is_core` movements first, so this first run's 688
  landed the highest-value exercises); 0/1,285 instruction sets backfilled yet — the GIF loop runs
  first and consumed the whole quota before the instructions loop ever started. **Note the bucket
  requires the `service_role` key to write** (verified via `pg_policies` on `storage.objects`:
  `exercise-gifs` has only a public-SELECT policy, no INSERT policy for `anon`/`authenticated`) —
  there is no lower-privilege workaround; re-running this script will always need that key. Re-run
  next billing cycle (and each month after) with:
  `$env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/backfill-exercise-media.mjs` from `mobile/`
  (service_role key from Supabase dashboard → Project Settings → API — never commit it) until the
  script reports nothing left to do. **Also considered and rejected:** `edb-with-videos-and-images-by-ascendapi`
  (a different RapidAPI product, richer data — real video, multi-res images, tips/variations) — its
  full-catalog paid tier tops out at 500 exercises, well short of the ~1,297 needed, so it's not a
  viable primary source; the free-exercise-db public-domain dataset (873 exercises, static images, MIT
  license, zero rate limit) was also considered as a supplement but not pursued — different id scheme
  (name-slugs) would need per-exercise name-matching with real wrong-exercise risk, and it still falls
  ~420 exercises short on its own.

- **✅ Confirmed on-device (founder-tested, 2026-07-17):** Home (hierarchy pass, timeline rail fade,
  Session Complete screen, bottom stats), Settings/Profile split, editable completed sets +
  unilateral-weight toggle. These close their respective ledger rows for real, not just
  code-verified.

- **🔍 Built, needs an on-device pass (nothing here can close without it):**
  - **Focus Mode** (full-screen active-set/rest-timer view) — explicitly deferred by the founder
    ("I will test focus mode later").
  - **Onboarding rebuild** — 6 lighter screens (`goal→schedule→sleep→work-school→train-time→
    plan-preview`), vertical experience picker (no preview card), a real progress-ring "Personalizing
    your plan…" screen, an optional cardio question, a build-your-own-vs-guided branch, a real
    drag-to-set weight slider. **Extended 2026-07-17:** single reveal (no more duplicate `/welcome`
    screen), honest reveal copy + optional calendar tap-in, per-step funnel analytics, badges/Progress
    activation gating, an accessibility pass, and a Home adaptation chip — see the same day's Update
    Log entry in `PRODUCT_AUDIT.html` for the full breakdown.
  - **Interactive Plan tour** (`plan_tour`, the second spotlight tutorial).
  - **Feed button** (Phase 8 — replaces Home's recovery-check-in ring; recovery check-in relocated
    into the hero's readiness row).
  - **7 Home/Progress fixes** — streak shown muted-not-broken before today's session lands; rest-day
    advice re-tuned (6-day threshold, never nags on a day already scheduled); the 3-day workout
    forecast removed outright; Body Intelligence shown inline (not behind a tap); a new Progress
    Photos gallery; a real dead-code fix (the readiness chip was computed but never rendered); the
    "Goal ETA" banner no longer shows with no real ETA, and a real rendering bug (the whole
    context-chip row silently hiding on days with no banner-eligible item) is fixed.
  - **Two real bugs, fixed + regression-tested:** the Settings modal not dismissing on sign-out/
    delete-account; a signup/split-build later in the day getting a same-day session dated in an
    already-passed window (both `generatePlan.ts` and `splitSchedule.ts`).

- **On-device checklist** (covers everything 🔍 above): delete a split day → reschedule-week/"Add it
  back" restores it; connect/reconnect a calendar → Home updates without a force-quit; complete
  today's only session → Home + Plan both read as done; edit a logged set in the runner AND
  `session-detail` → volume/PR numbers update; toggle "×2 per side" → stored total is correct; start
  a live session → GO tab button disappears, Focus Mode opens on rest, ring/adjust/Skip/Done work,
  every existing runner control still reachable; go through onboarding fresh (does the slider feel
  right, does cardio show up in a generated week, does "build my own" land cleanly in split-editor);
  visit Plan for the first time → tour fires once; tap the Feed button → badge count looks right,
  every row's tap does the right thing, check-in is still discoverable; a rest day → streak reads
  correctly, Body Intelligence shows inline, Progress Photos gallery has real photos in order.

- **Deferred, not forgotten:** equipment personalization images (asset/illustration work — explicitly
  lower-value, its own follow-up); a literal separate "personalizing your plan" screen (superseded —
  the progress-ring screen already covers this); the broader "~30 routes" IA cut beyond Settings/Plan
  (needs the founder's per-screen judgment, not a unilateral cut); B4.x (accountability loop,
  referral) and Tempo Coach — all correctly blocked by the M4 freeze until B0.3 has real data.

- **Last updated:** 2026-07-19

---

## Ledger — every audit recommendation, tracked

Each row names the **metric it moves** (per EXECUTION.md §9 — a batch that moves no metric gets cut).

### M0 — Measurable & Reliable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B0.1 | Retention instrumentation (`activation_reached` + `calendar_connected`) | 🔍 | Measurability | `lib/activation.ts`, `analytics.ts` | **Correction 2026-07-17:** the ✅ here was wrong — `EXPO_PUBLIC_POSTHOG_KEY` had never been set anywhere (not `eas.json`, not `.env.local`), so every `track()` call, including these, had been a silent no-op in every build ever shipped. Fixed: real key wired into both EAS profiles + `.env.local`. Events fire correctly in code (unchanged); held at 🔍 until a real build actually ships and PostHog shows a non-zero event count |
| B0.2 | Google OAuth → Production + fix "connects but no events" | ✅ | Reliability, Trust | `CalendarApiService.describeReadError` (in-app diagnostic) | **Done 2026-07-17** — Google approved the app for production, removing the Testing-mode 7-day token-expiry root cause. 🔍 needs a real >7-day on-device confirmation to fully close M0's own criterion |
| B0.3 | PostHog funnel + written activation definition | 🔍 | Measurability | PostHog dashboard "Tempo — Activation & Retention" (id 1865254); `ACTIVATION_DEFINITION.md` | **Funnel + retention insights built 2026-07-17** (onboarding_complete→activation_reached funnel; D-by-D retention anchored on activation_reached→app_open) — both currently empty pending B0.1's fix actually shipping in a build. Per-step onboarding funnel analytics added same day (`onboarding_step_completed`). `ACTIVATION_DEFINITION.md` drafted 2026-07-17 (proposes keeping the existing 2-session, no-time-window definition + tracking calendar-connected as a cohort split, not a gate) — awaiting founder sign-off, one open decision named in the doc |
| B0.4 | Feature-freeze policy (no new surfaces until M4) | ✅ | Focus | `EXECUTION.md` §1/§9 | Written + in effect; re-affirmed 2026-07-17 |
| B0.5 | Device-matrix QA of redesign; fix any blank-render | 🔍 partial | Reliability, Polish | Real device *(founder)* | Home/Settings/editable-sets confirmed; Focus Mode/onboarding/Plan-tour/Feed button not yet |

### M1 — The Wedge, Undeniable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B1.1 | Wedge quantifier (`schedulingImpact`) | ✅ | Value Prop, Differentiation | `lib/schedulingImpact.ts` → Weekly Report + paywall + Progress | Stat card visible on a primary tab, not just side screens |
| B1.2 | Calendar day-timeline — Home hero | ✅ | Differentiation, UX, Activation | `lib/dayTimeline.ts`, `components/DayTimeline.tsx`, `(tabs)/index.tsx` | **Confirmed on-device 2026-07-17** ("looks good") — the founder's own hierarchy-pass rebuild (display/action split, rail fade, Session Complete, bottom stats), after two earlier superseded designs |
| — | IA cleanup: Train → Plan (segmented hub → calendar + split + library) | 🔍 | UX, Focus (audit §06 IA overload) | `(tabs)/plan.tsx` | Built same batch as B1.2; Home's confirmation covers the shared redesign work but Plan-specific flows (week/month toggle, day-tap, split-edit) weren't separately called out — treat as likely-fine, not proven |
| B1.3 | "Reschedule my whole week" — engine + UI | ✅ | Subscription Value, Retention | `lib/weekReschedule.ts`, `reschedule.ts`, `(tabs)/index.tsx`/`plan.tsx` | Confirmed via web test; Pro-gated (B2.1) |
| B1.4 | "Lacking time? 15-min swap" on Home | ✅ *(pre-existing)* | Retention (busy persona) | `lib/quickSuggestion.ts` → Quick Workout | Already covered free-gap/missed/restart triggers |
| B1.5 | Multi-calendar: read/select beyond `primary` | 🔍 **code live, needs device test** | Differentiation, Trust; Pro gate | — scope added by founder 2026-07-18; needs a reconnect-and-test pass | **2026-07-17: full stack built** — `selected_google_calendar_ids` column (applied), `fetchCalendarList`/multi-id `fetchUserBusySlots`/`fetchUserEvents` (best-effort per-calendar), `calendar-picker.tsx` (Pro-gated "Choose calendars"), threaded through `autoSchedule`/`reschedule`'s `gatherBusy()` + Home's timeline. **2026-07-18: OAuth scope enabled** — founder added `calendar.calendarlist.readonly` in Google Cloud Console; `config.ts` scope uncommented, so `fetchCalendarList()` + the picker now work (OTA — no rebuild). **Founder's turn:** reconnect Google once (existing tokens can't self-broaden scope), then test the picker end-to-end; if Google shows an "unverified app" screen, finish scope verification in the console |

### M2 — It Sells Itself
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B2.1 | Re-fence Pro: free analytics, gate scheduling | ✅ | Conversion ×3–4 | `(tabs)/progress.tsx`, `paywall.tsx`, `lib/proFeatures.ts` | Analytics free; reschedule-week + Travel Mode Pro-gated |
| B2.2 | Paywall triggers at the payable moment | 🔍 partial | Conversion | reschedule-week ✅; 2nd-calendar trigger waits on B1.5 | Fires at the wedge action, not a random 1st workout |
| B2.3 | Pricing raise + trial config | 🔲 | ARPU | RevenueCat dashboard *(founder)* | Annual ~$49–59; 7-day trial; annual default |

### M3 — Week One Doesn't Bleed
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B3.1 | Plain-language copy sweep | ✅ | Beginner activation | `onboarding/goal.tsx`, `paywall.tsx` | First-run jargon-free |
| B3.2 | Progressive disclosure (hide social/groups/map pre-activation) | ✅ | Week-1 retention | `(tabs)/profile.tsx`, `progress.tsx` | Confirmed on-device |
| B3.3 | Onboarding aha + time-budget question | 🔍 *(superseded/extended)* | Activation | `onboarding/*` — now 6 screens | Original build done; then fully re-cut (see Phase 7 below) after founder testing. Not yet device-tested in its current form |
| — | Settings/Profile split | ✅ | UX, Focus | `app/settings.tsx` (new), `(tabs)/profile.tsx` | **Confirmed on-device 2026-07-17** |
| — | Editable completed sets + unilateral weight | ✅ | Workout Experience | `(tabs)/plan.tsx`, `session-detail.tsx`, `lib/unilateralPrefs.ts` | **Confirmed on-device 2026-07-17** |
| — | Onboarding rebuild (6 screens, vertical experience picker, progress ring, cardio Q, build-your-own branch, weight slider) | 🔍 | Onboarding, Beginner Friendliness | `onboarding/goal.tsx`/`schedule.tsx`/`sleep.tsx`/`work-school.tsx`/`train-time.tsx`/`plan-preview.tsx` | Built across two founder-testing rounds 2026-07-17; not yet device-tested |
| — | Interactive Plan tour | 🔍 | Onboarding, Discoverability | `lib/tutorial.ts` (`T.planTour`), `(tabs)/plan.tsx` | Built 2026-07-17; not yet device-tested |
| — | Active-session Focus Mode | 🔍 *(explicitly deferred by founder)* | Workout Experience | `components/FocusMode.tsx` | Founder: "I will test focus mode later" |
| — | Recovery button → Feed button | 🔍 | Notifications, Retention | `(tabs)/index.tsx`, `lib/social.ts` | Built 2026-07-17 (Phase 8); not yet device-tested |
| — | 7 Home/Progress fixes (streak, rest-day, forecast removal, inline Body Intelligence, photo gallery, readiness chip, goal ETA) | 🔍 | Motivation, Progress Tracking, Trust | `(tabs)/index.tsx`, `progress.tsx`, `lib/trainingLoad.ts`, `lib/goalProjection.ts`, `app/progress-photos.tsx` | Built 2026-07-17; not yet device-tested |

### M4 — It Holds a Cohort *(gate: D7 trending up before growth spend — still blocked on B0.3)*
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B4.1 | Single-player accountability loop | 🔲 *(blocked by M4 freeze)* | D7/D30 retention | new `lib/` + Home surface | A commit/streak-save loop that works with zero friends |
| B4.2 | Referral program | 🔲 *(blocked by M4 freeze)* | Virality, CAC | Supabase migration + edge fn + UI | Referral link issues + credits a month |
| B4.3 | Cohort retention analysis + iterate | 🔲 *(needs B0.3 first)* | Retention | PostHog *(founder + data)* | D1/D7/D30 measured for ≥2 cohorts |

### M5 — Credible & Hardened
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B5.1 | Honest readiness label | ✅ | Trust, Science | `components/ProgressCards.tsx` | Disclosure added; readiness confirmed never a gate |
| B5.2 | HealthKit import (sleep/HR/steps) | 🔲 | Science, Readiness | native module → `eas build` | Real signal feeds readiness |
| B5.3 | Readiness → scheduling feedback | 🔲 | Differentiation | scheduling + readiness libs | Low readiness suggests moving today's heavy session |
| B5.4 | Volume landmarks (MEV/MRV) under the hood | 🔍 | Science credibility | `lib/volumeLandmarks.ts`, `lib/progression.ts`, `(tabs)/plan.tsx` | Real live MRV cap (cap only, no MEV floor); needs an on-device open-a-workout smoke test |
| B5.5 | Integration/E2E tests on state machines | ✅ | Reliability | `lib/__tests__/fakeSupabase.ts` + 4 suites | All 3 named bug classes + both real callers of the shared sweep regression-locked |

### M6 — Growth & Table Stakes
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B6.1 | Wedge-led App Store listing | 🔍 | Install→page conv. | `APP_STORE_LISTING.md`; App Store Connect *(founder to paste + shoot screenshots)* | **Copy drafted 2026-07-17** — name/subtitle/keywords/promo text/description/5-screenshot narrative, ready to paste. Founder still needs to take the actual screenshots and submit |
| B6.2 | One acquisition channel (calendar-trick content) | 🔲 | Top-of-funnel | *(founder)* | A repeatable weekly motion running |
| B6.3 | "Year in Training" annual Wrapped | ⏸ | Organic growth | `lib/wrapped.ts` (extend) | Postponed past M4 |
| B6.4 | Table-stakes polish (Watch, widget, Live Activity, superset, plate calc, named programs, exercise prefs) | ⏸ | Various | various | Each unlocked only as data justifies |

### Deferred / Rejected pool *(tracked so nothing is "forgotten" — not active)*
| Item | Status | Reason |
|---|---|---|
| More Progress analytics depth | ❌ | Over-built; charts don't retain/convert |
| New social/community/groups surfaces | ❌ | No network yet; hide (B3.2), don't extend |
| Muscle-map / readiness *polish* | ❌ | Fitbod echo, not the wedge |
| Premium themes/icons as headline Pro | ❌ | Bonus flair, not a subscribe reason |
| Nutrition tracking | ❌ | Link to MFP, don't build |
| AI photo form-analysis · voice logging · watch-face complication | ❌ | Flashy, high-effort, not the wedge |
| Equipment personalization images (onboarding) | ⏸ | Asset/illustration work, explicitly lower-value than the rest of Phase 7 |
| Program marketplace · B2B/coach mode · corporate wellness | ⏸ | M-Future; earn $1M ARR first |
| Localization · cardio/running plans | ⏸ | Post-PMF growth levers |
| Tempo Coach (LLM tentpole) | ⏸ | Real, but only after wedge + retention proven |
| Apple Watch · home-screen widget · Live Activity rest timer | ⏸ | Postpone past M4 (retention proof) |
| Volume landmarks (cap done; floor not) · strength benchmarks · pause-plan mode · smart-notif timing | ⏸ | Nice-to-have; pull in during M5/M6 as justified |

---

## Session Log *(newest first)*

- **2026-07-19 (later) — Founder device-testing batch: Focus Mode overhaul + 9 other fixes.** Same
  day as the codebase review below, the founder actually used the app and reported a dense list of
  real issues. Fixed 7 batches, each its own commit: (1) Focus Mode's ScrollView/KeyboardAvoidingView
  fix for unreachable bottom buttons + the keyboard-covers-screen bug; the auto-close-during-rest fix
  (root cause of "abrupt switching" AND "no RPE on the last set" — Focus Mode was closing itself
  before either could render); RPE added to Focus Mode; the rest ring made tappable-to-skip; "View
  form video"→"View form guide"; the exercise-actions row wrap fix (unilateral toggle clipping); the
  set-edit pencil-vs-checkmark fix; a new Settings "Workout Focus Mode" on/off toggle; the dead
  `done ? 'DONE' : 'DONE'` ternary fixed to `'ALL DONE'`/`'DONE'`. (2) Home's "Continue" copy for a
  paused session (new in-progress-`workout_logs` query) + an animated-closed GO-gone dock gap.
  (3) Quick Workout's new "Target Area" chip row (Core/Legs/Push/Pull/Cardio), reusing
  `generateQuickWorkout`'s existing `targetPattern` override. (4) Exercise search aliases for "inner/
  outer thigh" → adductors/abductors. (5) A calf-specific rep-range bump in `progression.ts`/
  `exerciseProgramming.ts` (10-16 → 15-24 for muscle_gain), on top of the existing isolation bump.
  Also verified 4 other reported items were already correct by design (progressive-overload weight
  suggestion, blank-workout streak exclusion, PREV showing last-actually-done not last-skipped,
  cross-workout exercise history) — no change needed, confirmed via code read. `tsc` clean, full suite
  green (218/218) throughout. **4 items intentionally not built** — drag-to-reorder (real feature,
  needs its own gesture-handling pass), a first-workout rest-time prompt (capability exists, just not
  proactively surfaced — risked colliding with the existing tutorial system), whether swap/remove
  should sync to the split like Add already does (a real asymmetry, but changing it needs the
  founder's product call, not a guess), and a swipe-completion animation (pure polish, the underlying
  bug is fixed). All four documented with concrete next steps in `MASTER_FIX_PLAN.md`'s new
  "2026-07-19 addendum" section.
- **2026-07-19 — Full codebase review + `MASTER_FIX_PLAN.md` + honest re-score.** Requested to go
  through the entire product (code, logic, UI) as if publishing today, independent of the M0-M6
  strategy ledger, and produce an execution-ready fix plan. Ran three parallel deep-dive reviews
  (UI/screens across all 45 routes; every `lib`/`services` domain-logic module; the full platform
  layer — monetization, analytics, crash reporting, Supabase/RLS, push, performance, auth, config,
  offline). Wrote `MASTER_FIX_PLAN.md` (new, repo root): P0 ship-blockers (F1-F10, e.g. the
  `week_index` plan-cliff bug, all-day-events not blocking scheduling, 5 silent-write-failure sites,
  no ErrorBoundary, no offline queue, the entitlement-ID risk, a leaked RapidAPI key), P1 craft/
  coherence (C1-C10), P2 wedge amplifiers, P3 table stakes, P4 explicitly deferred/M4-gated — every
  batch scoped with files, edge cases, done-when, tests, and a copy-paste Sonnet prompt. Re-scored
  `PRODUCT_AUDIT.html` honestly: split the single headline into Product Score (5.9/10, potential 8.2)
  and Market Proof Score (4.3/10, potential 7.8); recomputed all 48 rows for real (not an estimate);
  9 rows moved down on this session's newly-found evidence (Reliability, Accessibility, Polish,
  Engineering Architecture, Scheduling Experience, Personalization, Fitness Science, Notifications,
  Monetization), none moved up (this was a hunt for defects, not a chance to claim credit). Republished
  the artifact to its existing URL. **No app code changed — diagnosis + planning only.** Next session:
  start `MASTER_FIX_PLAN.md`'s P0 batches in order.
- **2026-07-17 — Phase 9: full audit re-review + this compaction.** New info: Google Calendar
  approved for production (B0.2 → ✅, B1.5 unblocked). Re-reviewed every section of
  `PRODUCT_AUDIT.html` against everything shipped this session; updated scores/notes honestly (see
  its own Update Log); redirected `EXECUTION.md` §1's vital-few list toward verification + B0.3 +
  B1.5 + founder-only items; compacted this file from ~30 Current-Focus paragraphs + 25 verbose
  Session Log entries down to the ledger + this log.
- **2026-07-17 — Phase 8 (Feed button) + 7 Home/Progress fixes + a second onboarding re-cut + 2 real
  bugs + the 6-screen onboarding rebuild + Phase 6 (Plan tour) + Phase 7a-d + Phase 1-5 (scheduling
  fixes, editable sets, Settings split, Quick Workout re-scoping, Focus Mode).** One very long
  founder-testing day, worked in the order the founder gave feedback. Full detail for each of these
  batches lives in `git log` (each is its own scoped commit with a full message) and
  `ARCHITECTURE.md` (the technical "how it works" record). Net result: essentially the entire
  original M1–M3 Claude-buildable backlog is built, plus a large amount of founder-driven UX work
  (Settings/Profile split, editable sets, Focus Mode, a full onboarding rebuild, a Feed button)
  that wasn't in the original numbered plan at all. On-device confirmed same day: Home, Settings
  split, editable sets. Everything else from this day is 🔍.
- **2026-07-16 — Home/Plan IA redesign (two rounds) + the day-timeline hero (two earlier design
  passes, both superseded) + B1.1/B2.1/B3.1/B3.2/B3.3/B5.1/B5.4/B5.5 + 3 founder-reported bugs
  (reschedule-week split order, runner boilerplate, false "first workout" celebration) + an
  adaptation-legibility fix.** This is the day the "Execution OS" (this file + `EXECUTION.md`)
  actually drove an autonomous multi-batch run — 11 batches shipped back to back, each verified
  (`tsc` + tests) and committed individually. Full detail in `git log` (commits `f9c6433`..`2598fdc`
  and the pm2–pm14 batches after). Confirmed on-device same/next day: B1.3b, B3.2.
- **2026-07-15 — Built the Execution OS itself** (`EXECUTION.md` + this ledger + CLAUDE.md's
  Execution Protocol), then B0.1 (retention instrumentation), B1.1/B3.1 (partial), B1.3a (reschedule
  engine), a silent "Remove workout" bug fix (Alert-over-Modal), the OTA `runtimeVersion` fingerprint
  fix (Android crash-class root cause), and Tester Tools (in-app Pro on/off switch, off-roadmap).
  Also: the Google Calendar diagnosis that led to the B0.2 in-app diagnostic (`describeReadError`)
  and, ultimately, the production-approval push that closed B0.2 two days later.
