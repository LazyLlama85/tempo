# Tempo — Monetization Plan (Free vs Pro)

> **Status:** strategy document, drafted 2026-07-18. **Nothing here is live.** Pro is still dormant
> behind the remote `pro_enabled` flag (`lib/proConfig.ts` / `stores/entitlements.ts`); this plan
> exists so that flipping it on is a one-day, high-confidence job rather than a guess. It respects
> the founder's standing "wait a month on monetization config" instruction — this is the *what/why*,
> not the flip.
>
> **Companion files:** `PRODUCT_AUDIT.html` §13 (the diagnosis this answers), `proFeatures.ts` (the
> gate registry this maps onto), `PRO_LAUNCH_CHECKLIST.md` (the mechanical setup), `EXECUTION.md`
> M2 (the milestone this closes).

---

## 0. TL;DR — the one sentence

> **Free proves the wedge on autopilot: "Tempo plans my week and it just works."
> Pro turns Tempo into the coach that *runs* your training — command it, see months ahead, go deep,
> and let it reprogram anything.** The core training loop is free forever (log unlimited sessions,
> run your adaptive plan, use the whole library); Pro unlocks *depth, foresight, and unlimited
> creation* on top.

> **FOUNDER DECISION (2026-07-18):** keep the **current price** ($4.99/mo · $34.99/yr) and give the
> free tier real limits on **user-created content** — **1 Tempo plan + 1 custom plan, 5 custom
> exercises, 5 saved custom workouts.** This is the *freemium content-cap* model (Hevy/Strong), and
> it's internally consistent: a Strong/Hevy-level price paired with a Strong/Hevy-level free cap. It
> replaces this doc's original "raise price, keep free generous" recommendation — both are valid
> strategies; this is the chosen one. The rest of the plan (pillars, paywall placement, the proof
> number) is unchanged and now *more* important, since a lower price needs higher volume to pay off.

Everything below is how we get there, grounded in what people actually pay for, what the apps making
real money do, and what the audit already told us.

---

## 1. What people actually pay for (2026 research)

The data is unambiguous on three points, and they should shape every decision here:

1. **People pay for outcomes and personalization, never for content or charts.** Apps that gate
   *personalization* convert materially better; users pay for "make my result happen," not "show me
   more data." (adapty.io; nyusoft) — This is the audit's central indictment of Tempo's old gate:
   *"Nobody has ever churned onto a fitness app to see volume charts."*
2. **Annual-first, trial-led, priced with conviction.** Annual plans are the only plan type *growing*
   their revenue share; high-priced annual plans earn ~4.5× more per user than cheap ones; a 7-day
   trial is one of the highest-leverage levers in the category (trial users retain 8–60% better at
   first renewal). (adapty.io; RevenueCat State of Subscription Apps)
3. **Conversion is a slow, earned number.** Health & Fitness median free→paid is ~2.9% (typical band
   2–5%); *trial*→paid medians ~40%, top decile ~68%. Value-moment paywalls beat immediate hard walls
   ~2.1× on trial starts, because the product's value (habit, visible progress) takes time to feel.
   (adapty.io; businessofapps; firstpagesage)

**What users will actually open their wallet for (ranked, from the research):** hyper-personalized
plans that adapt to *them* · time-saving / "handle my chaotic week" · accountability & a coach ·
foresight toward a goal · an integrated system that manages more than one thing. Tempo is unusually
well-positioned on **time-saving, personalization, and coaching** — those are its Pro pillars.

