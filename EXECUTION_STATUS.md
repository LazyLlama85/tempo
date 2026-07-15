# Tempo — Execution Status (the living ledger)

> **READ THIS FIRST every session. UPDATE IT LAST every session.**
> Plan + workflow + prompts: `EXECUTION.md`. Diagnosis + scores: `PRODUCT_AUDIT.html`.
> Status legend: 🔲 Not Started · 🔄 In Progress · ✅ Completed · 🔍 Needs Review (on-device) · ⏸ Postponed · ❌ Rejected

---

## ▶ CURRENT FOCUS  *(the resume point — a fresh session continues from exactly here)*

- **Milestone:** M0 — Measurable & Reliable *(with M1 code work running in parallel)*
- **Founder's critical path (only you can do these — do them this week):**
  - **B0.2** — ✅ *In production* already. **New sub-issue found:** Google connects + token mints fine (edge-fn logs all 200), but events don't show → the Calendar **Data API** call is being rejected with a valid token. Fix in console: **(1)** APIs & Services → Library → enable **Google Calendar API**; **(2)** Auth Platform → **Data Access** → add scope `.../auth/calendar.events`; then **disconnect + reconnect** Google in the app. In-app diagnostic shipped (the real reason now goes to Sentry).
  - **B0.3** — In PostHog, build the funnel `onboarding_complete → activation_reached → D7 retained`, and write the one-line activation definition. Data already flows (B0.1 ✅).
  - **B0.5** — Smoke-test the current build on your iPhone; report any blank-render so it can be fixed.
- **Claude's next code batch:** **B1.3b — "Reschedule my whole week" UI + guards.** The engine (B1.3a) is ✅ shipped (`lib/weekReschedule.ts` pure planner + `reschedule.rescheduleWholeWeek` I/O wrapper, 6 unit tests). Next: a one-tap Home/Today entry that calls it, with offline + 2-tap confirm guards and a calendar re-sync toast. This then unblocks M2 (B2.1 re-fence Pro around it, B2.2 paywall trigger on the reschedule-week action).
- **Handoff note (2026-07-15):** Foundation + wedge groundwork shipped (B0.1 ✅, B1.1 partial, B3.1 partial); **B1.3a engine ✅** (`00cf49e`, OTA-safe, unit-tested, no UI yet). Off-roadmap: Muscle Map real body shipped at founder's call (`10d2a64`). **Reliability fix landed:** silent "Remove workout" (Alert-over-Modal on iOS) → in-sheet confirm (see session log). **New roadmap row B1.5** (multi-calendar) logged as founder-blocked + deferred — do NOT reorder ahead of the in-flight `calendar.events` verification. Next code session: build B1.3b (UI over the new engine) — ⚠️ a second session was also handed B1.3b; check `git log` for a B1.3b commit before starting to avoid colliding in `(tabs)/index.tsx`. Founder: let the current calendar verification finish (don't add scopes mid-review).
- **Last updated:** 2026-07-15

---

## Ledger — every audit recommendation, tracked

Each row names the **metric it moves** (per EXECUTION.md §9 — a batch that moves no metric gets cut).

### M0 — Measurable & Reliable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B0.1 | Retention instrumentation (`activation_reached` + `calendar_connected`) | ✅ | Measurability | `lib/activation.ts`, `analytics.ts` | Events fire once, behind durable flags *(shipped)* |
| B0.2 | Google OAuth → Production (done) + fix "connects but no events" | 🔄 | Reliability, Trust | Console: enable Calendar API + register `calendar.events` scope *(founder)*; in-app diagnostic ✅ `CalendarApiService.describeReadError` | Events render on device after enabling API + reconnect |
| B0.3 | PostHog funnel + written activation definition | 🔲 | Measurability | PostHog dashboard *(founder)* | Funnel onboarding→activation→D7 visible |
| B0.4 | Feature-freeze policy (no new surfaces until M4) | ✅ | Focus | `EXECUTION.md` §2/§9 | Written + in effect |
| B0.5 | Device-matrix QA of redesign; fix any blank-render | 🔲 | Reliability, Polish | Real device *(founder)* + fixes as found | No blank-render on cold start on device |

