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

**T1.2, the on-device verification pass, RAN for the first time 2026-08-02 — on the Mac's iOS
Simulator, not yet a physical device.** It found real, confirmed bugs (not just theoretical
code-review findings): a live-repro'd cold-launch crash on a from-scratch native build, an
unauthenticated edge function with full service-role DB access, silent data loss on workout edits,
and a broken new feature (muscle-history's vocabulary mismatch), among others. **Both Tier-1
(blocking) and Tier-2 (real, non-blocking) findings from that pass are now fixed** (see Session
Log) — `tsc`-clean, 372/372 tests. Tier-3 (product/UX asks from the founder's own live testing) are
queued in the Open Backlog below (T3.1–T3.6), several explicitly needing founder design/scope input
before building. **T1.2 is still not fully closed**: a Simulator pass cannot confirm Live
Activities, push delivery, Sign in with Apple, or anything gated on real hardware — those still
need one physical-device pass after the next EAS build. The large body of code from the dozen-plus
sessions before this one (the entire M1–M3 Claude-buildable backlog, `MASTER_FIX_PLAN.md`'s P0/P1
batches, the
`LAUNCH_SCORE_PLAN.md` queue, Tempo Coach, the offline set-log retry queue) is now Simulator-
exercised for the first time via this pass rather than purely code-verified, which is real progress
even though the harder hardware-only claims remain open.

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
calendar (B1.5) is code-complete, including a self-serve reconnect button added 2026-08-04, and
dormant pending one founder reconnect on a real device. The next real
Claude-buildable work, in order of value, is: (1) whatever the on-device pass surfaces as broken,
(2) the **Open backlog** below (`MASTER_FIX_PLAN.md`'s remaining C5–C10 craft batches, W2–W6 wedge
amplifiers once M4 unblocks them, and the four still-open 2026-07-19-addendum runner items).

**Last updated:** 2026-08-02 — the Mac's first-ever on-device (Simulator) pass ran, found real bugs,
and every Tier-1 + Tier-2 finding from it is now fixed on Windows (see Session Log); T1.2 above
still needs a real physical device before it's fully closed.

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
| B0.5 | Device-matrix QA of redesign; fix any blank-render | 🔍 partial | Reliability, Polish | Real device *(founder)*; iOS Simulator pass done 2026-08-02 | Home/Settings/editable-sets confirmed on-device 2026-07-17. **2026-08-02: first Simulator pass on everything shipped since** (Focus Mode, onboarding rebuild, Plan tour, Feed button, Coach, the whole `LAUNCH_SCORE_PLAN.md` queue, the offline write queue, muscle-history) — found and fixed 4 blocking bugs (see Session Log). Still needs a real physical-device pass for anything Simulator can't exercise (Live Activity, push delivery, Sign in with Apple) |

### M1 — The Wedge, Undeniable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B1.1 | Wedge quantifier (`schedulingImpact`) | ✅ | Value Prop, Differentiation | `lib/schedulingImpact.ts` → Weekly Report, paywall, Progress, **and Home hero subtitle** (added 2026-07-23 as `LAUNCH_SCORE_PLAN.md` T1.1) | Stat card/line visible on a primary tab, above the fold |
| B1.2 | Calendar day-timeline — Home hero | ✅ | Differentiation, UX, Activation | `lib/dayTimeline.ts`, `components/DayTimeline.tsx`, `(tabs)/index.tsx` | **Confirmed on-device 2026-07-17** |
| — | IA cleanup: Train → Plan (segmented hub → calendar + split + library) | 🔍 | UX, Focus | `(tabs)/plan.tsx` | Built same batch as B1.2; Plan-specific flows not separately device-confirmed |
| B1.3 | "Reschedule my whole week" — engine + UI | ✅ | Subscription Value, Retention | `lib/weekReschedule.ts`, `reschedule.ts`, `(tabs)/index.tsx`/`plan.tsx` | Confirmed via web test; Pro-gated (B2.1). Coach's C4 action layer (`rescheduleWholeWeek`) now also calls this same engine |
| B1.4 | "Lacking time? 15-min swap" on Home | ✅ *(pre-existing)* | Retention (busy persona) | `lib/quickSuggestion.ts` → Quick Workout | Already covered free-gap/missed/restart triggers |
| B1.5 | Multi-calendar: read/select beyond `primary` | 🔍 **code complete, needs one real device test** | Differentiation, Trust; Pro gate | `calendar-picker.tsx`, `services/googleCalendar/config.ts` | Full stack built 2026-07-17; OAuth scope (`calendar.calendarlist.readonly`) enabled 2026-07-18 (OTA, no rebuild). Verified live 2026-08-04: 0 of 3 connected tokens in prod carried the new scope (a token's granted scopes are fixed at consent time — nothing server-side can add one retroactively), so `fetchCalendarList()` 403'd for every real user. **Fixed same day:** the picker now detects that exact scope-insufficient error and offers a one-tap "Reconnect Google Calendar" button (calls `connectGoogleCalendar()`, which forces `prompt=consent` to re-grant the current scope list) instead of dead-ending on static copy. **Founder's turn, unchanged:** tap it once on a real device to prove the grant actually works; if Google shows an "unverified app" interstitial instead of a normal consent screen, that means scope verification in Cloud Console isn't actually finished and needs completing there |

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
| **C4 remainder — accessibility** | `(tabs)/plan.tsx`, `(tabs)/index.tsx` | **2026-08-04: another real pass, still partial by design.** Audited both files for genuinely icon-only touchables (no Text sibling — the real screen-reader failure mode; icon+text pairs already read via RN's default accessible-subtree text flattening, lower severity). `index.tsx`'s icon-only buttons were already fully labeled from the 2026-07-23 pass. `plan.tsx` had real gaps on primary actions: the hub's Start/Resume session button (the single most important control on the whole screen had NO label), Edit workout, a day-card's Edit button, both Library nav rows (Exercise Library, Manage Workouts), and Add Exercise — all fixed. Per-exercise secondary actions (Form guide/Swap/Why-this-workout, all icon+text) deliberately left for a future pass. A real VoiceOver/inspector pass is still needed — current Accessibility score (5) is code-review-only | 🔍 partial |
| **C5 — Split `plan.tsx` into Plan hub + Workout Runner** | `(tabs)/plan.tsx` (3,315 lines — the largest file in the app; hub ≈ first ~1,800 lines, runner ≈ ~2,186 on) | Pure extraction, zero behavior change. Read the whole file first to find the *real* hub/runner boundary (the line estimates are approximate). Extract the runner into its own file — a new route or a conditionally-rendered component depending on how navigation currently works; don't change the URL/nav structure as a side effect. Preserve every prop/handler/conditional branch. Re-run the full Plan/Runner on-device checklist after | 🔲 |
| **C6 — Typed routes + push routing completeness** | 33 files across `src/app` + `src/components`; `_layout.tsx`'s push-tap routing | **Done 2026-08-04.** Typed routes were never actually broken — `experiments.typedRoutes` was already on and `.expo/types/router.d.ts` generates a full, correct route union; the casts just predated that (one even had a stale `/* typed-routes regen on next run */` comment). Removed all 90 now-dead `as any`/`as never` casts on `router.push`/`router.replace` calls; `tsc` caught the 3 that were genuinely needed (a coach action's runtime-resolved route, a feed item's stored screen string, the tutorial overlay's cross-screen step navigation) and those were restored, not blanket-removed. The push-tap `default` case was **already added 2026-08-02** (routes to Home only for a real retention-push, never a local notification) — this row's text just hadn't been updated. tsc clean, 390/390 tests | ✅ |
| **C7 — Virtualize long lists** | `workout-history.tsx` (done); `social.tsx` (assessed, not converted) | **`workout-history.tsx` done 2026-08-04** — converted the `.map`-inside-`ScrollView` row list to `FlatList` (up to `PRO_ROW_LIMIT`=500 rows, the genuinely unbounded one), matching `pr-browser.tsx`'s pattern; preserved the per-row `FadeInView` stagger and the `hasHiddenHistory` upsell as `ListFooterComponent`. **`social.tsx`'s feed checked and deliberately left alone**: its `friend_feed()` RPC (`supabase/add_activity_reactions.sql`) is server-capped at `limit 30` over a 14-day window — not actually unbounded, contrary to this row's original premise. The feed is also just one interleaved section of one big multi-section `ScrollView` (requests/invites/leaderboard/feed/groups/friends/privacy all together) — splitting it out would mean restructuring the whole screen around a nested-list pattern for a ~30-row cap, real regression risk for no real gain. Not converted | ✅ *(scoped down, not skipped)* |
| **C8 — Differentiate Terms vs Privacy links** | `paywall.tsx:522/531`, `sign-in.tsx:207/209`, `legal.tsx` | **Already done** — shipped in commit `3dd5f4b` ("Three launch-audit quick wins... Terms/Privacy split..."), this row's static text was never updated to reflect it (same mislabeling pattern as the P3 rows below — verified against the actual code before crediting). `legal.tsx` takes a `section: 'terms' \| 'privacy'` param, sets a distinct screen title per section, and scrolls to the Terms block when `section=terms`; both `paywall.tsx` and `sign-in.tsx` already pass the param on their respective links. `settings.tsx:705`'s single combined "PRIVACY & TERMS" row deliberately still links to the bare `/legal` (top-of-doc) — it's one row, not a Terms/Privacy pair, so there's nothing to differentiate there | ✅ *(mislabeled open in the source file)* |
| **C9 — Analytics completeness** | `(tabs)/plan.tsx`'s `beginSession`, `_layout.tsx`, `lib/purchases.ts`, `lib/analytics.ts` | **Done 2026-08-04.** (1) `session_start` now fires from `beginSession` (the planned-session not-started→in-progress transition) with `type: 'planned'`, alongside (not replacing) the existing one-time `first_workout_started` — previously only Quick Workouts tracked a start at all. (2) New `screen_view` event fired from one centralized `usePathname()` effect in `_layout.tsx` (PostHog's own recommended Expo Router pattern, not a manual call per screen) — covers Home/Progress and every other route in one place. (3) `trial_started`/`trial_converted` now track the entitlement's own period-type transition (new `fetchProAndTrialState()` seeds a `wasTrial` baseline) instead of `nowPro && !wasPro` alone — a direct no-trial purchase no longer mislabels as `trial_converted` (the paywall's own `purchase_completed` already covers that path), and a real trial→paid conversion — which stays `isPro: true` throughout, so it never crossed the old boolean edge — now fires correctly. (4) `app_open` double-fire was **already fixed 2026-08-02** (a 2s cold-launch window in `_layout.tsx`); this row's text just hadn't been updated — verified against the live code before crediting, not re-fixed | ✅ |
| **C10 — Dependency hygiene** | `package.json` (`@lottiefiles/dotlottie-react` alongside `lottie-react-native`), `app.json` | Grep for any real usage of `@lottiefiles/dotlottie-react` (a web/DOM package with no place in an RN bundle); remove if genuinely unused. Check whether the installed `lottie-react-native` version needs a config-plugin entry for Expo SDK 56. Also just *document* (don't fix) that the `development` EAS profile has no `env` block | 🔲 |
| **W2 — Readiness → scheduling feedback** | *(= B5.3 above — tracked in the M5 ledger row, not duplicated here)* | | 🔲 |
| **W3 — Smart notification timing** | `retention-push` edge function + the calendar data it already reads | Avoid nudging mid-meeting — a "the app actually knows my day" touch. Blocked behind M4 freeze (wedge amplifier, not core loop) | 🔲 postponed |
| **W4 — Weekly "plan your week" ritual** | new surface | A Sunday-anchored moment built around the wedge. Explicitly flagged as a **new surface** — needs the M4 gate + founder sign-off, not a unilateral build | 🔲 postponed |
| **W5 — HealthKit import (reading)** | *(= B5.2's unbuilt read direction above)* | | 🔲 |
| **W6 — Streak counted by days, not sessions** | `lib/streak.ts:69,83` | `sessionStreak`/`longestSessionStreak` still increment per *completed session* for the Profile hero stat + friend-overview display — two workouts in one day still add 2 to what's presented as a "day streak." **Partially addressed 2026-08-02**: the Mac audit found this ALSO fed `social.ts`'s friend-feed milestone broadcast ("reached a 30-day streak"), turning an internal display quirk into a false claim sent to other users. Added `distinctDayStreak()` (same file) and switched ONLY `syncSocialOnOpen`'s milestone check to it — narrowly scoped since redefining `sessionStreak` itself touches the Profile hero stat and friend-overview display everywhere, a bigger blast-radius change deliberately left for this row rather than folded into a mixed fix-pass. Remaining scope: decide whether the Profile hero stat should also switch to the honest day-count (or be relabeled "Session streak"), then migrate its remaining callers | 🔍 partial |
| **P3 — plate calculator** | `lib/plateCalc.ts`, `components/PlateCalcSheet.tsx` | **Already done** — shipped 2026-07-20/21 as a Pro `plate_calculator` gate, reached from the runner's per-exercise menu. `MASTER_FIX_PLAN.md`'s static P3 list was never updated to reflect this (judgment call, verified against the actual session entry before crediting) | ✅ *(mislabeled open in the source file)* |
| **P3 — pause/vacation mode** | `lib/` pause logic + Home | **Already done** — shipped 2026-07-22 as L21, the highest-value previously-unbuilt item in the app; streak protection needed no special-casing | ✅ *(mislabeled open in the source file)* |
| **P3 — exercise preferences ("love this" / "never show again")** | `user_profiles.excluded_exercise_ids`, `lib/exerciseExclusions.ts` | "Never show again" half is done (2026-07-20/21, enforced uniformly across `generatePlan`/`quickWorkout`/`splitSchedule`). "Love this" (a positive preference boost) is still unbuilt | 🔍 half-done |
| **P3 — superset/circuit support in the runner** | runner (post-C5 split, wherever it lands) | Still fully open, not mentioned shipped anywhere | 🔲 |
| **P3 — Home/no-equipment first-class workout mode** | Quick Workout / Home | Still fully open — a large reachable segment given Tempo already models equipment | 🔲 |
| **2026-07-19 addendum — drag-to-reorder** | runner exercise list, `persistOrder()` | Founder-requested. Needs real gesture-handling (long-press-and-drag with autoscroll) — `react-native-draggable-flatlist` or a Reanimated long-press handler, persisted through the existing session-scoped `persistOrder()`. Deserves its own on-device-tested pass | 🔲 |
| **2026-07-19 addendum — first-workout rest-time prompt** | `T.firstWorkout` tutorial, the rest-length `OptionSheet` | The capability already exists (rest `OptionSheet` suggests "2 minutes," lets the user pick 60/90/120/180/custom) — it's just never proactively surfaced. Either add a step to the existing `T.firstWorkout` tour pointing at the rest-timer tool, or gate a one-time auto-open on `!firstWorkoutCompleted` inside `beginSession`. Needs founder confirmation it doesn't fight the existing tutorial system | 🔲 |
| **2026-07-19 addendum — swap/remove sync-to-split** | `replaceExercise`, `persistOrder` in the runner | *Adding* an exercise already correctly syncs to the split when `workout.source === 'split'`; *swapping*/*removing* are deliberately session-only by existing design (own code comments say so). This is a real asymmetry but changing it is a founder product call (should a same-day equipment swap rewrite every future week of your split?), not a guess — Add already offers an explicit "just today, or permanently?" choice; ask whether swap/remove should get the same | 🔲 needs founder call |
| **2026-07-19 addendum — checkmark + swipe completion animation** | `FocusMode.tsx` | The underlying bug ("abrupt switching") is fixed — this is pure animation polish (a Reanimated transition on the exercise-name/ring swap), not a defect | 🔲 nice-to-have |
| **N1 — History horizon as the Pro line: free = 4 months, Pro = unlimited** *(founder-requested 2026-08-02)* | `lib/historyHorizon.ts` (new), `lib/proFeatures.ts`, `muscle-history.tsx`, `exercise-progress.tsx`, `workout-history.tsx`, `paywall.tsx`, `web/launch.html` | **Done 2026-08-02.** New `full_history` Pro gate, extending the existing "depth & horizon" model the same way `pr_forecasting` already does (read-forward there, read-backward here) — read-time clamp only, nothing ever deleted, so buying Pro immediately reveals everything that was always there. Applied to the 3 clearest "browsing history" surfaces: `exercise-progress.tsx`'s trend chart, `muscle-history.tsx`'s range chips (a new 4M chip is the real free ceiling; 6M/1Y/All are lock-icon chips that open the paywall), and `workout-history.tsx`'s session list (date-filtered + a raised row cap for Pro). Deliberately did NOT clamp current-state facts derived from all-time data (best-ever 1RM, "last session," streak, badges) — those describe present capability, not a history browse, per `historyHorizon.ts`'s own documented scoping rule. Also fixed a real bug found while implementing this: the paywall's existing compare table and `launch.html` both already claimed free users get "full history" (pre-dating this feature) — both corrected. **`progress.tsx`'s own dashboard charts were NOT touched** (deliberately, out of scope for this pass) — that screen mixes current-state stats with historical charts via the shared `useProgressStats` hook in ways that need a careful, separate read before touching safely; noted here as a real follow-up, not forgotten. 4 new tests (`historyHorizon.test.ts`). tsc clean, 382/382 tests | ✅ |
| **T3.1 — muscle-history interactive chart** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `muscle-history.tsx`, `components/SvgLineChart.tsx` | Founder wants to touch/drag along the sets-per-week line and see the exact value at that point (tooltip/crosshair), not just the shape. Check whether `SvgLineChart` can gain touch/drag support cheaply or needs a small custom gesture layer on top | 🔲 queued |
| **T3.2 — muscle-history per-exercise weight-progression** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `muscle-history.tsx`'s "BY EXERCISE" breakdown | Founder: "people don't want to just see sets per week but also weight progression... definitely for exercises." The breakdown rows should show a weight/e1RM trend per exercise (data already computed in `exercise-progress.tsx`), not just set counts. Whether the muscle-GROUP rollup should also get an aggregate weight trend is explicitly undecided by the founder — don't invent one, the exercise-level addition is the clear ask | 🔲 queued |
| **N5 — Weekly Report scoped to last COMPLETED week only (founder-requested 2026-08-04)** | `lib/weeklyReport.ts`, `lib/schedulingImpact.ts`, `app/weekly-report.tsx` | **Done.** `computeWeeklyReport` used to always compute the CURRENT, still-in-progress week — opening the report on a Tuesday showed 1-2 days of data labeled "Your Week". New `weekOffset` param (0 = current week, still used by `workout-complete.tsx`'s "you've trained X days this week" celebration; 1 = last fully-completed Monday-Sunday, used by the report screen) with every date range now bounded on both ends, not just a floor. `fetchSchedulingImpact`/`summarizeSchedulingImpact` gained an optional upper bound (`weekEnd`) for the same reason — its "this week" stat would otherwise have bled into the still-open current week once the report started asking for last week specifically. Screen relabeled "Last Week" with an explicit date-range line (e.g. "Aug 4 – Aug 10") and every "this week" string corrected to "last week"/"the week before". 2 new tests (`summarizeSchedulingImpact`'s bound). tsc clean, 410/410 tests | ✅ |
| **N4 — Home's streak/readiness/check-in redesign (founder-requested 2026-08-04)** | `components/HeroStatusRow.tsx` (new), `(tabs)/index.tsx` | **Done.** Founder disliked the small `borderRadius: full` pill chips scattered across Home (three near-duplicate hand-rolled rows, one per state: mid-day, day-complete, rest-day). New `HeroStatusRow` — one instrument strip, segments divided by hairlines, matching theme.ts's own "every metric reads like a dial" principle — replaces all three. Every existing behavior preserved exactly: which segments show per state, the streak's muted-until-earned-today treatment, check-in's tap target (same `RecoveryCheckIn` sheet), readiness's tap-through to Progress. Segment order is now consistent across all three states (previously inconsistent between them) — a deliberate improvement, not an oversight. tsc clean, 397/397 tests | ✅ | *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `settings.tsx`'s LB/KG `TouchableOpacity` pair (~line 630) | Founder: "when you click it should switch, not necessarily have to click on target measurement." Check hit-slop/target sizing and add an animated cross-fade/slide on value change | 🔲 queued |
| **T3.4 — "Your first session" tip reappears repeatedly** *(Mac audit Tier 3, founder's own live testing 2026-08-02; fixed 2026-08-04)* | `stores/tutorial.ts`, `lib/tutorial.ts` | **Root cause found and fixed.** Every auto-start call site (`(tabs)/index.tsx` and `(tabs)/plan.tsx`'s `useFocusEffect`s, for the Home/Concepts/Plan tours) only ever gated on "is the tour's LAST step done" — so a tour interrupted before its final step (backgrounded, a tab switch, a force-quit mid-tour; the Concepts tour spans 3 screens, making interruption easy) still read as armed+incomplete on the next visit. `startTour()` always reset `stepIndex` to 0 regardless, discarding progress already recorded by `completeStep()` on every step the user *had* advanced through — so the ENTIRE tour replayed from card 1 every time, reading to the founder as "the tutorial keeps randomly reappearing." Fixed with new `resumeStepIndex()` (`lib/tutorial.ts`, pure + unit-tested) — resumes at the first not-yet-completed step instead of always 0. Applies uniformly to all three spotlight tours since they share one `startTour()`. The separate ad-hoc "Your first session" runner coach-mark (`plan.tsx`'s `tempo.coach.session` key) was checked too — dismiss-only, correctly one-shot, not implicated. 5 new tests (`tutorial.test.ts`). tsc clean, 390/390 tests | ✅ |
| **T3.5 — Tempo Coach character redesign** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `app/coach.tsx`, `brand-assets/coach-poses/*` | The coach illustration doesn't show the full body. Design/layout judgment call (crop/framing) — get founder input before touching it | 🔲 queued — needs founder design input |
| **T3.6 — Focus Mode: remove inline set-editing entirely** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `components/FocusMode.tsx` | Founder: "just make it so you can't edit in focus mode, only if they go back to the exercises." Would remove the "HOW MUCH DID YOU DO?" card's inline fields/save button/RPE-chip editing (the `dismissedKey`/`lastSetKey` mechanism fixed 2026-07-31/08-02) and make the card read-only — meaningfully simplifies the component, but is a deliberate redesign of a feature that A2 above just confirmed working as shipped. Confirm scope with the founder before the refactor | 🔲 queued — needs founder scope confirmation |
| **N3 — Revoke Apple token on account deletion** *(Mac audit 2026-08-02)* | `mobile/supabase/functions/delete-account/index.ts`, `app/sign-in.tsx` | A "deleted" account currently still shows Tempo as an authorized app in the user's Apple ID settings — `delete-account` never calls Apple's `/auth/revoke` endpoint. **Needs new Apple Developer infra the app doesn't have yet**, not just a code change: a Sign in with Apple Service ID + a private key (Team ID/Key ID/`.p8` key from the Apple Developer portal, founder-only), a server-side JWT-signed client-secret generator, capturing Apple's `authorizationCode` at sign-in (available on `credential.authorizationCode`, unused today) and exchanging it for a refresh token to store, then calling revoke with that token on deletion. The related, code-only half — an alert when Apple's sheet resolves with no `identityToken` — is already fixed | 🔲 queued — needs founder Apple Developer credentials first |
| **N2 — Make "what am I actually changing?" unambiguous across workouts vs. split days** *(founder-requested 2026-08-02)* | `(tabs)/plan.tsx`, `edit-session.tsx`, `lib/splitSchedule.ts` (new `propagateSplitDayEdit`) | **Done 2026-08-02.** Resolved both open design questions from this row's original write-up by reading `materializeSplit`'s actual behavior first: (1) the default per action — a 2-choice model ("this session only" vs. "every `{focus}` on your split"), asked only when the workout is split-sourced (a plan day already varies week-to-week via periodization with no fixed template to add "forever" to; a Quick Workout is a one-off with nothing to recur into — both skip the question and just persist to the session, immediately); reorder was deliberately left out of scope (lower-stakes, more contextual than a composition change). (2) whether "this day going forward" is distinguishable from "the split" — yes: it's scoped to ONE weekday (the split template's day-per-weekday entry + already-materialized future instances of it), never all weekdays — "the whole split" stays the Workout Builder's own job, not a 3rd choice here. **The real bug underneath the confusion:** `materializeSplit` only ever *inserts* a row for an open date, never re-syncs an existing one after the template changes — so the OLD "permanent" add only affected materializations past the entire ~4-week rolling horizon, silently doing nothing to any already-scheduled near-term day of that weekday. New `propagateSplitDayEdit` fixes this for real (updates the template AND already-materialized future same-weekday rows), applied identically to add/swap/skip. Also fixed a genuinely separate bug found along the way: "session only" adds never persisted to the DB at all, silently lost on pause/resume. `edit-session.tsx` gained an explicit scope banner + a link to the split editor. 3 new tests. tsc clean, 385/385 tests | ✅ |

---

## Founder-only open items *(consolidated checklist — nothing here is Sonnet-buildable)*

1. **T1.2 — on-device verification pass.** The master blocker (see Current Focus). Needs a physical
   device or AVD; covers essentially everything shipped since the last confirmed on-device pass
   (2026-07-17: Home, Settings split, editable sets only).
2. **Tempo Coach deployment.** `cd mobile && npx supabase functions deploy tempo-coach` +
   `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`. Without both, Coach is 503 in production.
3. **B0.3 — activation definition sign-off.** Read `ACTIVATION_DEFINITION.md`, decide the one open
   question (should activation gain a time window), sign off.
4. **B1.5 — reconnect Google Calendar once, on a real device.** The app-side gap (no self-serve
   reconnect path) is fixed 2026-08-04 — Calendar Setup → Choose Calendars now offers a "Reconnect
   Google Calendar" button right on the scope error instead of a dead end. What's left is genuinely
   founder-only: tap it, and if Google shows an "unverified app" screen instead of the normal
   consent flow, finish scope verification in Google Cloud Console.
5. **RevenueCat entitlement ID verification (F9a).** Confirm the RevenueCat dashboard's entitlement
   identifier exactly matches `eas.json`'s `EXPO_PUBLIC_PRO_ENTITLEMENT="Tempo: Fitness Planner Pro"`
   — a mismatch means every paying user silently resolves to not-Pro. A loud Sentry breadcrumb now
   fires on mismatch (F9a's code half is done); only the founder can check the actual dashboard value.
6. **RapidAPI key rotation.** `EXPO_PUBLIC_RAPIDAPI_KEY` is still in `eas.json` (confirmed still
   load-bearing — 641/1,285 exercises remain uncached, F9b investigated and deliberately did NOT
   remove it) but the key has been in git history and should be rotated regardless.
7. **Sentry source-map upload: only the auth token is left.** `SENTRY_DISABLE_AUTO_UPLOAD: "true"`
   was set in BOTH the `preview` and `production` EAS profiles (contradicting the pre-publish
   checklist that assumed source maps were being uploaded) — found in the 2026-08-02 Mac audit,
   removed the same session, and `SENTRY_ORG`/`SENTRY_PROJECT` (`tempo-0u`/`react-native`) added
   to both profiles in `eas.json`. The one piece that has to be a real EAS secret, not a plaintext
   `eas.json` value (unlike the other keys already committed there): `SENTRY_AUTH_TOKEN`, generated
   from the Sentry dashboard (org settings → Auth Tokens, needs `project:releases` scope) and set via
   `cd mobile && npx eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>`.
   Without it, crashes still report but stack traces stay unsymbolicated.
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

- **2026-08-04 — "Delay my whole week" (new Pro feature, founder-requested).** Founder-requested
  companion to "Reschedule my whole week" (B1.3): rather than re-optimizing each workout onto a new
  best day, pushes every remaining `scheduled` workout in the CURRENT calendar week later by a single
  fixed offset (1–6 days), same order/spacing/times, just later — for a sick day, a trip, or an
  overloaded week. Explicit ask was "only delay the week" — clarified with the founder first (fixed
  offset vs. resume-on-a-day vs. reusing the existing engine; fixed offset chosen) since it's easy to
  confuse with the existing recovery-aware reschedule engine. Pure planner `lib/delayWeek.ts`
  (`computeMaxDelayDays`/`planDelayWeek`, 11 unit tests) + DB/calendar wrapper (`delayWholeWeek`/
  `getDelayWeekInfo` in `lib/reschedule.ts`), same pure/IO split as `weekReschedule.ts`/
  `rescheduleWholeWeek`. New `lib/dates.ts` helper `weekEndStr` caps the offset so a shift can never
  land past the week's last day — the mechanism that guarantees it can't collide with the DB's
  `scheduled_workouts_one_plan_per_day` unique index or bleed into next week; the commit path
  re-reads and re-clamps live rather than trusting the picker's snapshot (a race can only shrink the
  applied offset, never overflow it). Reuses the `schedule_optimization` Pro gate (same Smart
  Scheduling pillar) rather than a new `ProFeatureId`. UI: a second icon button next to Plan's
  "Reschedule my whole week" button, dynamic `OptionSheet` offset picker. Not wired into Tempo Coach
  (out of scope this session). `tsc` clean, 408/408 tests (11 new). `ARCHITECTURE.md` and
  `PRODUCT_AUDIT.html` updated same session; not yet on-device tested.

- **2026-08-04 — Rebrand (Tempo → Fitaround) + B1.5 multi-calendar reconnect fix.** Renamed the
  product after finding a real trademark collision (SoftBank-backed tempo.fit holds registered marks
  covering fitness scheduling software) — new `mobile/src/constants/brand.ts` is now the single
  source of truth for the display name across ~60 app files and the marketing site; bundle id/EAS
  slug/deep-link scheme deliberately left unchanged (founder's call, see `ARCHITECTURE.md`'s rebrand
  note). Separately, investigated why B1.5 (multi-calendar) still didn't work despite being
  "code-complete since 2026-07-17": confirmed live in prod that 0 of 3 connected Google tokens carry
  the `calendar.calendarlist.readonly` scope added 2026-07-18 — a token's granted scopes are fixed at
  consent time, so every already-connected user's `fetchCalendarList()` call 403s until they
  reconnect, and the picker had no way to prompt that. Fixed: `calendar-picker.tsx` now detects the
  scope-insufficient error specifically and offers a one-tap "Reconnect Google Calendar" button that
  calls the existing `connectGoogleCalendar()` (forces `prompt=consent`) and retries automatically on
  success. `tsc` + full jest suite (385 tests) clean after both changes.
- **2026-08-02 (session 2) — Quick Workout curation + runner bug pass, founder-reported.** Separate
  from the Mac-audit fix pass earlier the same day (below). **Quick Workout engine (`quickWorkout.ts`,
  `quick-workout.tsx`):** Target Area chips are now genuinely multi-select (was single-select only,
  despite the underlying `targetMuscles: string[]` field already supporting a union) — new
  `computeTargetFromKeys` derives the hard muscle filter + a human-readable label from the active
  chip `Set`. Fixed the real reported bug: picking "Legs" for a strength-purpose session recommended
  Jump Rope purely because it lists `calves` as a primary muscle — `forcePatterns` used to force
  EVERY pattern present in the muscle pool including cardio/mobility regardless of the active
  purpose; now only forces cardio/mobility when the purpose's own scheme wants them. Also fixed live
  in the `exercises` table: Jump Rope's `shoulders` was miscategorized as a PRIMARY muscle (moved to
  secondary). Renamed generated titles from the generic purpose-only mapping ("15-Minute Muscle
  Builder") to `{Target Area} {Purpose}` ("15-Minute Legs Strength"). 2 new tests lock the cardio-
  leak fix both directions. **Runner (`plan.tsx`):** `doSkipExercise`'s `exercise_ids` write was
  fire-and-forget, so a pause immediately after skipping could race the next resume's reload and
  silently re-materialize the "skipped" exercise — the reported symptoms (estimated time looking
  wrong, Complete Workout never turning green after a skip); now awaited. "Add to workout
  permanently" no longer offered for Quick Workouts (one-off, no recurring template to persist into).
  Tapping the bottom rest-timer pill now opens Focus Mode. **New: a session under 5 minutes doesn't
  advance the streak** (`MIN_STREAK_MINUTES`, `lib/streak.ts`) — warns before finishing rather than
  surprising the user after; `actual_duration_min` threaded through `StreakRow` and every first-party
  streak-computing query. tsc clean, 378/378 tests (6 new). Two items from the same founder message
  explicitly deferred to N1/N2 in the Open Backlog above (Pro history-horizon model, workout/split
  edit-scope clarity) — both need a product decision + plan before code, not a quick fix.
- **2026-08-02 (session 3) — N1 and N2 built.** **N1 — Pro history horizon:** free sees the last 4
  months of training history, Pro sees all of it (`lib/historyHorizon.ts`, new `full_history` gate)
  — applied to `exercise-progress.tsx` (trend chart, not the all-time best-1RM/heaviest-set tiles or
  "last session," which are current-state facts, not history browsing), `muscle-history.tsx` (a new
  4M range chip is the real free ceiling; 6M/1Y/All are lock-icon chips), and `workout-history.tsx`
  (date filter + a raised row cap for Pro). Found and fixed a real bug while building this: the
  paywall's compare table and `launch.html` both already claimed free users get "full history,"
  predating the feature — corrected. `progress.tsx`'s own dashboard charts deliberately not touched
  (mixed current-state stats + historical charts via the shared hook — needs its own careful pass).
  **N2 — workout/split edit-scope clarity:** read `materializeSplit`'s actual behavior first, which
  resolved both open design questions from the original backlog write-up (see the N2 row above for
  the full reasoning) and surfaced a real underlying bug: "permanent" edits only ever touched the
  split TEMPLATE, which `materializeSplit` never re-syncs into already-materialized rows — so a
  "permanent" add silently had zero effect on the entire ~4-week rolling horizon of already-scheduled
  days, only on materializations past it. New `propagateSplitDayEdit` (`lib/splitSchedule.ts`) fixes
  this for real and is now wired into add/swap/skip in `(tabs)/plan.tsx`, each asking "this session
  only" vs. "every `{focus}` on your split" only when split-sourced. Also fixed a separate bug found
  along the way: "session only" adds never persisted to the DB, silently lost on pause/resume.
  `edit-session.tsx` gained a scope banner + split-editor link. 7 new tests across both features.
  tsc clean, 385/385 tests.
- **2026-08-02 — first-ever on-device (Simulator) pass ran on the Mac; every Tier-1 + Tier-2 finding
  fixed on Windows the same day.** The Mac session finally ran T1.2 for real (iOS Simulator, after
  fixing a CocoaPods `LANG`/locale issue), confirmed the three 2026-07-31 fixes (PREV blanking:
  fixed; Focus Mode auto-dismiss: fixed; muscle-history "See history": still broken), and found 6
  new Tier-1 (blocking) + 13 Tier-2 (real, non-blocking) issues via 5 parallel deep-dive reviews.
  **Tier 1, all closed:** (1) `retention-push` had zero auth check despite `verify_jwt=false` —
  closed with a Supabase Vault shared secret + `get_retention_push_secret()` RPC, confirmed live
  (unauthenticated POST → 401, real cron call → 200). (2) `edit-session.tsx` nulled
  weight/duration/distance/rep-range on every save — now preserves the original config unless the
  user actually touched that field. (3) `delete-account` never swept Storage — now removes
  `progress-photos`/`avatars` objects before deleting the auth user. (4) `muscle-history`'s "See
  history" compared mismatched muscle vocabularies (fixed via the existing `bodyMuscleOf()` mapper)
  and capped its history query oldest-first instead of newest-first (fixed). (5) Sentry source-map
  upload was disabled in both EAS profiles (`SENTRY_DISABLE_AUTO_UPLOAD`) — removed, `SENTRY_ORG`/
  `SENTRY_PROJECT` added; only the auth-token EAS secret is still a founder step. (6) A Live Activity
  import crashed EVERY cold launch on a from-scratch build — `expo-widgets` calls
  `requireNativeModule` eagerly at its own top level, so a static `import` threw before the existing
  try/catch (which only wrapped the `createLiveActivity()` call) could ever run; fixed with a guarded
  `require()` inside that same try/catch. **Tier 2, all closed:** `prefStorage.ts` write crash under
  Metro dev bundling; Home's displayed time-range/duration disagreement; `progression.ts`'s deload
  cut compounding on a same-session reactive grind-cut; `prForecast.ts` anchoring projected dates to
  `now` instead of the last logged session (silently ballooning during inactivity); two silent
  write-failure sites (`rescheduleWholeWeek`, `restampFuturePlanForExperience`) now mirror
  `adaptation.ts`'s failed-id tracking; a friend-feed streak-milestone broadcast used the
  session-count metric instead of a true distinct-day count (new `distinctDayStreak()`, W6 backlog
  row updated); `findCalendarConflicts` never surfaced all-day-event conflicts for free users; no
  in-flight guard on `handleSetDone`/`beginSession` (fast-double-tap double-insert risk); push-tap
  routing had no default case (added, scoped to retention-push notifications only); `app_open`
  double-fired on a notification-tap cold launch; calendar-autosync toggle-off was fire-and-forget
  with no failure feedback; Sign in with Apple silently no-op'd on a missing `identityToken`; and the
  PREV-blanking fix's own history query excluded the resumed session's rows in JS after the `.limit`
  instead of in the query itself. Apple token revocation on deletion needs founder-provided Apple
  Developer credentials that don't exist yet — queued as N3, not half-built. **Tier 3** (6 product/UX
  items from the founder's own live testing — muscle-history interactive chart + weight-progression,
  unit-toggle animation, a recurring tutorial-reappears bug needing real investigation, Coach
  redesign, Focus Mode read-only redesign) queued as T3.1–T3.6 in the Open Backlog, several
  explicitly needing founder input before building. Also queued from the founder directly this
  session (not audit findings): **N1** (Pro history horizon — free 4mo/Pro unlimited, across every
  progress surface + paywall + marketing) and **N2** (a written, unambiguous scope model for
  add/swap/remove/reorder across "this session" vs. "this day" vs. "the whole split" — needs a
  product decision + plan doc before code, per CLAUDE.md's Working Method). tsc clean, 372/372 tests
  (5 new). **Could not push to GitHub this session** — `git push` failed with a 403 (permission
  denied for the configured git account against `LazyLlama85/tempo.git`); all commits exist locally
  on `main` only until that's resolved.
- **2026-07-31 — founder bug reports fixed + muscle-level training history added.** (1) PREV column
  blanking after pause/resume, traced to `loadWorkout`'s history query not excluding the resumed
  session's own now-open log — one-line fix. (2) Focus Mode's "HOW MUCH DID YOU DO?" card now
  collapses once acknowledged instead of sitting up the whole rest period. (3) New `muscle-history`
  screen (sets-per-week trend + per-exercise breakdown, drilling into the existing `exercise-progress`
  screen rather than duplicating it) — reached from Body Intelligence's detail cards; `exercise-progress`
  also gained a new entry point from `ExerciseFormSheet`. tsc clean, 367/367 tests. Not yet on a device —
  T1.2 below still stands.
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