**Sources:**
[adapty.io H&F benchmarks](https://adapty.io/blog/health-fitness-app-subscription-benchmarks/) ·
[RevenueCat State of Subscription Apps](https://www.revenuecat.com/state-of-subscription-apps) ·
[Business of Apps — Fitness market](https://www.businessofapps.com/data/health-fitness-app-benchmarks/) ·
[First Page Sage — freemium conversion](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/) ·
[nyusoft — fitness monetization](https://nyusoft.com/fitness-app-monetization-strategies/) ·
[Airbridge — subscription pricing by category](https://www.airbridge.io/en/blog/subscription-app-pricing-by-category-2026-benchmark)

---

## 2. What the apps making real money actually do

| App | Price (2026) | Free tier | What they gate (the lesson) |
|---|---|---|---|
| **Hevy** | $2.99/mo · $23.99/yr · $74.99 life | Best-in-class: unlimited workouts, 4 routines, 3-mo history, ads | Routine count + history depth + ads. Free is a *loss-leader hook*. |
| **Strong** | $4.99/mo · $29.99/yr · $99.99 life | Unlimited logs, full history, no ads; **capped at 3 routines** | Pure logging is free; *structure* (routines) is paid. |
| **Fitbod** | $15.99/mo · $95.99/yr | **None** — 7-day trial then the app stops | Gates the *whole* personalized-plan engine. High price, high friction. |
| **Strava** | $11.99/mo · $79.99/yr · $139.99 family | Generous free activity tracking | Gates analysis, segments, planning — the *power-user* layer. |
| **RP Hypertrophy** | $34.99/mo · $299.99/yr | None | Premium *programming/coaching* science. Charges like a coach. |
| **Caliber** | $19/mo (group) · $200/mo (1:1) | Free tracking | Human accountability is the premium tier. |
| **Whoop** | $199–359/yr (hardware) | None | Sells the *outcome system*, not the app. 90% annual retention. |

**The three moves worth copying, and the two to avoid:**

- ✅ **Free must be genuinely usable long-term** (Hevy/Strong) — it's the top of the funnel and the
  proof. Tempo already believes this; keep it.
- ✅ **Charge like the outcome you deliver, not like a rep-logger** (Fitbod/RP/Whoop). Tempo's promise
  is "reclaim your chaotic week + train seriously." That is worth *more* than $30/yr.
- ✅ **Annual-first, trial-led, lifetime as an anchor** (Strong/Hevy both offer lifetime).
- ❌ **Don't gate the wedge itself.** Fitbod gates the engine and pays for it in friction; Tempo's
  wedge (auto-scheduling around real life) must stay free or the funnel never fills.
- ❌ **Don't gate charts/history as the headline** (the old Tempo mistake). It's the one thing every
  competitor gives away.

---

## 3. The dividing line — the theory of Free vs Pro

The hard question the audit raised: *Tempo's wedge — auto-scheduling your week around real life — is
the thing worth money, and today it's free. Do we gate it?*

**Answer: No — we gate its power expression, not its existence.** The wedge must be free to hook, but
there is a clean, honest line between **"Tempo does this for me automatically for my one plan"**
(free) and **"I command Tempo, and it sees/does far more"** (Pro). Concretely:

- **Free = the wedge on autopilot.** Tempo silently fits your *one* adaptive plan around your primary
  calendar. You experience "it just works." This is the whole hook, fully functional.
- **Pro = the wedge under your control, with foresight and intelligence.** One-tap re-plan the *whole*
  week on demand; read *every* calendar; rewrite for travel; see and shape *months* ahead; go deep on
  the *why*; and (fast-follow) a coach that reprograms on command.

This keeps the **"no hard caps on the core loop"** promise the app was built on (you can always plan,
log, train, adapt — free, forever) while making Pro feel like a genuine *transformation* from
"an app that plans my week" into "a coach that runs my training." That's the "changes everything"
feeling — delivered by *adding power*, not by crippling free.

---

## 4. Exactly what's Free vs Pro

### 🟢 FREE — the core training loop, uncapped forever (never gate these)
The line the caps must never cross: a free user must be able to *train forever* without hitting a
wall. Capping how much custom content you can *create* is fine; capping the *core loop* is not.

- **The engine:** plan generation, periodization/mesocycles, adaptive deloads, experience promotion —
  the full adaptive brain.
- **Ambient auto-scheduling** around your **primary** calendar (the wedge — free forever).
- **Your living Tempo plan**, always adapting to you (this is the "1 Tempo plan" — you only need one;
  it adapts).
- **Quick Workout** (minutes + focus → a session that fits).
- **Unlimited logging:** every set, RPE, warm-ups, edit-after-the-fact, unilateral weights. *(Never
  capped — Hevy/Strong both give unlimited logging free; capping it would be a category faux-pas.)*
- **The full 1,300+ exercise library** with form GIFs + instructions.
- **Basic progress:** streak, consistency, volume trend, workout history, PRs list, body-weight log.
- **Streaks, badges, and social** (already built; disclosure-gated by activation, not by Pro).
- **Pre-workout reminders** + retention nudges.
- **Account, calendar sync (primary), sign-in, data export/delete.**

**Free tier limits (founder decision 2026-07-18) — on *created content* only:**
| Limit | Free | Pro | Notes |
|---|---|---|---|
| Adaptive Tempo plan | 1 | 1 (+ unlimited custom) | You only need one — it adapts. Not really a "cap." |
| Custom plans (hand-built) | 1 | Unlimited | The Strong "routines" lever, applied to *plans*. |
| Custom exercises (user-created) | 5 | Unlimited | The 1,300 library stays fully free; only *your own* additions are capped. |
| Saved custom workouts | 5 | Unlimited | Interpreting "5 workouts" = 5 saved custom workout templates (not 5 logged sessions — logging is unlimited). |

> These numbers are gentle enough that a casual free user rarely hits them, but a *committed* user —
> exactly the one who'd pay — bumps into them naturally once they start building their own stuff.
> That's the right kind of cap: it converts intent, not access.

### 🔵 PRO — "Tempo becomes your coach." Four pillars.

**Pillar 1 — CONTROL (the wedge, on command)**
- **Reschedule My Whole Week** — one tap re-lays every upcoming session around a busy stretch,
  recovery-aware. *(built: `lib/reschedule.rescheduleWholeWeek`)*
- **Multi-Calendar** — read busy time from *every* calendar, not just primary, so Tempo never
  double-books. *(built, dormant behind an OAuth scope — `multi_calendar`)*
- **Travel Mode** — rewrite upcoming workouts to whatever gear you have on the road. *(built:
  `travel_mode`)*
- **Unlimited creation** — free includes your adaptive Tempo plan + 1 custom plan + 5 custom
  exercises + 5 saved custom workouts (§4 table); Pro removes all four caps. This is the Strong/Hevy
  "routines" lever, and it's the primary conversion driver at the current price point.

**Pillar 2 — FORESIGHT (outcomes, not history)**
- **Long-horizon / goal-date planning** — set a date ("strong by my ski trip"), see and shape the
  training blocks months ahead. *(registered: `long_horizon_planning`)*
- **PR & goal forecasting** — "at this rate you'll hit a 2-plate bench by October." Predictive, not
  retrospective — this is the analytics that's *worth paying for* (the audit is right that *charts*
  should be free; *foresight* is the Pro half).

**Pillar 3 — INTELLIGENCE (personalization you can perceive)**
- **Muscle Intelligence** — interactive body map: balance, recovery status, weak points, muscle by
  muscle. *(built: `muscle_intelligence`)*
- **Advanced deep-dives** — per-lift strength curves, weak-point detection, volume-landmark awareness.
- **Coaching insights & smart notifications** — personalized recovery/schedule-change nudges.
  *(registered: `smart_notifications`)*

**Pillar 4 — COACH (the tentpole — fast-follow, not launch)**
- **Tempo Coach** — reprogram on command in plain language, and it *explains every decision*. This is
  the RP/Caliber "pay for coaching" instinct, delivered by Tempo's engine. Ships *after* launch once
  the wedge + retention are proven; it's the reason the annual price has room to rise later.
  *(registered: `tempo_coach`)*

**Bonus (cheap flair, not a headline reason to pay):** premium themes + custom app icons + profile
flair. *(built: `premium_personalization`)* — keep it in the paywall's "and also…" row, never the hero.

---

## 5. Pricing & trial (founder decision 2026-07-18: keep current price)

**Chosen: keep the current $4.99/mo · $34.99/yr.** This pairs deliberately with the capped free tier
(§4) — the Hevy/Strong "cheap-Pro + capped-free" model. It's a coherent, proven combination.

| Plan | Price | Notes |
|---|---|---|
| **Annual (lead offer, default-selected)** | **$34.99/yr** | ~$2.92/mo framing; anchor of the paywall. 7-day free trial. |
| **Monthly** | **$4.99/mo** | Makes annual the obvious value (annual = ~7 months' price for a year). |
| **Lifetime (optional)** | e.g. **$79.99–$99.99** | Strong/Hevy both offer it at ~$75–100. Captures sub-averse buyers; price it so it never undercuts a couple years of annual. **Founder's call whether to offer.** |

- **Trial:** 7-day free trial **on annual**, annual pre-selected, hard trial-reminder the day before it
  converts (transparency > dark patterns; also cuts refunds/chargebacks).
- **Positioning:** free tier more generous than Fitbod (which has none) and on par with Hevy/Strong;
  Pro priced right at the Hevy/Strong band ($24–35/yr). The story: *"free is genuinely usable; Pro is
  cheap and removes every limit."*

> **The honest tradeoff to keep in mind (the skeptic's note):** at this price, the business is a
> **volume game** — $34.99/yr × a 2–5% conversion needs a *lot* of installs to matter, and a low
> price signals "utility," not "premium coach." The counter-argument (and why this is still a fine
> call): a cheap, clearly-capped free tier converts *more* of the people who do hit the wall, and
> Tempo can always raise the price later once the value story (Coach, foresight) is thicker and
> proven — raising price on *new* cohorts is easy; there's no paying cohort to grandfather today.
> Revisit the price the same day Tempo Coach ships.

*(Prices live in the RevenueCat dashboard; the paywall code is offering-agnostic and reads them live,
so a future price change is a dashboard change, not a code change.)*

---

## 6. Where the paywall fires (the payable moments)

**Rule: trigger at the moment the user reaches for a Pro superpower — never after a random first
workout** (the audit explicitly flags the old post-first-workout trigger as wrong; it's a
device-local-flag anti-pattern that also misfires for reinstalls).

Fire the paywall at these value moments (each maps to a `requirePro(context)` call site):
1. First tap on **Reschedule My Whole Week**.
2. Connecting a **second calendar**.
3. Tapping **Travel Mode**.
4. Opening **long-horizon / goal-date planning**.
5. Tapping **Muscle Intelligence** or a **PR forecast**.
6. **Hitting a free cap** (the primary trigger at this price): creating a **2nd custom plan**, a **6th
   custom exercise**, or a **6th saved custom workout**. Each cap-hit is a natural, non-annoying
   paywall moment — the user is mid-creation and *wants* the thing, which is the highest-intent state
   there is. Copy stays honest and generous: *"You've used your free custom workouts — go unlimited
   with Pro,"* never a scolding wall.

**The emotional engine — the proof number.** Build/finish the `schedulingImpact` counter (audit
missing-feature #10 — *"the number that sells the subscription"*): **"Tempo fit N workouts into your
real week this month — sessions you'd have skipped."** Free users accumulate it (it *is* the wedge,
made visible); the paywall leads with *their own* number. That single line does more than any feature
list — it's personalized proof of the outcome they'd be paying to keep and amplify.

**Onboarding:** *no* hard onboarding wall (Tempo's thesis is "prove the wedge first"). Instead, a
skippable "Pro exists — here's a 7-day free trial" card at the honest reveal, and the real conversion
work happens at the value moments above. Value-moment > immediate-wall by ~2.1× on trial starts for
this exact reason.

---

## 7. What's already built vs. what's needed

**Already built (dormant — do not rebuild):**
- The whole entitlement system: `proEnabled × isPro → locked`, comp grants, tester override
  (`stores/entitlements.ts`).
- Custom on-brand paywall with live/dynamic pricing, trial CTA, restore, legal links (`app/paywall.tsx`).
- The gate registry + copy (`lib/proFeatures.ts`) and `ProGate`/`ProLockCard`/`ProBadge` components.
- Purchase funnel analytics; `/paywall` route; RevenueCat SDK + iOS key in `eas.json`.
- Live-buildable gates already coded: reschedule-week, muscle intelligence, travel mode, multi-calendar
  (multi-calendar waits on the OAuth scope).

**Needed to go live (all founder-side, mostly dashboard — this is why the plan matters more than code):**
1. RevenueCat dashboard: create the `pro` entitlement (⚠️ the id must match `eas.json`'s
   `"Tempo: Fitness Planner Pro"` *exactly* or purchases succeed but never unlock), 3 products
   (annual/monthly/lifetime), attach the offering, configure the 7-day trial.
2. Set the real `appl_` / `goog_` API keys (currently a `test_` store key).
3. Apply `add_app_config.sql` + allow-list the founder's uuid for sandbox testing on TestFlight.
4. An **EAS build** (RevenueCat is native — a JS/OTA reload won't pick it up).
5. Raise prices to §5 in the dashboard.
6. Wire the remaining `requirePro()` call sites from §6 (OTA-shippable once the gates' screens exist).
7. Build the **proof-number** counter + finish **PR forecasting** and **long-horizon UI** (the two Pro
   surfaces that are registered but not yet fully built).

**Sequencing (respects M2 + the freeze):**
`[A] finish the proof number & the 2 missing Pro surfaces (OTA)` →
`[B] RevenueCat dashboard + prices + EAS build` →
`[C] flip pro_enabled for the founder only, sandbox-buy every SKU on TestFlight` →
`[D] soft launch: flip pro_enabled globally with the value-moment triggers` →
`[E] fast-follow Tempo Coach once retention holds (M4)`.

---

## 8. Potential problems with this design (the skeptical pass)

Per Tempo's working method — arguing to *reject* this before recommending it:

- **"Free is so good nobody upgrades."** Real risk. Mitigations: (a) the proof-number makes free users
  viscerally aware of the value they're getting *and* what more control would add; (b) the Pro pillars
  are things a *committed* trainer wants weekly (reschedule-week, multi-calendar, foresight), not
  nice-to-haves; (c) we can tighten later (e.g., cap custom programs, or make reschedule-week a
  limited number of free uses) **without** breaking the core loop — but start generous and let data,
  not fear, drive any tightening.
- **"The wedge is free, so we're giving away the crown jewel."** We give away the *automatic* wedge;
  we sell *control over* it. This is the Strava playbook (free tracking, paid analysis/planning) and it
  works. The alternative — gating the wedge like Fitbod — kills the funnel Tempo's whole strategy
  depends on.
- **"Under-built Pro at launch."** Launching on reschedule-week + muscle map + travel mode is thin for
  a "changes everything" pitch. Fix: don't launch the *global* flip until the proof-number + one
  foresight surface (PR forecast or goal-date) are in — that's the difference between "a few gates" and
  "a coaching tier." Coach is the tentpole that makes it undeniable, but it's a fast-follow, not a
  blocker.
- **"App Store rejection."** Apple rejects paywalls advertising unbuilt features. `proFeatures.ts`
  already enforces "only sell what ships today" — keep `PAYWALL_POINTS` truthful; add a bullet only
  when its surface is live. Multi-calendar stays out of the paywall until its OAuth scope is granted.
- **"Price shock vs the current $34.99."** No existing paying cohort exists (Pro is dormant), so
  there's no grandfathering problem — set the right price *before* anyone pays, not after.
- **"Conversion won't move."** It's a proven-outcome metric; this plan *enables* the number, it doesn't
  *prove* it. Ship it, then let a real cohort move the audit's Conversion score. No vanity re-scores.

---

## 9. Success metrics & targets (once data flows)

- **Trial start rate** at the value moments — target ≥ the category's onboarding-trial baseline once
  triggers are placed (vs ~0% today, since Pro is dormant).
- **Trial→paid** — category median ~40%; aim for the upper half by keeping the trial honest and the
  gated features genuinely weekly-useful.
- **Free→paid overall** — 2–5% is the realistic band; >5% would be top-decile and would mean the
  proof-number + foresight pillars are landing.
- **Annual mix** — target majority-annual (it's the lead offer); annual LTV is the whole business.
- **No core-loop regressions** — free DAU/retention must not dip when Pro goes live; if it does, the
  line moved too far into free territory.

---

## 10. Decisions

**Settled (founder, 2026-07-18):**
- **Price:** keep current $4.99/mo · $34.99/yr. *(Revisit when Coach ships.)*
- **Free/Pro line:** capped free tier — 1 Tempo plan + 1 custom plan, 5 custom exercises, 5 saved
  custom workouts; core training loop (logging, adaptive plan, library) uncapped.

**Still open (the founder's call):**
1. **Lifetime — offer it or not?** Recommendation: yes at ~$79.99–$99.99 (Hevy/Strong band), priced so
   it never undercuts ~2–3 years of annual. Defensible to skip.
2. **Trial length.** Recommendation: 7 days (category standard, highest-leverage). 14 if the deeper
   surfaces need longer to be felt.
3. **Launch scope.** Recommendation: launch on the caps + the three built gates (reschedule-week,
   muscle map, travel) — that's already a real Pro tier at this price — then fast-follow foresight +
   Coach. The caps make Pro feel worth it on day one even before Coach exists (which was the founder's
   original concern, now addressed).
4. **Exact cap numbers.** 5/5/1 is a sensible start; watch where committed users actually hit the wall
   and tune (e.g. if 5 custom workouts is too tight for normal use, or too loose to ever bind).

---

*This plan is the input to milestone **M2 (It Sells Itself)** and batch **B2.3 (pricing/trial config)**.
It changes no code and flips no flags. When the founder is ready, §7's checklist turns it on.*