### M1 — The Wedge, Undeniable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B1.1 | Wedge quantifier (`schedulingImpact`) | 🔄 | Value Prop, Differentiation | `lib/schedulingImpact.ts`; done on `weekly-report.tsx` + `paywall.tsx`; **left:** a Home/Progress surface | Count visible on a primary tab, not just side screens |
| B1.2a | Calendar day-timeline — data/selector | 🔲 | Differentiation | `lib/` selector over calendar-sync + scheduled workouts | Pure fn returns today's busy blocks + slotted workout; unit-tested |
| B1.2b | Calendar day-timeline — Home hero UI | 🔲 | Differentiation, UX, Activation | `(tabs)/index.tsx` + a new timeline component | New user sees slotted-time magic on Home in < 30s *(needs B0.2)* |
| B1.3a | "Reschedule my whole week" — engine | ✅ | Subscription Value, Retention | `lib/weekReschedule.ts` (pure planner) + `reschedule.rescheduleWholeWeek` (I/O) | ✅ One call re-slots all upcoming sessions; FK-safe; 6 unit tests *(shipped `00cf49e`)* |
| B1.3b | "Reschedule my whole week" — UI + guards | 🔲 | Subscription Value | `(tabs)/index.tsx` or a modal | One tap re-slots the week; offline/2-tap guards; calendar re-synced |
| B1.4 | "Lacking time? 15-min swap" on Home | 🔲 | Retention (busy persona) | `(tabs)/index.tsx` → existing `quick-workout` | A skipped-day escape hatch is one tap from Home |
| B1.5 | Multi-calendar: read/select beyond `primary` | 🔲 (founder-blocked, deferred) | Differentiation, Trust (no double-booking); Pro (multi-cal gate → B2.1) | Google console scope `calendar.calendarlist.readonly` *(founder)*; then `CalendarApiService` (enumerate via CalendarList, read selected) + a picker | User picks which calendars count; scheduling avoids busy time on all of them. **Sequencing (do NOT reorder):** (1) let the in-flight `calendar.events` verification finish first — adding a scope now re-opens that pending review; (2) Claude builds the picker; (3) only THEN add the scope + record a NEW demo video showing it (Google requires each sensitive scope be demonstrated in-app — can't film a feature that doesn't exist). `calendar.events` alone cannot list calendars. Not on the M4 critical path |

### M2 — It Sells Itself
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B2.1 | Re-fence Pro: free analytics, gate scheduling | 🔲 | Conversion ×3–4 | `proFeatures.ts`, `ProGate` usage on Progress + scheduling actions | Analytics free; auto-reshuffle/reschedule-week/multi-cal are Pro *(needs B1.3)* |
| B2.2 | Paywall triggers at the payable moment | 🔲 | Conversion | `useProGate` call sites (reschedule-week, 2nd calendar) | Paywall fires on the wedge action, not a random 1st workout |
| B2.3 | Pricing raise + trial config | 🔲 | ARPU | RevenueCat dashboard *(founder)* + paywall copy | Annual ~$49–59; 7-day trial; annual default |

### M3 — Week One Doesn't Bleed
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B3.1 | Plain-language copy sweep | 🔄 | Beginner activation | goals ✅ in `onboarding/goal.tsx`; **left:** level sub-copy, paywall, misc | No gym jargon anywhere in first-run |
| B3.2 | Progressive disclosure (hide social/groups/map for new users) | 🔲 | Week-1 retention | tab/nav gating keyed on activation state | New users don't see social/groups/muscle-map pre-activation |
| B3.3 | Onboarding aha (animate calendar) + time-budget question | 🔲 | Activation | `onboarding/plan-preview.tsx`, `onboarding/schedule.tsx` | Plan reveal animates workouts into the calendar; time-budget captured |

