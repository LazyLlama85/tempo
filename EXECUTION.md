# Tempo — Execution Operating System

> **This is the HOW.** It turns `PRODUCT_AUDIT.html` (the *why/what*) into shipped product,
> one session-sized batch at a time, in the right order, with nothing falling through the cracks.
>
> **The three files (single source of truth — never duplicate content between them):**
> | File | Job | Changes |
> |---|---|---|
> | `PRODUCT_AUDIT.html` | Diagnosis + vision + scores (the *why/what*) | rarely; via the Audit Artifact Protocol |
> | `EXECUTION.md` (this) | The plan, batches, workflow, prompts (the *how*) | rarely; only when strategy changes |
> | `EXECUTION_STATUS.md` | Live status + handoff note (the *where we are*) | **every session** |
> | `CLAUDE.md` | Enforcer — points here, mandates the loop | rarely |
>
> **The one rule:** *one batch per session — read the files it names, build additively, verify,
> update status, commit. Never hold the whole audit in your head; hold one batch.*

---

## 0. North star (be honest about "10/10")

10/10 = **category leadership of a category Tempo defines**: *"the calendar-native training
planner for busy people who still want to train seriously."* The audit's honest ceiling on
current shape is **8.5**. The last 1.5 points are **not built** — they're *earned* by real users
retaining and a growth loop compounding. So this OS optimizes for the sequence that gets there:

> **Reliable → the wedge is undeniable → it sells itself → week one doesn't bleed → it holds a
> cohort → it's credible → it grows.** Do them out of order and you're polishing a leak.

---

## 1. The 20% that drives 80% (the vital few — do these no matter what)

**Redirected 2026-07-17** (Phase 9 re-review): the original seven are now mostly *built*. Google
Calendar went to production the same day this redirect was written — the single most-cited
reliability risk in this whole document is structurally fixed. The bottleneck has moved from
"what to build" to **"verify what's built, then measure it"** — building more before that happens
would be exactly the "ambition outrunning validation" trap §6 warns about, now pointed at Claude's
own output instead of a hypothetical future feature.

1. **Verify the built backlog on-device** — Focus Mode, the 6-screen onboarding rebuild, the Plan
   tour, the Feed button, and the Home/Progress fixes (streak, rest-day advice, body intelligence,
   photo gallery, readiness chip, goal ETA) are ALL 🔍 code-verified/not-device-tested. Nothing in
   this list scores until it's tested. *(founder)*
2. **Retention instrumentation + a defined activation event** — still the single most important
   unblocking dependency; every M4 decision needs this data. *(B0.1 ✅ / B0.3, founder)*
3. **Confirm Google Calendar survives >7 days on a real device** — production approval (2026-07-17)
   removes the root cause (Testing-mode token expiry); M0's own criterion ② still needs a real,
   time-based confirmation before the milestone can close. *(founder)*
