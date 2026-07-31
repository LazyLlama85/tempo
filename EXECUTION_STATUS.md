# Tempo — Execution Status (the living ledger)

> **READ THIS FIRST every session. UPDATE IT LAST every session.**
> Plan + workflow + prompts: `EXECUTION.md`. Diagnosis + scores: `PRODUCT_AUDIT.html`.
> Status legend: 🔲 Not Started · 🔄 In Progress · ✅ Completed · 🔍 Needs Review (on-device) · ⏸ Postponed · ❌ Rejected
>
> **Recompacted 2026-07-30**: this file had regrown into ~20 dated Current-Focus narrative entries
> (most documenting already-shipped/verified work). Compacted again — same discipline as the
> 2026-07-17 pass — down to: current state (below) + the ledger (unchanged, still the highest-value
> artifact) + an **Open backlog** section absorbed from `MASTER_FIX_PLAN.md` (that file is being
> retired; its still-open items now live here) + a **Founder-only open items** checklist + a
> one-line-per-session Session Log spanning the project's whole history. Nothing is lost — `git log`
> has every commit message, `ARCHITECTURE.md` has the technical detail, and the retired
> `MASTER_FIX_PLAN.md`/`PLAN.md`/`SOCIAL_UPGRADE_PLAN.md` remain in git history if the full original
> prose is ever needed.

---

## ▶ CURRENT FOCUS *(the resume point)*

**The single blocker on everything: T1.2, the on-device verification pass.** A large amount of code
across the last dozen-plus sessions — the entire M1–M3 Claude-buildable backlog, all of
`MASTER_FIX_PLAN.md`'s P0 (F1–F10) and P1 craft batches done so far (C1–C3, part of C4), the
`LAUNCH_SCORE_PLAN.md` queue (T1.1, T1.3, T2.1, T3.1, T3.2), Tempo Coach (C1–C4), and the offline
set-log retry queue — is `tsc`-clean and test-covered but has **never run on a physical device or
AVD**. Nothing on that list closes for real until it does. The founder has said they'll test at the
end of this run; until then, no further feature work should be queued on top without flagging that
risk explicitly.

**Tempo Coach is built through batch C4 (the action layer) but is completely inert in production.**
The screen (`app/coach.tsx`), the propose/apply action layer (`lib/coachActions.ts`), Pro gating, and
a dev stub (`lib/coachStub.ts`, `__DEV__ && EXPO_PUBLIC_COACH_STUB=1`) all exist and are
`tsc`+test-verified, but the Edge Function has never been deployed and no Anthropic API key has ever
been set — the function does not exist in the Supabase project. Two commands unblock it:
```
cd mobile && npx supabase functions deploy tempo-coach
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```
Without these, Coach returns 503 and the screen shows "Coach isn't available right now." Building
Coach at all was a deliberate, explicit founder override of the M4 feature-freeze (2026-07-22/23) —
not an accident — so its presence here isn't a regression against `EXECUTION.md` §2's "no Tempo
Coach until M4" rule, just a fast-follow the founder chose to build now and ship later. Model is
`claude-sonnet-5`; free tier is capped at 3 messages/calendar month (both tiers share one window).
Still-open Coach decisions: the non-Anthropic-provider question is closed (rejected — cap change made
the savings irrelevant), but the server-can't-see-RevenueCat-subscriptions gap must be closed before
`pro_enabled` goes global, and C5 (remaining-count UI, paywall routing, entry points) is unbuilt.

**B0.3 (PostHog activation definition) is drafted and awaiting founder sign-off.**
`ACTIVATION_DEFINITION.md` proposes keeping the existing 2-session, no-time-window activation
definition and tracking calendar-connected as a cohort split rather than a gate — one open decision
in it (should activation gain a time window) is the founder's call. The funnel + retention dashboard
("Tempo — Activation & Retention", PostHog id 1865254) is already built and waiting; it just needs
real events flowing from a shipped build (same root blocker as T1.2 — nothing has been confirmed to
produce real PostHog data on-device yet).

**Everything else buildable without hardware or a founder decision is done.** The
`LAUNCH_SCORE_PLAN.md` queue is empty except T1.2. Pricing is live and correct on both stores
($4.99/mo, $34.99/yr, `founding-price-2026` yearly intro at a flat $24.99 first year) as of
2026-07-27 — B2.3 is closed. Google Calendar is approved for production (B0.2 closed) and multi-
calendar (B1.5) is built end-to-end and dormant pending one founder reconnect. The next real
Claude-buildable work, in order of value, is: (1) whatever the on-device pass surfaces as broken,
(2) the **Open backlog** below (`MASTER_FIX_PLAN.md`'s remaining C5–C10 craft batches, W2–W6 wedge
amplifiers once M4 unblocks them, and the four still-open 2026-07-19-addendum runner items).

**Last updated:** 2026-07-30.

---

## Ledger — every audit recommendation, tracked

Each row names the **metric it moves** (per `EXECUTION.md` §9 — a batch that moves no metric gets cut).

