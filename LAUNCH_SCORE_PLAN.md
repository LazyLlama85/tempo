# Tempo — Launch Score Plan (raising PRODUCT_AUDIT.html toward its realistic launch ceiling)

> **Written 2026-07-23.** Companion to `PRODUCT_AUDIT.html` (the scorecard this targets),
> `MASTER_FIX_PLAN.md` (the bug/craft backlog this draws from), and `MONETIZATION_PLAN.md` (the
> conversion story). This is the ordered "what to do before launch" list, chosen so every item
> **(a) is launch-appropriate, (b) moves a real product-quality row, and (c) helps someone actually
> buy.** Almost nothing satisfies all three — the items below are the ones that do.

---

## 0. The honest target — read this first

The audit splits into **two** scores on purpose:

- **Product Score 5.9 / 10** (potential 8.2) — 40 rows measuring *delivered quality*. **Movable now.**
- **Market Proof Score 4.3 / 10** (potential 7.8) — 8 rows measuring *proven outcomes*. **Frozen.**

**8 rows cannot move before launch, by the document's own rule** — they need a real cohort to
transact or retain:

| Frozen row | Now | Why it can't move pre-launch |
|---|---|---|
| Retention | 4 | Needs a cohort that comes back (D7/D30). |
| Conversion Potential | 4 | Needs someone to actually pay. |
| Product-Market Fit | 5 | Needs proven demand. |
| Virality | 3 | Post-PMF growth lever. |
| Referral | 3 | Post-PMF growth lever. |
| Community Features | 3 | Post-PMF, M4-gated. |
| App Store Potential | 5 | Needs ASO + real ratings. |
| (part of) Trustworthiness | 5 | Trust-over-time needs time. |

**So "reach max potential (8.2) for launch" is not achievable, and chasing it is the wrong goal** —
half the low numbers are nailed down until users arrive. The realistic and correct target:

> **Lift the Product Score from 5.9 to ~7.0 pre-launch**, leave the Market Proof Score where it is
> (it moves *after* launch, on data), and — most importantly — **ship the two or three things that
> make the first cohort actually convert**, so the frozen rows can start moving the week you launch.

Everything below is ordered by that logic, not by point-count.

---

## Tier 1 — The conversion engine + de-risk (do these first)

These are cheap-to-medium, launch-critical, and the closest things to "makes people buy."