### M4 — It Holds a Cohort  *(gate: D7 trending up before growth spend)*
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B4.1 | Single-player accountability loop | 🔲 | D7/D30 retention | new `lib/` + Home surface | A commit/streak-save loop that works with zero friends |
| B4.2 | Referral program (give a month / get a month) | 🔲 | Virality, CAC | Supabase migration + edge fn + UI | Referral link issues + credits a month, end-to-end |
| B4.3 | Cohort retention analysis + iterate | 🔲 | Retention | PostHog *(founder + data)* | D1/D7/D30 measured for ≥ 2 cohorts, trend read |

### M5 — Credible & Hardened
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B5.1 | Honest readiness label | 🔲 | Trust, Science | readiness card copy | Labeled "from your recent training"; never a gate |
| B5.2 | HealthKit import (sleep/HR/steps) | 🔲 | Science, Readiness | native module → `eas build` | Real signal feeds readiness |
| B5.3 | Readiness → scheduling feedback | 🔲 | Differentiation | scheduling + readiness libs | Low readiness suggests moving today's heavy session |
| B5.4 | Volume landmarks (MEV/MRV) under the hood | 🔲 | Science credibility | `progression`/`periodization` libs | Volume titrates by landmark; no new UI complexity |
| B5.5 | Integration/E2E tests on state machines | 🔲 | Reliability | test harness over plan/split/calendar | The recurring near-catastrophic bug classes are covered |

### M6 — Growth & Table Stakes
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B6.1 | Wedge-led App Store listing | 🔲 | Install→page conv. | App Store Connect *(founder + copy)* | Screenshot 1 = calendar with slotted workout |
| B6.2 | One acquisition channel (calendar-trick content) | 🔲 | Top-of-funnel | *(founder)* | A repeatable weekly motion running |
| B6.3 | "Year in Training" annual Wrapped | ⏸ | Organic growth | `lib/wrapped.ts` (extend) | *(postponed past M4)* |
| B6.4 | Table-stakes polish (Watch, widget, Live Activity, superset, plate calc, named programs, exercise prefs, adaptation-visible) | ⏸ | Various | various | *(each unlocked only as data justifies — pull individually from the pool)* |

### Deferred / Rejected pool  *(tracked so nothing is "forgotten" — but not active)*
| Item | Status | Reason |
|---|---|---|
| More Progress analytics depth | ❌ | Over-built; charts don't retain/convert |
| New social/community/groups surfaces | ❌ | No network yet; hide (B3.2), don't extend |
| Muscle-map / readiness *polish* | ❌ | Fitbod echo, not the wedge |
| Premium themes/icons as headline Pro | ❌ | Bonus flair, not a subscribe reason |
| Nutrition tracking | ❌ | Link to MFP, don't build |
| AI photo form-analysis · voice logging · watch-face complication | ❌ | Flashy, high-effort, not the wedge |
| Program marketplace · B2B/coach mode · corporate wellness | ⏸ | M-Future; earn $1M ARR first |
| Localization · cardio/running plans | ⏸ | Post-PMF growth levers |
| Tempo Coach (LLM tentpole) | ⏸ | Real, but only after wedge + retention proven |
| Apple Watch · home-screen widget · Live Activity rest timer | ⏸ | Postpone past M4 (retention proof) |
| Volume landmarks · progress-photo timeline · strength benchmarks · pause-plan mode · smart-notif timing | ⏸ | Nice-to-have; pull in during M5/M6 as justified |

---

## Session Log  *(newest first — the audit trail of what actually happened)*