### M0 — Measurable & Reliable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B0.1 | Retention instrumentation (`activation_reached` + `calendar_connected`) | 🔍 | Measurability | `lib/activation.ts`, `analytics.ts` | Real `EXPO_PUBLIC_POSTHOG_KEY` wired into both EAS profiles + `.env.local` (2026-07-17 fix — earlier ✅ had been wrong, every `track()` call was a silent no-op). Events fire correctly in code; held at 🔍 until a real on-device build (T1.2) confirms PostHog shows a non-zero event count |
| B0.2 | Google OAuth → Production + fix "connects but no events" | ✅ | Reliability, Trust | `CalendarApiService.describeReadError` (in-app diagnostic) | **Done 2026-07-17** — Google approved the app for production, removing the Testing-mode 7-day token-expiry root cause. Still wants an eventual real >7-day on-device confirmation, but the structural cause is gone |
| B0.3 | PostHog funnel + written activation definition | 🔍 | Measurability | PostHog dashboard "Tempo — Activation & Retention" (id 1865254); `ACTIVATION_DEFINITION.md` | Funnel + retention insights built 2026-07-17 (currently empty pending real events — see B0.1). `ACTIVATION_DEFINITION.md` drafted 2026-07-17 — **awaiting founder sign-off**, one open decision named in the doc |
| B0.4 | Feature-freeze policy (no new surfaces until M4) | ✅ | Focus | `EXECUTION.md` §1/§9 | Written + in effect. **Exception granted explicitly by the founder for Tempo Coach** (2026-07-22/23) — Coach is built through C4 but deliberately not deployed; the freeze otherwise holds |
| B0.5 | Device-matrix QA of redesign; fix any blank-render | 🔍 partial | Reliability, Polish | Real device *(founder)* | Home/Settings/editable-sets confirmed on-device 2026-07-17. Everything shipped since (Focus Mode, onboarding rebuild, Plan tour, Feed button, Coach, the whole `LAUNCH_SCORE_PLAN.md` queue, the offline write queue) is code-verified only — **T1.2 covers all of it** |

### M1 — The Wedge, Undeniable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B1.1 | Wedge quantifier (`schedulingImpact`) | ✅ | Value Prop, Differentiation | `lib/schedulingImpact.ts` → Weekly Report, paywall, Progress, **and Home hero subtitle** (added 2026-07-23 as `LAUNCH_SCORE_PLAN.md` T1.1) | Stat card/line visible on a primary tab, above the fold |
| B1.2 | Calendar day-timeline — Home hero | ✅ | Differentiation, UX, Activation | `lib/dayTimeline.ts`, `components/DayTimeline.tsx`, `(tabs)/index.tsx` | **Confirmed on-device 2026-07-17** |
| — | IA cleanup: Train → Plan (segmented hub → calendar + split + library) | 🔍 | UX, Focus | `(tabs)/plan.tsx` | Built same batch as B1.2; Plan-specific flows not separately device-confirmed |
| B1.3 | "Reschedule my whole week" — engine + UI | ✅ | Subscription Value, Retention | `lib/weekReschedule.ts`, `reschedule.ts`, `(tabs)/index.tsx`/`plan.tsx` | Confirmed via web test; Pro-gated (B2.1). Coach's C4 action layer (`rescheduleWholeWeek`) now also calls this same engine |
| B1.4 | "Lacking time? 15-min swap" on Home | ✅ *(pre-existing)* | Retention (busy persona) | `lib/quickSuggestion.ts` → Quick Workout | Already covered free-gap/missed/restart triggers |
| B1.5 | Multi-calendar: read/select beyond `primary` | 🔍 **code + OAuth scope live, needs device test** | Differentiation, Trust; Pro gate | `calendar-picker.tsx`, `services/googleCalendar/config.ts` | Full stack built 2026-07-17; OAuth scope (`calendar.calendarlist.readonly`) enabled 2026-07-18 (OTA, no rebuild). **Founder's turn:** reconnect Google once (existing tokens can't self-broaden scope), then test the picker end-to-end; if Google shows an "unverified app" screen, finish scope verification in the console |