4. **Multi-calendar (B1.5)** — the sequencing gate that blocked this ("let the in-flight
   `calendar.events` verification finish first") is now clear. The next real Claude-buildable batch,
   not a new surface — extends the existing calendar integration.
5. **Pricing + trial config (B2.3)** and **App Store listing + one acquisition channel (B6.1/B6.2)**
   — founder-only, unblocked, real ROI, not done yet.
6. **Hold the M4 freeze** — no B4.x (accountability loop, referral), no Tempo Coach, no new feature
   surface, until B0.3's data says retention holds. This discipline is more important now than
   before, precisely because so much has shipped that it would be easy to keep shipping instead of
   measuring.

*(The original seven — Calendar reliability, retention instrumentation, the day-timeline hero,
reschedule-my-week, the Pro re-fence, plain-language copy + progressive disclosure — are now ✅ or
🔍-pending-device-test. See `EXECUTION_STATUS.md` for the current state of each. Acquisition channel
(#7 originally) is unchanged: still not started, still founder-only.)

---

## 2. Ruthless prioritization — cut, postpone, merge, reconsider

**❌ Reject / don't build (they don't move the metrics that matter):**
- More Progress charts/analytics depth — already over-built; nobody subscribes for charts.
- Any *new* social/community/groups surface — built already; the network doesn't exist yet.
- Muscle-map / readiness *polish* — a Fitbod echo, not the wedge.
- Premium themes / app icons as a *headline* Pro feature — bonus flair, not a reason to pay.
- Out-logging Strong/Hevy — you won't win that race and it isn't the wedge.
- Nutrition tracking (link to MFP, don't build), AI photo form-analysis, voice logging,
  program marketplace, B2B/coach mode, localization, cardio/running plans — all post-PMF or never.

**⏸ Postpone until the core loop's retention is proven (M4 passes):**
- Apple Watch, home-screen widget, Live Activity rest timer, volume landmarks (MEV/MRV),
  progress-photo timeline, "Year in Training" Wrapped, strength-standard benchmarks.

**🔗 Merge (one workstream, not many tickets):**
- "Sessions saved" counter **+** wedge quantifier → one `schedulingImpact` system *(already started)*.
- All "plain-language copy" fixes → one sweep across onboarding + levels + paywall.
- "Honest readiness label" **+** "HealthKit import" **+** "readiness → scheduling" → one Readiness workstream.
- "Calendar timeline on Home" **+** "15-min swap on Home" → one Home-hero redesign.

**♻ Reconsider (keep, but change the plan):**
- The already-built social features: **do not delete** (No-Regressions) — **hide** them from new
  users via progressive disclosure until they've earned the context. *(B3.2)*
- **Tempo Coach** (the tentpole): real, but only *after* the wedge + retention are proven. It's M-Future, not now.

---

## 3. Milestones — with hard completion criteria

A milestone is **done** only when every criterion is objectively true. No "mostly."

### M0 — Measurable & Reliable *(foundation; unblocks everything)*
**Done when:** ① the retention funnel (onboarding → activation → D7) is visible in PostHog with a
written activation definition *(🔲 still open — the single biggest remaining M0 gap)*; ② a connected
Google Calendar stays connected **> 7 days** on a real device *(🔍 the root cause — Testing-mode
token expiry — is fixed now that Google Calendar is approved for production, 2026-07-17; still needs
a real >7-day device confirmation before this criterion is objectively true)*; ③ the current redesign
has been smoke-tested on a physical device with **no blank-render** *(🔍 partial — Home hierarchy,
Session Complete, Settings split, and editable sets are founder-confirmed; Focus Mode, the onboarding
rebuild, the Plan tour, and the Feed button are not yet)*; ④ a written "feature freeze" is in effect
*(✅ in effect, and re-affirmed harder in §1's 2026-07-17 redirect)*.

### M1 — The Wedge, Undeniable
**Done when:** ① a brand-new user sees their workout **slotted into a real calendar gap on Home**
within 30 seconds; ② "Reschedule my whole week" moves every upcoming session in one action;
③ the "Tempo scheduled N of your workouts" proof appears on Home/Progress, not just side screens.

### M2 — It Sells Itself
**Done when:** ① analytics/charts are **free**; ② scheduling superpowers (auto-reshuffle,
reschedule-week, multi-calendar) are the **Pro** gate; ③ the paywall fires at the *payable moment*
(reschedule-week / 2nd calendar), not after a random first workout; ④ pricing raised + trial live.

### M3 — Week One Doesn't Bleed
**Done when:** ① no gym jargon anywhere in first-run; ② new users don't see social/groups/muscle-map
until activated; ③ the plan reveal *animates workouts dropping into the calendar* (the aha).

### M4 — It Holds a Cohort *(the real test)*
**Done when:** ① D1/D7/D30 are measured for ≥ 2 cohorts; ② a single-player accountability loop ships;
③ a referral loop is live; ④ **D7 is trending up** across cohorts (this is the gate to spend on growth).

### M5 — Credible & Hardened
**Done when:** ① readiness is honestly labeled and (with HealthKit) has a real input; ② integration
tests cover the plan/split/calendar state machines; ③ readiness feeds scheduling.

### M6 — Growth & Table Stakes
**Done when:** ① the App Store listing leads with the wedge; ② one acquisition channel is running
weekly; ③ table-stakes polish (Watch/widget/etc.) shipped *only as data justifies*.

---

## 4. Batch backlog (build order — dependency-aware)

Each batch is **one session**: small enough to build + verify + commit without exhausting context.
Sizes: **S** ≈ ½ session, **M** ≈ 1 session, **L** = split into sub-batches (a/b). Live status,
files, and done-when for each live in `EXECUTION_STATUS.md` — **that** is the checklist; this is the map.

**M0** — B0.1 Retention instrumentation *(✅ done)* · B0.2 Google OAuth → Production *(S, mostly console)* ·
B0.3 PostHog funnel + activation definition *(S, founder)* · B0.4 Feature-freeze policy *(✅ declared)* ·
B0.5 Device-matrix QA of redesign + fix any blank-render *(M)*.

**M1** — B1.1 Wedge quantifier *(⚠ partial: on Weekly Report + paywall; extend to Home/Progress)* ·
**B1.2 Calendar day-timeline Home hero** *(L → B1.2a data/selector, B1.2b UI)* ·
**B1.3 Reschedule-my-whole-week** *(M/L → B1.3a engine over existing reschedule.ts, B1.3b UI + guards)* ·
B1.4 "15-min swap" surfaced on Home *(S)*.

**M2** — B2.1 Re-fence Pro (free analytics, gate scheduling) *(M — needs B1.3)* ·
B2.2 Paywall triggers at payable moment *(S — needs B2.1)* · B2.3 Pricing + trial *(S, founder+copy)*.

**M3** — B3.1 Plain-language copy sweep *(⚠ partial: goals done; levels + paywall left, S)* ·
B3.2 Progressive disclosure of social/groups/map *(M)* · B3.3 Onboarding aha animation + time-budget Q *(M)*.

**M4** — B4.1 Single-player accountability loop *(M)* · B4.2 Referral program *(L — needs Supabase)* ·
B4.3 Cohort retention analysis + iterate *(ongoing, founder+data)*.

**M5** — B5.1 Honest readiness label *(S)* · B5.2 HealthKit import *(L, native → rebuild)* ·
B5.3 Readiness → scheduling feedback *(M)* · B5.4 Volume landmarks under the hood *(M)* ·
B5.5 Integration/E2E tests on state machines *(M)*.

**M6** — B6.1 Wedge-led ASO listing *(S, founder+copy)* · B6.2 One acquisition channel *(ongoing, founder)* ·
B6.3 "Year in Training" Wrapped *(M)* · B6.4 Table-stakes polish, data-gated *(each S–M)*.

---

## 5. Dependency map (don't violate these edges)

- **B0.2 (OAuth) precedes B1.2 (timeline)** — a timeline over a calendar that silently breaks is worse than none. *(B0.2 now ✅ — production approved 2026-07-17.)*
- **B1.5's own sequencing gate is now clear** (2026-07-17): step 1, "let the in-flight `calendar.events`
  verification finish first," is done — production approval covers it. Step 2 (Claude builds the
  picker/`CalendarList` integration) can start now; step 3 (founder adds the `calendar.calendarlist.readonly`
  scope + records a new demo video) still gates it actually working end-to-end.
- **B0.1/B0.3 (measurement) precedes M4** — you cannot improve retention you can't see.
- **B1.3 (reschedule-week) precedes B2.1/B2.2** — you can't gate/trigger a feature that doesn't exist.
- **B2.1 (re-fence) precedes B2.2 (trigger)** — fence first, then fire the paywall at the right door.
- **B5.2 (HealthKit) softly precedes B5.3** — readiness→scheduling is far more credible with a real signal.
- **M4 D7-up gate precedes B6.2 growth spend** — never pour users into a leaky bucket.
- **Native batches (B5.2, B6.4 Watch) need an `eas build`**, not an OTA update — batch them to minimize rebuilds.

---

## 6. Risk analysis — where solo founders burn time on the wrong things

| Trap | Why it feels productive | The rule |
|---|---|---|
| Polishing Progress/analytics | Visible, fun, "data-rich" | It's already over-built; **freeze it**. Charts don't retain or convert. |
| Building more social/community | "Engagement features!" | Dead weight with no network. **Hide, don't extend.** |
| Perfecting the muscle map / readiness UI | Looks impressive in a demo | Fitbod echo, not the wedge. Ship *honest*, then stop. |
| Chasing logging parity with Strong | "Table stakes" | You won't win it and it's not why anyone switches. Good-enough + one-tap ✓. |
| Native toys early (Watch, Live Activity, widget) | Shiny, premium-feeling | **Postpone past M4.** They don't prove the loop retains. |
| Re-architecting / abstracting further | "Clean code" | Already a Series-A surface on pre-seed evidence. **Stop adding systems.** |
| $100M-scale features (B2B, marketplace) | Big-vision energy | Earn $1M first. These are M-Future or never. |
| Endless design passes without shipping to users | "Craft" | The bottleneck is *validation*, not pixels. Ship to a cohort. |
| Doing work with no metric attached | "Progress" | Every batch must name the metric it moves in its ledger row. If it names none, **cut it.** |

---

## 7. Batch sizing & the per-session loop (the "golden loop")

**Size a batch so one session can:** read only the 1–5 files it touches → plan → build additively →
verify (`tsc` + tests + `/verify`) → update status → commit. If a batch needs > ~5 files or > ~1
system, **split it** (append `a`/`b`). L batches are pre-split in §4.

**The golden loop (every session):**
1. **Orient** — read `EXECUTION_STATUS.md` (Current Focus + ledger). Pick the batch it points to.
2. **Confirm** — restate the batch, its files, and its completion criteria. For anything non-trivial,
   run the CLAUDE.md Working Method (Phase 1–5) *proportionally*. Don't build yet.
3. **Build** — additive only (No-Regressions). Touch only the batch's files.
4. **Verify** — `npx tsc --noEmit`, run tests, drive the flow (`/verify`). Fix or flag.
5. **Status** — set the row 🔍 Needs Review (device-testable) or ✅ (logic-only), update Current Focus + handoff note.
6. **Audit** — update `PRODUCT_AUDIT.html` per the Audit Artifact Protocol (Update Log + honest re-score).
7. **Commit** — scoped commit + push (never sweep unrelated files).
8. **Handoff** — write the next-session handoff note in the ledger. Stop clean.

---

## 8. The prompt library (copy-paste these into Claude)

> Paste verbatim. Each is self-orienting — it tells the session to read the files, so it works even
> in a fresh session that remembers nothing.

**① Start a session**
```
Read EXECUTION_STATUS.md (Current Focus + ledger) and EXECUTION.md §4–5. Tell me the single next
batch to work on, why it's next (dependencies), the files it touches, and its completion criteria.
Do NOT build yet — confirm the plan, and for anything non-trivial run the CLAUDE.md Working Method
(Phase 1–5) proportionally first.
```

**② Build a batch**
```
Implement batch <ID> exactly as scoped in EXECUTION_STATUS.md. Follow CLAUDE.md: No-Regressions,
additive only, read only the files this batch names. Do not touch anything I'm not asking for.
When done: run npx tsc --noEmit + the tests + drive the flow (/verify), then STOP and show me a
diff summary and an on-device test checklist BEFORE committing.
```

**③ Review / QA a batch**
```
QA batch <ID> against its completion criteria in EXECUTION_STATUS.md. Check the CLAUDE.md edge
cases (force-close, offline, failed request, skipped step, return-days-later, upgrade, two-at-once,
stale cache, denied permissions, settings-changed-mid-flow). List anything that regressed anywhere
that imports or shares state with the files you touched. If clean, mark the row 🔍 Needs Review with
the exact steps for me to test on-device.
```

**④ Mark complete (after I test on device)**
```
I tested batch <ID> on my iPhone: <PASS / FAIL + notes>. If PASS: mark the row ✅ in
EXECUTION_STATUS.md, update PRODUCT_AUDIT.html per the Audit Artifact Protocol (Update Log entry +
honest re-score, no vanity inflation), append a Session Log entry, set Current Focus to the next
batch with a handoff note, then commit + push (scoped). If FAIL: log the failure, keep it 🔄, and
propose the fix.
```

**⑤ End a session cleanly (running low on context/time)**
```
We're stopping. Update EXECUTION_STATUS.md: set Current Focus + a handoff note precise enough that a
fresh session with zero memory can resume this exact batch (what's done, what's next, gotchas, the
files in flight). Commit the status + any WIP notes. Do not leave the batch row in a lying state.
```

**⑥ Close a milestone**
```
I think M<n> is complete. Verify every batch in it is ✅ and each milestone completion criterion in
EXECUTION.md §3 is objectively met (quote the evidence). Re-score the affected PRODUCT_AUDIT.html
rows honestly. Declare M<n> closed in the Session Log and set Current Focus to the first batch of
M<n+1>. If any criterion isn't truly met, tell me what's missing instead of closing it.
```

**⑦ Re-prioritize on new data (do this weekly)**
```
Here's new data: <retention numbers / user feedback / App Store reviews>. Re-rank only the
Not-Started ledger items against the metrics in EXECUTION.md §1. Move anything that no longer moves
a key metric to ❌ Rejected or ⏸ Postponed with a one-line reason. Do NOT add scope. Show me the
before/after order and what changed.
```

**⑧ Guardrail check (when tempted to build something not in the plan)**
```
I want to build <X>. Before I do: is <X> in EXECUTION_STATUS.md? Which milestone metric does it
move, and is that milestone current? If it's in the §2 Reject/Postpone list or moves no current
metric, talk me out of it and point me at the actual next batch.
```

---

## 9. Anti-over-engineering guardrails (pin these)

- **One batch per session.** Finished + committed beats three things half-done.
- **Every batch names its metric.** No metric → not a batch → cut it.
- **Additive by default.** Hide before delete; extend before create (CLAUDE.md).
- **Freeze new surfaces until M4.** The app already has more features than validation. Depth, not breadth.
- **Ship to real users between milestones.** The bottleneck is proof, not code.
- **If it's on the §2 Reject/Postpone list, the answer is no** — even if it's a fun afternoon.
- **Native rebuilds are expensive** — batch B5.2/Watch/etc. together; prefer OTA-shippable work first.