- **2026-07-15 (pm3)** — **Bug fix (reliability): silent "Remove workout."** Founder reported *Edit a workout → Remove → nothing happens*. Root cause: `EditWorkoutSheet` fires `Alert.alert` to confirm removal, but a system Alert can't present over the sheet's RN `<Modal>` on iOS — it silently no-ops. Replaced with an **in-sheet inline confirm** (Keep it / Remove) + **inline error text** for the save/remove failure paths (same Alert-over-Modal flaw). Removed the now-unused `Alert` import; `doRemove` now throws on a Supabase error (was swallowed) so failures actually surface. `tsc` clean, 143 tests green. Documented as a "do-not-regress" gotcha in `ARCHITECTURE.md` (TempoSheet section) — it's the 4th silent-native-failure variant (gorhom no-op / Reanimated blanks / nested-Modal freeze / Alert-over-Modal), which is exactly the fragility Reliability=4 reflects (reinforces B5.5's priority). **Scope finding logged (B1.5):** `calendar.events` can read/write any calendar by ID but CANNOT list calendars — a picker needs the added sensitive scope `calendar.calendarlist.readonly` + a NEW demo video; advised founder to NOT amend the in-flight verification. Files: `components/EditWorkoutSheet.tsx` + docs.
- **2026-07-15 (pm)** — **B1.3a ✅ shipped** (`00cf49e`): "Reschedule my whole week" engine. Pure `lib/weekReschedule.ts` planner (`planWeekReschedule` — recovery-aware best-day + calendar-aware time, one/day, never drops a session, no churn) + `reschedule.rescheduleWholeWeek` DB/calendar wrapper (writes only changed rows, resyncs each moved event, FK-safe, runs even in manual mode). 6 new unit tests; 143 total green; my files tsc-clean. **Next: B1.3b** (one-tap UI + guards over the engine), which unblocks M2.
- **2026-07-15 (pm)** — Muscle Map swapped to a real anatomical body (`react-native-body-highlighter`, MIT, OTA-safe; `MuscleMap.tsx` public API unchanged, `tsc` + 137 tests green, commit `10d2a64`). **Off-roadmap** — this is the Rejected-pool "muscle-map polish" item, shipped at founder's request because it was already built. No score moved. Now resuming the freeze → next code batch is **B1.3a**.
- **2026-07-15 (pm2)** — Refined the calendar diagnosis with new evidence: Calendar API is **Enabled** and Cloud metrics show **200** responses → Google IS returning events; the token/scope/API are fine (no resubmit needed; verification pending is harmless). So the "no events" is **client-side filtering**: `fetchUserEvents` only keeps **timed** events on the **primary** calendar — all-day events and secondary/shared calendars are dropped. Shipped a second diagnostic (`gcal_events_hidden`) that reports to Sentry when Google returns events but all are filtered (with an all-day count). **Founder self-test:** add a timed event to your primary Google calendar tomorrow → reopen the app. ⚠️ **Build blocker found:** `app/social.tsx` has curly/smart quotes (from a paste) breaking `tsc` across the file — needs a straight-quote fix before any build.
- **2026-07-15 (pm)** — Debugged "Google connects but no events." Edge-fn logs = all 200, so token minting is healthy; the failure is the Calendar Data API rejecting a valid token (API not enabled and/or `calendar.events` scope not registered after going to production). Shipped an in-app diagnostic (`CalendarApiService.describeReadError`) that captures the real Google reason + fix hint to Sentry instead of swallowing to `[]`. Founder fix: enable Calendar API + register scope + reconnect. B0.2 → 🔄.
- **2026-07-15** — Built the Execution OS (`EXECUTION.md` + this ledger + CLAUDE.md Execution Protocol). Prior in this session: retention instrumentation (B0.1 ✅), wedge quantifier on Weekly Report + paywall (B1.1 partial), plain-language goal copy (B3.1 partial); audit re-scored Overall 5.6→5.7, Subscription Value 4→5. Feature freeze (B0.4) declared. **Next:** founder does B0.2/B0.3; Claude builds B1.3a.