### M2 — It Sells Itself
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B2.1 | Re-fence Pro: free analytics, gate scheduling | ✅ | Conversion ×3–4 | `(tabs)/progress.tsx`, `paywall.tsx`, `lib/proFeatures.ts` | Analytics free; reschedule-week + Travel Mode Pro-gated. **Re-gated further 2026-07-22** onto the weekly-repetition pillars (rolling auto-schedule horizon, auto-reschedule-on-conflict) after finding Pro had become "a tip jar" — no free user's experience degrades if Pro vanished, previously true, no longer |
| B2.2 | Paywall triggers at the payable moment | ✅ | Conversion | reschedule-week, 2nd-calendar (B1.5), and **PR forecast** (`pr_forecasting` gate, added 2026-07-23 as T2.1) | Fires at the wedge action, not a random 1st workout. Paywall itself rebuilt 2026-07-22 (personalized hero, `WeekStrip`, 3 outcome cards, forced-dark palette) |
| B2.3 | Pricing raise + trial config | ✅ | ARPU | RevenueCat + App Store Connect + Play Console *(founder, done)* | **Done 2026-07-27** — $4.99/mo, $34.99/yr live on both stores; `founding-price-2026` yearly paid-intro at a flat $24.99 first year (founder's call, not a re-derived discount %). Differs from the ledger's original "$49–59" target — founder's real pricing decision supersedes it |

### M3 — Week One Doesn't Bleed
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B3.1 | Plain-language copy sweep | ✅ | Beginner activation | `onboarding/goal.tsx`, `paywall.tsx` | First-run jargon-free |
| B3.2 | Progressive disclosure (hide social/groups/map pre-activation) | ✅ | Week-1 retention | `(tabs)/profile.tsx`, `progress.tsx` | Confirmed on-device |
| B3.3 | Onboarding aha + time-budget question | 🔍 | Activation | `onboarding/*` — 6 screens (`goal→schedule→sleep→work-school→train-time→plan-preview`) | Rebuilt across two founder-testing rounds (2026-07-17) plus the engine-v2/first-run branch's Welcome screen + Home tour (see Session Log). Not yet device-tested in its current form |
| — | Settings/Profile split | ✅ | UX, Focus | `app/settings.tsx`, `(tabs)/profile.tsx` | **Confirmed on-device 2026-07-17** |
| — | Editable completed sets + unilateral weight | ✅ | Workout Experience | `(tabs)/plan.tsx`, `session-detail.tsx`, `lib/unilateralPrefs.ts` | **Confirmed on-device 2026-07-17** |
| — | Interactive Plan tour + Home tour + Welcome screen | 🔍 | Onboarding, Discoverability | `lib/tutorial.ts`, `stores/tutorial.ts`, `components/TutorialOverlay.tsx`, `app/welcome.tsx` | Plan tour built 2026-07-17; Welcome + Home tour shipped on the `feature/engine-and-first-run` branch (merged to local `main`, not yet on-device tested) |
| — | Active-session Focus Mode | 🔍 | Workout Experience | `components/FocusMode.tsx` | Rebuilt substantially since 2026-07-17 (ScrollView/keyboard fixes, RPE added, auto-close bug fixed, checkmark-vs-pencil fix, Settings on/off toggle) — still not on-device confirmed |
| — | Recovery button → Feed button → real notification center | 🔍 | Notifications, Retention | `(tabs)/index.tsx`, `app/feed.tsx`, `lib/feedLog.ts` | Built 2026-07-17, redesigned into a real merged local-log + `notification_log` inbox 2026-07-22 |
| — | Home/Progress fixes (streak, rest-day, body intelligence, photo gallery, readiness chip, goal ETA) | 🔍 | Motivation, Progress Tracking, Trust | `(tabs)/index.tsx`, `progress.tsx`, `lib/trainingLoad.ts`, `lib/goalProjection.ts`, `app/progress-photos.tsx` | Built 2026-07-17; not yet device-tested |
| — | Quick Workout redesign (slider, body-part chips, muscle hard-filter) | 🔍 | Activation, Workout Experience | `app/quick-workout.tsx`, `lib/quickWorkout.ts` | Built 2026-07-21, web-tested + fixed 2026-07-21 (later); native/device pass still open |

### M4 — It Holds a Cohort *(gate: D7 trending up before growth spend — still blocked on B0.3)*
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B4.1 | Single-player accountability loop | 🔲 *(blocked by M4 freeze)* | D7/D30 retention | new `lib/` + Home surface | A commit/streak-save loop that works with zero friends |
| B4.2 | Referral program | 🔲 *(blocked by M4 freeze)* | Virality, CAC | Supabase migration + edge fn + UI | Referral link issues + credits a month |
| B4.3 | Cohort retention analysis + iterate | 🔲 *(needs B0.3 first)* | Retention | PostHog *(founder + data)* | D1/D7/D30 measured for ≥2 cohorts |
| — | Social push nudges + auto-reschedule *(`SOCIAL_UPGRADE_PLAN.md` Stage 4 remainder)* | 🔲 *(blocked by M4 freeze)* | Retention (social persona) | extend `retention-push` with social rule keys; social-aware `reschedule.ts` | The only undelivered piece of the 4-stage social upgrade (Tempo Score, leaderboards, badges/feed, private groups, and social scheduling's core are all shipped) — new retention-push rule keys ("you're 1 workout from passing Alex," "workout with Josh tomorrow") + letting a social conflict trigger the existing reschedule engine |

### M5 — Credible & Hardened
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B5.1 | Honest readiness label | ✅ | Trust, Science | `components/ProgressCards.tsx` | Disclosure added; readiness confirmed never a gate |
| B5.2 | HealthKit import (sleep/HR/steps) | 🔍 *(one-way write only, opposite direction)* | Science, Readiness | `lib/appleHealth.ts`, `@kingstinct/react-native-healthkit` | **2026-07-22: built the opposite direction first** — Tempo now *writes* a `traditionalStrengthTraining` sample to Health (opt-in, off by default, iOS only). Reading sleep/HR/steps *into* readiness is still 🔲. Native — inert until next `eas build` + on-device confirm |
| B5.3 | Readiness → scheduling feedback | 🔲 *(= `MASTER_FIX_PLAN.md` W2)* | Differentiation | scheduling + readiness libs | Low readiness suggests moving today's heavy session |
| B5.4 | Volume landmarks (MEV/MRV) under the hood | 🔍 | Science credibility | `lib/volumeLandmarks.ts`, `lib/progression.ts`, `(tabs)/plan.tsx` | Real live MRV cap (cap only, no MEV floor); needs an on-device open-a-workout smoke test |
| B5.5 | Integration/E2E tests on state machines | ✅ | Reliability | `lib/__tests__/fakeSupabase.ts` + suites | All named bug classes regression-locked; suite has grown to 367+ tests through the F1–F10/C1–C3/W1 work below |

### M6 — Growth & Table Stakes
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B6.1 | Wedge-led App Store listing | 🔍 | Install→page conv. | `APP_STORE_LISTING.md`; App Store Connect *(founder)* | Copy drafted 2026-07-17, ready to paste. Founder still needs to take real screenshots and submit — see Founder-only checklist |
| B6.2 | One acquisition channel (calendar-trick content) | 🔲 | Top-of-funnel | *(founder)* | A repeatable weekly motion running. `PRODUCT_AUDIT.html` Part II has the full route (short-form video, 8-week plan, ASO fields) |
| B6.3 | "Year in Training" annual Wrapped | ⏸ | Organic growth | `lib/wrapped.ts` (extend) | Postponed past M4 |
| B6.4 | Table-stakes polish (Watch, widget, Live Activity, named programs, exercise prefs) | ⏸ | Various | various | Each unlocked only as data justifies. Superset/circuit support and "love this exercise" boosting (the other half of `MASTER_FIX_PLAN.md`'s exercise-preferences item — the "never show again" half shipped, see Open backlog) still genuinely open here |

### Deferred / Rejected pool *(tracked so nothing is "forgotten" — not active)*
| Item | Status | Reason |
|---|---|---|
| More Progress analytics depth | ❌ | Over-built; charts don't retain/convert |
| New social/community/groups surfaces | ❌ | Hide (B3.2), don't extend — the 4-stage social upgrade that already shipped is the exception that proves the rule (extended existing systems, no new surface class) |
| Muscle-map / readiness *polish* | ❌ | Fitbod echo, not the wedge |
| Premium themes/icons as headline Pro | ❌ | Bonus flair, not a subscribe reason |
| Nutrition tracking | ❌ | Link to MFP, don't build |
| AI photo form-analysis · voice logging · watch-face complication | ❌ | Flashy, high-effort, not the wedge |
| Equipment personalization images (onboarding) | ⏸ | Asset/illustration work, lower-value |
| Contextual one-off tips (first-Progress/first-Quick-Workout/first-equipment-change) + illustrated empty states | ⏸ | Deferred low-priority polish from the engine-v2/first-run build (`PLAN.md`) — the `useOnceTip` hook + current text empty states cover these adequately for now |
| Program marketplace · B2B/coach mode · corporate wellness | ⏸ | M-Future; earn $1M ARR first |
| Localization · cardio/running plans | ⏸ | Post-PMF growth levers |
| **Tempo Coach (LLM tentpole)** | 🔍 **built through C4, undeployed** | Founder explicitly overrode the M4 freeze 2026-07-22/23 to build it now; deployment (2 commands, see Current Focus) and C5 (entry points) still needed before it's live to any user |
| Apple Watch · home-screen widget · Live Activity rest timer | ⏸ | Postpone past M4 (retention proof) |
| Referral program · "Year in Training" Wrapped | ⏸ | Postpone past M4, per `MASTER_FIX_PLAN.md` P4 |
| Strength benchmarks · smart-notif timing (`MASTER_FIX_PLAN.md` W3) · weekly "plan your week" ritual (W4, a new surface — needs M4 + sign-off) | ⏸ | Nice-to-have; pull in during M5/M6 as justified |

---

## Open backlog *(absorbed from `MASTER_FIX_PLAN.md` — that file is being retired)*

`MASTER_FIX_PLAN.md`'s P0 ship-blockers (F1–F10) are 100% done, as are P1's C1 (shared date
utilities) and C2 (theme sweep) — see Session Log. What's below is everything still genuinely open,
carried forward with enough file/line detail to re-execute without re-deriving the analysis. Two
items the static plan file never got updated to reflect as done are called out explicitly (judgment
calls, not guesses — verified against the actual 2026-07-20/21/22/24 session entries before crediting
them).

| Item | Files / lines | Scope | Status |
|---|---|---|---|
| **C4 remainder — accessibility** | `(tabs)/plan.tsx` (~100 touchables / 27 annotations), `(tabs)/index.tsx` (~69/7) | The chip `accessibilityState` pass (quick-workout, muscle-map) and paywall footer buttons are done (2026-07-23, `LAUNCH_SCORE_PLAN.md` T3.1). A regex sweep across the four worst screens only fixed 3 real gaps (profile avatar picker, social decline/remove-friend) — `plan.tsx` and `index.tsx`'s icon-only touchables are still largely unlabeled. Prioritize primary actions (start workout, log a set, navigate to a key screen) over decorative ones. A real VoiceOver/inspector pass is still needed — current Accessibility score (5) is code-review-only | 🔍 partial |
| **C5 — Split `plan.tsx` into Plan hub + Workout Runner** | `(tabs)/plan.tsx` (3,315 lines — the largest file in the app; hub ≈ first ~1,800 lines, runner ≈ ~2,186 on) | Pure extraction, zero behavior change. Read the whole file first to find the *real* hub/runner boundary (the line estimates are approximate). Extract the runner into its own file — a new route or a conditionally-rendered component depending on how navigation currently works; don't change the URL/nav structure as a side effect. Preserve every prop/handler/conditional branch. Re-run the full Plan/Runner on-device checklist after | 🔲 |
| **C6 — Typed routes + push routing completeness** | ~40 `router.push(...)` call sites cast `as any`/`as never`; `_layout.tsx:206-212` push-tap routing | Investigate why Expo Router's typed routes aren't active (`app.json`'s `experiments.typedRoutes`, whether `.expo/types/router.d.ts` generates) and fix the config/generation issue; then remove the casts (`tsc` will reveal any genuinely wrong route paths — fix those, don't re-cast). Add a `default` case to the push-notification tap handler that navigates Home instead of no-op'ing on an unrecognized `data.screen` | 🔲 |
| **C7 — Virtualize long lists** | `workout-history.tsx`, `social.tsx` (feed section only) | Convert `.map`-inside-`ScrollView` to `FlatList` for the two genuinely unbounded lists (grow monotonically with usage). Use existing `FlatList` usages (`exercise-library.tsx`, `pr-browser.tsx`) as the styling/empty-state pattern. Preserve pull-to-refresh/empty-state behavior exactly | 🔲 |
| **C8 — Differentiate Terms vs Privacy links** | `paywall.tsx:352/354`, `sign-in.tsx:200/202`, `settings.tsx:564`, `legal.tsx` | Both links currently navigate to the same `/legal` screen with no way to tell them apart (an App Store review sensitivity). Add a `?section=terms`/`?section=privacy` param; `legal.tsx`'s existing structure (single doc vs. two blocks) determines whether that means scroll-to or show-only | 🔲 |
| **C9 — Analytics completeness** | `(tabs)/plan.tsx` runner-start logic, `(tabs)/index.tsx`, `progress.tsx`, `_layout.tsx:137` (trial_converted), `_layout.tsx:185`+`:205` (app_open) | Four fixes: (1) `session_start` never fires for a *planned* session, only Quick Workouts — add it at the runner's not-started→in-progress transition, alongside (not replacing) the one-time `first_workout_started`. (2) Home/Progress have zero `track()` calls — add basic screen-view tracking. (3) `trial_converted` fires on any no-trial purchase, not a real trial→paid conversion — split into two distinct events. (4) `app_open` double-fires (mount + notification tap) — add a per-cold-launch guard | 🔲 |
| **C10 — Dependency hygiene** | `package.json` (`@lottiefiles/dotlottie-react` alongside `lottie-react-native`), `app.json` | Grep for any real usage of `@lottiefiles/dotlottie-react` (a web/DOM package with no place in an RN bundle); remove if genuinely unused. Check whether the installed `lottie-react-native` version needs a config-plugin entry for Expo SDK 56. Also just *document* (don't fix) that the `development` EAS profile has no `env` block | 🔲 |
| **W2 — Readiness → scheduling feedback** | *(= B5.3 above — tracked in the M5 ledger row, not duplicated here)* | | 🔲 |
| **W3 — Smart notification timing** | `retention-push` edge function + the calendar data it already reads | Avoid nudging mid-meeting — a "the app actually knows my day" touch. Blocked behind M4 freeze (wedge amplifier, not core loop) | 🔲 postponed |
| **W4 — Weekly "plan your week" ritual** | new surface | A Sunday-anchored moment built around the wedge. Explicitly flagged as a **new surface** — needs the M4 gate + founder sign-off, not a unilateral build | 🔲 postponed |
| **W5 — HealthKit import (reading)** | *(= B5.2's unbuilt read direction above)* | | 🔲 |
| **W6 — Streak counted by days, not sessions** | `lib/streak.ts:69,83` | `sessionStreak` increments per *completed session*, so two workouts in one day add 2 to what's presented as a "day streak" — a real correctness bug, not cosmetic. Fix to count distinct days; optionally add a documented streak-repair grace mechanic if product wants one, but the minimum fix is just correctness | 🔲 |
| **P3 — plate calculator** | `lib/plateCalc.ts`, `components/PlateCalcSheet.tsx` | **Already done** — shipped 2026-07-20/21 as a Pro `plate_calculator` gate, reached from the runner's per-exercise menu. `MASTER_FIX_PLAN.md`'s static P3 list was never updated to reflect this (judgment call, verified against the actual session entry before crediting) | ✅ *(mislabeled open in the source file)* |
| **P3 — pause/vacation mode** | `lib/` pause logic + Home | **Already done** — shipped 2026-07-22 as L21, the highest-value previously-unbuilt item in the app; streak protection needed no special-casing | ✅ *(mislabeled open in the source file)* |
| **P3 — exercise preferences ("love this" / "never show again")** | `user_profiles.excluded_exercise_ids`, `lib/exerciseExclusions.ts` | "Never show again" half is done (2026-07-20/21, enforced uniformly across `generatePlan`/`quickWorkout`/`splitSchedule`). "Love this" (a positive preference boost) is still unbuilt | 🔍 half-done |
| **P3 — superset/circuit support in the runner** | runner (post-C5 split, wherever it lands) | Still fully open, not mentioned shipped anywhere | 🔲 |
| **P3 — Home/no-equipment first-class workout mode** | Quick Workout / Home | Still fully open — a large reachable segment given Tempo already models equipment | 🔲 |
| **2026-07-19 addendum — drag-to-reorder** | runner exercise list, `persistOrder()` | Founder-requested. Needs real gesture-handling (long-press-and-drag with autoscroll) — `react-native-draggable-flatlist` or a Reanimated long-press handler, persisted through the existing session-scoped `persistOrder()`. Deserves its own on-device-tested pass | 🔲 |
| **2026-07-19 addendum — first-workout rest-time prompt** | `T.firstWorkout` tutorial, the rest-length `OptionSheet` | The capability already exists (rest `OptionSheet` suggests "2 minutes," lets the user pick 60/90/120/180/custom) — it's just never proactively surfaced. Either add a step to the existing `T.firstWorkout` tour pointing at the rest-timer tool, or gate a one-time auto-open on `!firstWorkoutCompleted` inside `beginSession`. Needs founder confirmation it doesn't fight the existing tutorial system | 🔲 |
| **2026-07-19 addendum — swap/remove sync-to-split** | `replaceExercise`, `persistOrder` in the runner | *Adding* an exercise already correctly syncs to the split when `workout.source === 'split'`; *swapping*/*removing* are deliberately session-only by existing design (own code comments say so). This is a real asymmetry but changing it is a founder product call (should a same-day equipment swap rewrite every future week of your split?), not a guess — Add already offers an explicit "just today, or permanently?" choice; ask whether swap/remove should get the same | 🔲 needs founder call |
| **2026-07-19 addendum — checkmark + swipe completion animation** | `FocusMode.tsx` | The underlying bug ("abrupt switching") is fixed — this is pure animation polish (a Reanimated transition on the exercise-name/ring swap), not a defect | 🔲 nice-to-have |

---

## Founder-only open items *(consolidated checklist — nothing here is Sonnet-buildable)*

1. **T1.2 — on-device verification pass.** The master blocker (see Current Focus). Needs a physical
   device or AVD; covers essentially everything shipped since the last confirmed on-device pass
   (2026-07-17: Home, Settings split, editable sets only).
2. **Tempo Coach deployment.** `cd mobile && npx supabase functions deploy tempo-coach` +
   `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`. Without both, Coach is 503 in production.
3. **B0.3 — activation definition sign-off.** Read `ACTIVATION_DEFINITION.md`, decide the one open
   question (should activation gain a time window), sign off.
4. **B1.5 — reconnect Google Calendar once** (existing OAuth tokens can't self-broaden scope) and
   test the multi-calendar picker end-to-end; resolve an "unverified app" screen in Google Cloud
   Console if it appears.
5. **RevenueCat entitlement ID verification (F9a).** Confirm the RevenueCat dashboard's entitlement
   identifier exactly matches `eas.json`'s `EXPO_PUBLIC_PRO_ENTITLEMENT="Tempo: Fitness Planner Pro"`
   — a mismatch means every paying user silently resolves to not-Pro. A loud Sentry breadcrumb now
   fires on mismatch (F9a's code half is done); only the founder can check the actual dashboard value.
6. **RapidAPI key rotation.** `EXPO_PUBLIC_RAPIDAPI_KEY` is still in `eas.json` (confirmed still
   load-bearing — 641/1,285 exercises remain uncached, F9b investigated and deliberately did NOT
   remove it) but the key has been in git history and should be rotated regardless.
7. **Sentry source-map secrets.** `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` still needed as
   EAS secrets before a production build, or crashes report without symbolicated stack traces.
8. **Monthly recurring: exercise GIF/instructions backfill.** 641 GIFs + 1,285 instruction sets still
   remain after the first run (688 GIFs cached 2026-07-17, 0 instructions — the GIF loop consumed the
   whole monthly RapidAPI quota first). Re-run next billing cycle and each month after:
   `$env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/backfill-exercise-media.mjs` from `mobile/`
   (service_role key from Supabase dashboard → Project Settings → API — never commit it).
9. **App Store listing submission.** `APP_STORE_LISTING.md` is drafted and ready to paste (name,
   subtitle, keywords, promo text, description, 5-screenshot narrative) — someone still needs to take
   the actual screenshots and submit in App Store Connect.
10. **Paid Apps Agreement** (App Store Connect) — flagged open as of 2026-07-22, not confirmed
    resolved since.
11. **B6.2 — one acquisition channel running weekly.** `PRODUCT_AUDIT.html` Part II has the full
    proposed route (short-form video, 8-week start plan, ASO fields) — founder-only execution.
12. **Native rebuild batch.** Apple Health export (write-only, opt-in, off by default) and Focus
    Mode's Settings toggle both ship as code but stay inert until the next `eas build` — batch with
    any other pending native-module work per `EXECUTION.md` §5's guidance to minimize rebuild cycles.

---

## Session Log *(newest first, one entry per session — full detail always in `git log` + `ARCHITECTURE.md`)*

- **2026-07-27 — `LAUNCH_SCORE_PLAN.md` T1.3: pricing realigned to $4.99/mo · $34.99/yr, live on both
  stores.** Founder did the App Store Connect edit manually (no automatable save action existed);
  Play Console's "Set prices" flow was automated end-to-end via browser automation. Yearly founding
  intro offer left at a flat $24.99 first year on both platforms. B2.3 closed; only T1.2 remains on
  the `LAUNCH_SCORE_PLAN.md` queue.
- **2026-07-24 — offline set-log retry queue shipped** (`lib/pendingSetLogs.ts`) — the last named
  Reliability gap, and the first genuinely new production feature (not verification/bounded work) this
  multi-session run shipped. Dedup-safe (keyed `workout_log_id:exercise_id:set_number`), replays once
  at cold app-open via F5's single-owner sweep. Scoped to one table, one call site. 7 new tests, 367/367
  total. `PRODUCT_AUDIT.html` Reliability held at 7 (real code, unverified on real hardware).
- **2026-07-23 (past midnight) — `autoSchedule.ts` test coverage** (9 tests on `findCalendarConflicts`'s
  overlap math) closed one of the two remaining named Reliability gaps; the offline-write-queue
  finding's severity was corrected (only the most-recent unsaved set is at risk, not the whole
  workout — `handleSetDone` already un-checks + prompts retry on failure). Reliability 6→7.
- **2026-07-23 (very late) — audit-accuracy sweep + real recomputation, Product Score 5.9→6.2.**
  Verified (not assumed) that Reliability and Scheduling Experience were still being penalized for
  already-fixed 07-19 bugs; they were. Reliability 4→6. Then genuinely recomputed all 48 rows
  (247/40 = 6.175→6.2) since 7 rows had moved that day, not the 1-2 that previously didn't justify it.
- **2026-07-23 (late night) — `LAUNCH_SCORE_PLAN.md` T3.1: accessibility batch.** Selection-chip
  `accessibilityState` on quick-workout/muscle-map, paywall footer links made real accessible buttons,
  3 icon-only touchables fixed on the 2 worst-cited screens (profile avatar, social decline/remove-
  friend). Accessibility 4→5 — deliberately small, single-digit fixes against an 808/110 ratio.
- **2026-07-23 (late night) — T3.2 found already fixed; corrected the audit instead of writing code.**
  F1/F6's 07-19 fixes (exact-match muscle regions, split+plan miss counting, real `week_offset`) had
  genuinely landed. Personalization 6→7, Fitness Science 5→6 — corrections, not new-work credit.
- **2026-07-23 (night) — `LAUNCH_SCORE_PLAN.md` T2.1: PR forecast shipped**, a second real Pro pillar.
  `lib/prForecast.computePRForecast` (least-squares fit over existing e1RM history) projects the next
  round milestone as a calendar date; new `pr_forecasting` Pro gate. 8 new tests. Subscription Value 6→7.
- **2026-07-23 (evening) — `LAUNCH_SCORE_PLAN.md` written + T1.1 shipped.** Answered "what's worth
  doing before launch" — most low audit rows are frozen until a real cohort transacts, so wrote an
  ordered plan of what's real. T1.1: `schedulingImpact` promoted to the Home hero's own subtitle line.
  Value Proposition 5→6, Scheduling Experience 5→6.
- **2026-07-23 (pm) — Tempo Coach batch C4: the action layer.** `lib/coachActions.ts` (propose/apply
  split, `ConfirmCard`, executor switch over reschedule/substitute/travel-mode), Pro gating matching
  Plan tab, staleness guards, 15 new tests. Free tier set to 3 msgs/calendar month (product lever, not
  cost); model set to `claude-sonnet-5`. Built entirely without an API key — blocked on founder deploy.
- **2026-07-23 (am) — Tempo Coach batch C3: the screen.** `app/coach.tsx` modal route, inverted thread,
  starter prompts, typed-error banner, tap-to-retry. Text-only (no Apply affordance — that's C4).
  Founder had reversed the 2026-07-22 M4-freeze park on Coach and asked to start building it.
- **2026-07-22 (pm) — founder device-testing queue: blank-first-launch root cause + 8 fixes + Apple
  Health export.** Root cause: 4 Zustand stores read SQLite-backed `localStorage` synchronously at
  module-eval time, before any error boundary existed — fixed to default safe + self-correct
  post-mount. Also: PR trend bars→line chart, pause-mode slider, notification-toggle silent-revert
  fix, 3 missing-`ScrollView` tutorial overflow fixes, Apple Health write-only export (opt-in, iOS).
- **2026-07-22 — §29 launch queue worked top to bottom: 8 commits.** Pause/vacation mode (L21),
  achievement-unlock celebrations (L24), leaderboard-at-n=1 (L26), Terms/Privacy scroll fix (L14),
  onboarding copy (L11), progress-photo compare+share (L25), public share preview bug fixes (L27),
  then — with explicit sign-off — Pro re-gated onto weekly-repetition pillars (L1/L2) and the paywall
  rebuilt (§25). Fixed a real pre-ship regression (a Jest-breaking static import) before it shipped.
  Monetization 4→6.
- **2026-07-22 — split creation made the recommended path**, not buried: Profile's "Change Plan" sheet
  now offers "Build my own split" equally; `AddWorkoutSheet` hints toward it; onboarding names templates.
- **2026-07-22 (later) — `PRODUCT_AUDIT.html` restructured into Part I (Launch Standard, §23–29,
  executable L1–L28 work items) + Part II (Money/Marketing/Future, §30–33).** Found 3 new issues: a
  live purchase-layer bug (paywall would show $34.99 while a founding-offer store charges less),
  "Pro is a tip jar" (root cause of the L1/L2 re-gate above), and 4 `AUDIT.md` `[DESIGNED]`-never-built
  items (pause mode, returning-user Home heroes, progress-photo compare, public share previews).
- **2026-07-22 (NEW) — Feed redesigned into a real notification center.** `lib/feedLog.ts` (cooldown-
  gated local log) + `app/feed.tsx` (modal merging the log with a live `notification_log` query) —
  fixes the old Feed's "same item repeats identically every day" bug.
- **2026-07-20/21 (NEW) — founder device-testing/bug queue, 12 fixes.** RevenueCat web-platform crash
  fix; 4 Focus Mode fixes (pencil-not-checkmark icon, dead-button fix, DONE-WITH-SET copy, Lottie
  aspect-ratio investigation); GO always opens the today's-session-vs-Quick-Workout chooser; a
  `save_exercise_instructions` RPC so live ExerciseDB fetches persist back permanently; two
  multi-workout-per-day visibility gaps fixed (Home + Plan); permanent exercise deletion
  (`excluded_exercise_ids`); a new Pro plate calculator; confirmed weekly-report push and
  multi-calendar OAuth scope already fully live with zero code work remaining.
- **2026-07-21 (NEW) — Quick Workout redesigned.** One `Slider` replaces 8 duration chips; body-part
  chips (Arms/Chest/Back/Shoulders/Legs/Core/Cardio) backed by a real `primary_muscles` hard-filter
  replace movement-pattern jargon; the generated-workout preview card removed entirely (confirmed with
  founder first) — Start now goes straight into the runner.
- **2026-07-21 (later, NEW) — web-testing fixes for the Quick Workout redesign.** Slider layout fix,
  a real empty-workout bug fixed (`forcePatterns` override), preset-deletion tap target added for web,
  and likely fixed the persistent "blank screen on first load" report (Sentry init guarded on web,
  same bug class already fixed for PostHog; `TempoErrorBoundary` widened to wrap the whole root).
- **2026-07-19 (later) — founder device-testing batch, mostly Focus Mode — 10 fixes + 4 flagged.**
  ScrollView/KeyboardAvoidingView fix for unreachable buttons; the auto-close-during-rest bug (root
  cause of "abrupt switching" AND missing last-set RPE); RPE added to Focus Mode; rest-ring made
  tappable; pencil-vs-checkmark edit-icon fix; a Focus Mode on/off Settings toggle; Home "Continue"
  copy for a paused session; Quick Workout's new Target Area chips; exercise-search aliases; a
  calf-specific rep-range bump. 4 items flagged, not built: drag-to-reorder, first-workout rest-time
  prompt, swap/remove-syncs-to-split, checkmark+swipe animation (see Open backlog).
- **2026-07-19 — C2 (theme sweep) done.** New `PRCard` component replaces duplicated hardcoded
  `#B8860B` gold-card blocks (didn't adapt to light theme); 15 hardcoded colors in `workout-complete.tsx`
  mapped to theme tokens; dead `Colors` imports removed from 14 files, dead header styles from 20.
- **2026-07-19 — C1 (shared date utilities) done.** New `lib/dates.ts`; 18 modules migrated off their
  own duplicate date-string helpers; found + fixed 2 real UTC-vs-local bugs along the way
  (`adaptation.weeksBetween`, `social.ts`'s streak-day computation).
- **2026-07-19 — `MASTER_FIX_PLAN.md`'s entire P0 (F1–F10) done.** Plan-cliff bug (`week_offset`
  column + reordered app-open sweep), all-day calendar events now block scheduling, 5 silent-write-
  failure sites fixed, cache-invalidation sweep, one single owner for the app-open sweep, 2 adaptation
  correctness bugs, a 7-screen UI failure-state sweep, the app's first ErrorBoundary, RevenueCat
  entitlement-ID mismatch made loudly visible, 4 backend migrations applied + `retention-push`
  redeployed. 237 tests green throughout.
- **2026-07-19 — full codebase review produced `MASTER_FIX_PLAN.md` + honest re-score.** Three
  parallel deep-dive reviews (all 45 UI routes, every domain-logic module, the full platform layer)
  found real defects independent of the M0-M6 ledger. Re-scored `PRODUCT_AUDIT.html`: split into
  Product Score (5.9/10, potential 8.2) and Market Proof Score (4.3/10, potential 7.8); 9 rows moved
  down on newly-found evidence. Diagnosis + planning only, no app code changed.
- **2026-07-18 (dated as part of the B1.5 row) — multi-calendar OAuth scope enabled** in Google Cloud
  Console (`calendar.calendarlist.readonly`); `config.ts` scope uncommented (OTA, no rebuild).
- **2026-07-17 (Phase 9) — full audit re-review + this file's first major compaction.** Google
  Calendar approved for production (B0.2→✅, B1.5 unblocked); redirected `EXECUTION.md` §1 toward
  verification + B0.3 + B1.5 + founder-only items; compacted ~30 Current-Focus paragraphs + 25 verbose
  Session Log entries down to the ledger + a tight log (the same discipline this 2026-07-30 pass repeats).
- **2026-07-17 — Google Calendar approved for production.** Removed the single most-cited reliability
  risk (Testing-mode 7-day token expiry silently vanishing events).
- **2026-07-17 — B1.5 (multi-calendar) built end-to-end, dormant** pending the OAuth scope (enabled
  next day) and a founder reconnect+test.
- **2026-07-17 — 4 real bugs found via founder feedback, fixed.** Days Per Week made independently
  editable (was silently discarding custom splits on regen); streak no longer zeroed mid-day on a
  same-day swap; Goal ETA chip no longer dead-ends on Progress; GO button re-scoped to check today's
  schedule first before falling back to Quick Workout.
- **2026-07-17 — critical fix: analytics had never actually been flowing.**
  `EXPO_PUBLIC_POSTHOG_KEY` had never been set anywhere — every `track()` call had been a silent no-op
  in every shipped build. Fixed the key wiring; built the B0.3 PostHog funnel + retention dashboard
  ahead of the fix actually shipping.
- **2026-07-17 — "First-Launch Perfection" plan executed, 8 batches.** Per-step onboarding funnel
  analytics; removed a redundant duplicate plan-reveal screen; the reveal's "already on your calendar"
  copy made honest + conditional with an optional in-line calendar connect; badges/Progress dashboard
  activation-gated; an accessibility pass; a Home adaptation-mode chip; `APP_STORE_LISTING.md` +
  `ACTIVATION_DEFINITION.md` drafted.
- **2026-07-17 — Phase 8 (Feed button) + 7 Home/Progress fixes + a second onboarding re-cut + 2 real
  bugs + the 6-screen onboarding rebuild + Phase 6 (Plan tour) + Phase 7a-d + Phase 1-5** (scheduling
  fixes, editable sets, Settings split, Quick Workout re-scoping, Focus Mode). One very long founder-
  testing day — essentially the entire original M1–M3 Claude-buildable backlog landed, plus a large
  amount of founder-driven UX work not in the original numbered plan at all.
- **2026-07-16 — Home/Plan IA redesign (two rounds) + the day-timeline hero + B1.1/B2.1/B3.1/B3.2/
  B3.3/B5.1/B5.4/B5.5 + 3 founder-reported bugs + an adaptation-legibility fix.** 11 batches shipped
  back to back, each verified and committed individually — the day the Execution OS first drove an
  autonomous multi-batch run.
- **2026-07-15 — built the Execution OS itself** (`EXECUTION.md` + this ledger + CLAUDE.md's Execution
  Protocol), then B0.1, B1.1/B3.1 (partial), B1.3a, a silent "Remove workout" bug fix, the OTA
  `runtimeVersion` fingerprint fix (an Android crash-class root cause), and Tester Tools. Also: the
  Google Calendar diagnosis that led to the B0.2 in-app diagnostic and, two days later, production approval.
- **(undated, `feature/engine-and-first-run` branch, merged to local `main`) — Programming Engine v2 +
  First-Time Experience shipped, per `PLAN.md` (now retired — STATUS: IMPLEMENTED).** Engine v2:
  `lib/exerciseProgramming.ts` classifies exercises by `{role, slot, primaryMuscle}` from
  `primary_muscles`/name keywords (replacing the too-coarse `movement_pattern` bucketing that had
  miscategorized biceps curls as "pull," cleans as "hinge/quads," etc.); a new slot-based session
  template model replaces flat pattern lists in `generatePlan.ts`, shared by `extendActivePlan` and
  `restampFuturePlanForExperience`; role-aware prescription in `progression.ts`; a "Why this workout"
  rationale sheet. First-Time Experience: `lib/tutorial.ts`/`stores/tutorial.ts` (device-local,
  survives restart/upgrade), `TutorialOverlay` spotlight component, `app/welcome.tsx`, a 5-step Home
  tour, an evolved first-workout coach overlay, a bigger first-completion celebration, `useOnceTip`
  contextual tips. **Zero database migrations** — classifier is pure over existing columns, tutorial
  state is local. 7 checkpoints, typecheck + Metro export green throughout. One item deferred (see
  Deferred/Rejected pool): contextual one-off tips + illustrated empty states.
- **(undated, per `SOCIAL_UPGRADE_PLAN.md`, now retired) — the 4-stage social upgrade shipped and is
  live**, per `ARCHITECTURE.md`. Stage 1: Tempo Score (`lib/tempoScore.ts`, 0–1000, consistency-only,
  zero strength inputs — see `ARCHITECTURE.md` for the formula) + `friends_leaderboard_v2()` +
  `current_session_streak()` SQL mirror + a 3-tab leaderboard UI. Stage 2: 12 consistency/competitive
  badges (`lib/badges.ts`, merged with and replacing the old achievements grid) + `activity_events`-
  backed richer feed. Stage 3: private groups (`groups`/`group_members`, group-scoped leaderboards).
  Stage 4 (partial): social scheduling's core (`privacy_availability`, free-window overlap,
  `workout_invites` accept→schedule-both, social smart-reschedule) shipped; **social push nudges +
  auto-reschedule are the one still-open piece** — tracked in the M4 ledger row above.
- **2026-07-19 — `MASTER_FIX_PLAN.md`'s founder-only P0 items opened**, per its §0 shortlist: F9a
  (RevenueCat entitlement ID — code-half done, dashboard-half founder-only), F9b (RapidAPI key
  rotation — investigated, deliberately not removed from `eas.json`, still load-bearing).
