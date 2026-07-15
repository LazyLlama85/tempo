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
- **Claude's next code batch:** **B1.3a — "Reschedule my whole week" engine.** Rationale: OTA-safe, does *not* depend on the OAuth fix, it's the payable wedge action, and it unblocks all of M2 (Pro re-fence + paywall trigger). Extends `lib/reschedule.ts` / `lib/autoSchedule.ts` — additive.
- **Handoff note (2026-07-15):** Foundation + wedge-visibility groundwork shipped (B0.1 ✅, B1.1 partial, B3.1 partial). The audit is now a living doc at the same URL. Next code session: run prompt ① then build B1.3a. Founder: knock out B0.2 in the console — it unblocks the Home timeline.
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
| B1.3a | "Reschedule my whole week" — engine | 🔲 | Subscription Value, Retention | `lib/reschedule.ts` / `lib/autoSchedule.ts` (extend) | One call re-slots all upcoming sessions; FK-safe; unit-tested |
| B1.3b | "Reschedule my whole week" — UI + guards | 🔲 | Subscription Value | `(tabs)/index.tsx` or a modal | One tap re-slots the week; offline/2-tap guards; calendar re-synced |
| B1.4 | "Lacking time? 15-min swap" on Home | 🔲 | Retention (busy persona) | `(tabs)/index.tsx` → existing `quick-workout` | A skipped-day escape hatch is one tap from Home |

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

- **2026-07-15 (pm)** — Debugged "Google connects but no events." Edge-fn logs = all 200, so token minting is healthy; the failure is the Calendar Data API rejecting a valid token (API not enabled and/or `calendar.events` scope not registered after going to production). Shipped an in-app diagnostic (`CalendarApiService.describeReadError`) that captures the real Google reason + fix hint to Sentry instead of swallowing to `[]`. Founder fix: enable Calendar API + register scope + reconnect. B0.2 → 🔄.
- **2026-07-15** — Built the Execution OS (`EXECUTION.md` + this ledger + CLAUDE.md Execution Protocol). Prior in this session: retention instrumentation (B0.1 ✅), wedge quantifier on Weekly Report + paywall (B1.1 partial), plain-language goal copy (B3.1 partial); audit re-scored Overall 5.6→5.7, Subscription Value 4→5. Feature freeze (B0.4) declared. **Next:** founder does B0.2/B0.3; Claude builds B1.3a.