### T1.1 — Finish the proof-number as the **Home hero** (the number that sells the subscription)
**Status:** partially done. `lib/schedulingImpact` exists and appears on the Weekly Report card, a
Progress stat card, and paywall slide 0 — but the audit is explicit (§ Differentiation, Missing-
Feature #10, Final Verdict #1) that **the version that changes a new user's first impression is the
Home-tab hero**, and that is *not* built ("a stat card on a tab a user has to already open is not the
magic trick with the lights on"). This was B1.2, blocked on the Google Calendar console fix — **which
may now be unblocked** (OAuth was approved for production; verify before building).

**What to build:** replace Home's generic hero ("Train smarter. Never miss a workout.") with the
user's *own* number, large — **"Tempo has scheduled 14 workouts around your real life."** / sub:
"Keep it doing that — automatically." Move `fetchSchedulingImpact` above the fold, drop the ≥3
threshold to ≥1, and fall back to the generic line only when the number is genuinely thin.

**Rows it moves:** Value Proposition 5→7, Scheduling Experience 5→7, Differentiation 7→8.
**Why it sells:** it's the paywall's emotional engine made visible to *free* users every day — they
watch the wedge work, then the paywall leads with their own number. Highest-leverage conversion item
that isn't proof-gated. **Do this first.**

### T1.2 — On-device verification pass (the cheapest score unlock, and rejection insurance)
**Status:** not done. A large amount of recent work — the C3/C4 Coach batches, Apple Health, pause
mode, the notification fixes, the store-default blank-screen fix — is **tsc-clean and test-green but
never run on a physical device.** The audit flags this about Claude's *own* output, not
hypothetically.

**What to do:** an EAS build + a real iPhone (and the Pixel_8 AVD) walkthrough of the whole app —
onboarding as a fresh guest, log a session, reschedule, open every modal, exercise the paywall in
tester mode. Fix whatever surfaces. (Run Coach in stub mode: `EXPO_PUBLIC_COACH_STUB=1`.)

**Rows it moves:** Reliability 4→6, Polish 6→7, Trustworthiness 5→6 — none of which can *honestly*
rise until someone drives it on a phone. **Why it matters for launch:** a white-screen crash on a
reviewer's device is a rejection, and the founder-testing queue keeps surfacing real bugs (the
blank-body-map, the notification toggle revert, the reachable-Save-button ScrollView misses). This is
testing, not features — high value, low build cost.

### T1.3 — Realign price to the launch tier (dashboard only, zero code)
**Status:** currently $7.99/mo · $49.99/yr — a price `MONETIZATION_PLAN.md` §5 justified with a Coach
that is **not in the launch build**. Move to **$4.99/mo · $34.99/yr** so the price matches what the
launch tier actually is (scheduling control + muscle map + travel + creation caps = a Strong/Hevy-
class tier, which is $24–30/yr). Raise it the day Coach ships and apply-rate proves it — the plan's
own §5 note says exactly this, and there is no paying cohort, so raising later is clean.

**Rows it moves:** none directly (Monetization/Conversion are build-quality/proof), but it removes a
self-contradiction a reviewer or a churned free user would notice, and a cheap price with a coach
*story* converts better than a premium price with a utility *reality*.

---

## Tier 2 — Make Pro feel like a real tier on day one (medium build)

The audit's own skeptic pass (§ Monetization, "under-built Pro at launch") says launching on
reschedule-week + muscle map + travel is **thin for a "changes everything" pitch.** Tier 2 fixes that
without waiting for Coach.

### T2.1 — Ship one **foresight** surface: PR forecast *or* goal-date planning
**Status:** both registered (`long_horizon_planning`, PR forecasting), neither fully built.
**What to build (pick one):** PR/goal forecasting — "at this rate you'll hit a 2-plate bench by
October" — is the smaller build and the more universally compelling. It's the *right* kind of
analytics: foresight is payable, charts are not (the audit's central monetization lesson).

**Rows it moves:** Personalization 6→7, Subscription Value 6→7, Long-Term Defensibility 4→5.
**Why it sells:** it's the difference between "a few gates" and "a coaching tier" — a predictive
value prop a committed lifter wants, and a second real paywall moment beyond scheduling.

### T2.2 — (Founder's call) Deploy Coach and device-test it — biggest single product-row lever
**Status:** C1–C4 built; **undeployed, no API key, never on a device.** This is the *only* thing that
moves **AI Features 4→7** — the largest single Product-row jump available — and it's the
differentiator nothing else in the category has.

**The honest caveat:** it needs the founder to (1) buy an Anthropic key + (2)
`supabase functions deploy tempo-coach`, and then (3) a real device pass and a day of dogfooding
before it's paywall-honest. `MONETIZATION_PLAN.md` correctly sequences it as a **retention-proven
fast-follow**, not a launch blocker. **Recommendation:** launch *without* it (Tier 1 + T2.1 is
already a real Pro tier), keep it dormant, and ship it the moment retention holds — that's when it
lets you raise the price honestly and moves AI Features *and* Conversion together.

---

## Tier 3 — Craft & table-stakes (real, lower conversion impact)

Worth doing before launch, but *after* Tier 1–2. These lift the score and the "clearly better made
than Fitbod" feel; they don't change a buying decision on their own.

| Item | Source | Rows it moves |
|---|---|---|
| **T3.1 — Accessibility batch (C4)** — 808 touchables vs 110 labels; VoiceOver pass, `accessibilityLabel` on icon-only buttons, `accessibilityState` on chips | `MASTER_FIX_PLAN.md` C4 | Accessibility 4→6, Trust, ASO |
| **T3.2 — Fitness Science fixes** — the muscle-classification bug (lateral delts / abductors mislabeled) corrupts the recovery engine and volume-landmark "science" | `MASTER_FIX_PLAN.md` / audit § Fitness Science | Fitness Science 5→6 |
| **T3.3 — Remaining P1 craft** — split `plan.tsx` (3,315-line two-screen file), typed routes, list virtualization, dependency hygiene | `MASTER_FIX_PLAN.md` C5–C10 | Engineering Architecture 6→7, Polish, Speed |

---

## What NOT to do before launch (discipline)

- **Don't chase the frozen 8 rows** (Retention/Conversion/PMF/Virality/Referral/Community/ASO). They
  move on *data*, post-launch. Building for them now is effort the scorecard won't credit.
- **Don't rush Coach out** to justify the score or the price. Undeployed + untested = selling fiction,
  the worst outcome available to it.
- **Don't build new social/community surfaces.** M4-gated; breadth before depth, which the execution
  protocol rejects.
- **Don't grind Accessibility to its 7 ceiling** ahead of Tier 1–2. It's table-stakes, not a
  conversion lever.

---

## The sequence (one batch per session, per CLAUDE.md)

```
T1.1  Proof-number Home hero        → Value Prop + Scheduling + Differentiation   ← START HERE
T1.2  On-device verification pass   → Reliability + Polish + Trust  (+ de-risk)
T1.3  Price realignment (dashboard) → removes the self-contradiction  (founder, no code)
──────────────  the above three are the launch-critical minimum  ──────────────
T2.1  One foresight surface         → Personalization + Subscription Value
T3.1  Accessibility (C4)            → Accessibility + Trust + ASO
T3.2  Fitness Science fix           → Fitness Science
T3.3  P1 craft (C5–C10)             → Engineering Architecture + Polish
──────────────  fast-follow, after launch + retention proof (M4)  ──────────────
T2.2  Deploy + ship Coach           → AI Features + (eventually) Conversion, and the price raise
```

**Realistic outcome of Tier 1 + T2.1 + Tier 3:** Product Score ~5.9 → ~7.0, an honestly stronger
launch build, and — the actual point — a paywall built around a personalized proof number and a real
two-pillar Pro tier, which is what gives the frozen Conversion/Retention rows something to move *with*
once real users arrive.

*Update `PRODUCT_AUDIT.html`'s Update Log + scorecard as each batch lands, per the Audit Artifact
Protocol.*
