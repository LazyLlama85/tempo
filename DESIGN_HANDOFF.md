# Tempo — Complete UI Inventory & Design Handoff

> Purpose: a screen-by-screen, element-by-element description of the **entire** Tempo mobile app
> (Expo / React Native), written so a designer can redesign the UI and give it a more original,
> ownable visual identity. It documents *what exists today* — every screen, every button, every
> state — plus the current design system. Nothing here is a constraint on the redesign; it's the
> starting map.

Tempo is **precision fitness scheduling**: it builds a training plan around your real calendar
(work, school, sleep, off-days) and adapts week to week. The emotional job of the UI is to feel
**intelligent, calm, and coach-like** — never a generic workout-logger.

---

## 1. Current design system (today's look)

**Vibe:** dark, sports-performance (Whoop / Strava energy). Near-black backgrounds, near-white
text, a single electric-blue accent. Very little color beyond blue + green(success) + red(error).
Everything is flat cards with hairline borders and soft shadows. It is clean but **generic** —
this is the main thing to make more original.

**Color tokens** (`src/constants/theme.ts`, single dark theme used everywhere via `Colors.light`):
| Token | Hex | Use |
|---|---|---|
| `surface` | `#0C0D10` | screen background (darkest) |
| `background` | `#15181E` | cards / elevated surfaces |
| `surfaceContainerLow` | `#191C22` | chips, inputs, secondary cards |
| `surfaceContainerHigh` | `#2A2F39` | progress tracks, skeletons |
| `text` | `#F2F3F6` | primary text |
| `textSecondary` | `#A6ACBA` | secondary text |
| `outline` | `#767E8C` | tertiary text / muted icons |
| `outlineVariant` | `#2B313B` | hairline borders / dividers |
| `primary` | `#3D82F7` | the one accent (electric blue) |
| `onPrimary` | `#FFFFFF` | text/icons on blue |
| `primarySoft` | `rgba(61,130,247,0.16)` | blue tint fills |
| `success` / `successSoft` | `#34D399` | done / positive |
| `error` | `#FF6B6B` | destructive / negative |
| Gold (PRs/achievements) | `#B8860B`, tiers `#B45309`/`#64748B`/`#B8860B` | trophies |

**Type:** Inter only — `Inter_400Regular`, `_500Medium`, `_700Bold`, `_800ExtraBold`.
Headlines are ExtraBold with tight negative letter-spacing (`-0.3` to `-1`). Eyebrows/labels are
11px Bold, `letterSpacing 0.6`, UPPERCASE. The "TEMPO" wordmark appears two ways: ExtraBold 26px
(Schedule) and ExtraBold 15–16px with `letterSpacing 2` (everywhere else).

**Spacing:** 4px-ish grid — `xs 8, sm 12, md 16, lg 24, xl 32`, container padding `20`.
**Radius:** `sm 4, md 12, lg 16, xl 24, full 9999`. **Shadow:** one soft `CardShadow`.

**Recurring components / patterns (reused on almost every screen):**
- **Screen header** — left back/close icon, centered "TEMPO" wordmark (or a screen title), right
  avatar or action icon.
- **Eyebrow + Title** — tiny uppercase label above an ExtraBold headline.
- **Card** — `background` fill, 1px `outlineVariant` border, `xl` radius, soft shadow.
- **Pill chip** — rounded-full, blue when active, outline when not. Used for filters, durations, days.
- **Segmented control** — `surfaceContainerLow` track, the selected segment lifts to `background`.
- **Primary button** — full-width, height 52–56, blue, white bold label. Disabled = grey fill.
- **Bottom-sheet modal** — dark sheet, top drag handle, slide-up, dimmed backdrop; used for all
  pickers/editors.
- **Progress bar** — 3px track, blue fill (onboarding steps + in-workout).
- **Icons** — Ionicons throughout (outline when inactive, filled when active).

---

## 2. Navigation map

```
sign-in  →  onboarding (goal→experience→equipment→schedule→availability→plan-preview→profile-setup)  →  (tabs)
(tabs): Schedule | Workouts | Progress | Profile
Modals (slide-up): quick-workout, smart-scheduler, availability, travel-mode, legal,
                   weekly-report, plan-explainer
Full-screen: workout-complete (fade, no gesture dismiss)
```
Tab bar: 4 tabs, blue active / grey inactive, Ionicons (calendar, barbell, trending-up, person),
labels "Schedule / Workouts / Progress / Profile".

---

## 3. Auth & onboarding

### Sign-in (`sign-in.tsx`)
- **Logo area:** the Tempo tile logo (88×88, rounded, blue glow shadow).
- **Hero:** "Tempo" wordmark + tagline "Precision fitness scheduling for your peak performance."
- **Actions (stacked buttons):**
  - **Sign in with Apple** (iOS only) — black Apple button with  icon.
  - **Sign in with Google** — light button, "G  SIGN IN WITH GOOGLE".
  - **Continue as guest** — text link (anonymous auth).
  - **Legal line:** "By continuing you agree to Tempo's Terms of Service and Privacy Policy."
- Each button shows an inline spinner while its provider authenticates.

### Onboarding (6 visible steps + a final "make it yours")
Shared chrome on every step: header (back, "TEMPO", spacer), a **3px progress bar** that fills
20→40→60→66→83→100%, an eyebrow "STEP n OF 6", an ExtraBold question title, a grey subtitle, and a
blue **Continue** CTA pinned at the bottom (disabled grey until valid).

1. **Goal** (`goal.tsx`) — 5 selectable rows, each = icon tile + label + description:
   Build Muscle, Lose Fat, Gain Strength, Athletic Performance, General Fitness. Selected row gets a
   blue border + blue icon tile.
2. **Experience** (`experience.tsx`) — a 3-way **segmented control** (Beginner / Intermediate /
   Advanced) + a preview card with a barbell glyph and an italic descriptive quote that changes per
   level.
3. **Equipment** (`equipment.tsx`) — multi-select rows (Full gym, Dumbbells only, Barbell & plates,
   Resistance bands, No equipment), each with a check circle that fills blue.
4. **Schedule** (`schedule.tsx`) — "Choose your calendar." **Days per week** selector (2/3/4/5 as
   round chips) + **Connect Google Calendar** / **Connect Device Calendar** buttons (real OAuth /
   OS permission; shows a green "connected" badge), a "WHY CONNECT?" checklist, and a faux
   **calendar preview** showing a meeting + a dashed-outline "IDEAL TRAINING WINDOW" workout block.
   Footer also has a "Maybe later" skip.
5. **Availability** (`availability.tsx`) — "When does life happen?" Sleep (wake/bedtime time rows),
   Work hours (toggle + start/end), School hours (toggle + start/end), Preferred time to train
   (Morning/Afternoon/Evening segmented), and **Days I never train** (Mon–Sun chips, e.g. Shabbat).
   Time rows open the custom **TimePickerSheet**. Has a top "Skip".
6. **Plan preview** (`plan-preview.tsx`) — "Your plan is ready." A program card (PROGRAM eyebrow +
   generated name like "Beginner Full Body (3x/week)") with a details list (Goal, Experience, Days,
   Duration ~45 min, Length 4 weeks then repeats), plus a blue "adapt note" reinforcing that the
   plan reshapes around real life. CTA **"Let's Go →"** builds the plan (shows "Building your plan…").
- **Profile setup** (`profile-setup.tsx`) — final "Make it yours." Live avatar preview, display-name
  input, a grid of colored avatar presets (icon on colored circle, blue check when selected). CTA
  **"Enter Tempo →"**. Has a "Skip".

---

## 4. Tab 1 — Schedule (`(tabs)/index.tsx`)
The home screen and the most complex. Dark, scrollable, pull-to-refresh.

- **Header:** "Tempo" wordmark + today's date; a **readiness ring** (tappable — opens the recovery
  check-in; shows a 0–100 number colored green/blue/red, or a pulse icon if not checked in); a
  **profile avatar** (tappable).
- **Day / Week / Month** segmented control.
- **Travel-mode banner** (if active) — airplane icon + "Travel mode · <equipment> · <until>", taps
  into Travel Mode.
- **Range row** — current range label ("Oct 21 – 27" / "October 2026" / weekday), a "Today" chip
  when off-range, and ‹ › arrows.
- **Calendar** — a 7-day **week strip** (S M T W T F S, day pills; today outlined, selected filled
  blue; a dot under days with workouts — green if all done) OR a **month grid** (6×7 cells).
- **Block-phase banner** — "Week n · <Base/Build/Peak/Deload>", note text, leaf/▲/barbell icon;
  taps into the Plan Explainer. Deload variant tinted green.
- **Goal countdown card** — projected ETA toward the goal (headline + sub + thin progress bar).
- **Weekly report row** (Sun/Mon only) — blue card "Your weekly progress report → ".
- **Quick Workout row** — the wedge feature: icon + dynamic headline/sub (a smart suggestion) + arrow.
- **Missed-workout banner** — "Missed <focus> +N more / No worries — let's find a new slot" +
  **Reschedule** button.
- **Rest-day banner** — bed icon + advice when recovery is overdue (green).
- **Unified feed** — a timeline grouped by day (Today/Tomorrow/weekday headers, a live dot on today).
  Each item is rendered on a **time rail** (left = time):
  - **Workout card** — badge ("TODAY'S WORKOUT" hero / "WORKOUT" / "DONE"), barbell tile, focus title,
    meta chips (time, duration), a blue **Start Session** button, and card actions **Add to Calendar /
    In Calendar** and **Edit**. The hero (today's next) gets a soft blue glow wash.
  - **Calendar event** (muted) — inferred icon (school/work/meal/etc.), title, time, and an
    **Ignore / Undo** action (lets Tempo schedule over it; shows struck-through when ignored).
  - **Rest day** — moon icon "Rest day — recovery is part of the plan."
  - **Rich empty state** — when the range is empty but a future workout exists: a "YOUR PLAN" card
    (goal, phase chip, streak chip, next workout + Start) so the screen is never dead.
- **FAB** — floating blue lightning button (bottom-right) → Quick Workout.
- **Sheets mounted here:** Recovery check-in, Edit-workout.

---

## 5. Tab 2 — Workouts / active session (`(tabs)/plan.tsx`)
The live workout-logging screen.

- **Header:** back arrow, "TEMPO" wordmark, avatar.
- **Session bar:** "ACTIVE SESSION" eyebrow + focus title (left); "EST. N MINS" + a live **MM:SS
  timer** (right).
- **Progress bar** — fills as sets are completed.
- **Banners** (contextual): travel-mode (adapted to your gear), deload week (green, "lighter on
  purpose"), or peak week ("extra set per lift").
- **Exercise cards (accordion)** — each row: **GIF thumbnail** (animated form clip), exercise name,
  primary muscles (uppercase), a `done/total` count, chevron. Expanded:
  - **Today's Target card** (blue) — "TODAY'S TARGET: 135 lbs · 8–10 reps × 3" + a direction badge
    (GO UP / HOLD / BACK OFF) + a one-line reason (autoregulated from last session).
  - **Form guide** + **Swap** pill buttons (Form opens the Exercise Form sheet; Swap offers
    equipment-aware substitutes via an alert list).
  - **Set table** — columns SET / PREV / LBS / REPS / ✓. Each row has numeric inputs and a check
    circle; tapping ✓ reveals an inline **RPE bar** (6–10 + skip), then the row locks as done and
    auto-starts a rest timer. "+ Add Set".
- **Complete Workout** — full-width blue button → workout-complete.
- **Floating tools** (bottom-right stack): **rest timer** button (preset 60/90/120s) and an
  **exercise list** button. An active **rest pill** (dark, "Rest · MM:SS", Skip) floats at the bottom.
- **Form sheet** mounted here (see §9).

---

## 6. Tab 3 — Progress (`(tabs)/progress.tsx`)
Performance dashboard. Header: "TEMPO", a **Share** icon (opens Wrapped share cards), a bell
(placeholder alert), avatar.

- Title block "YOUR PERFORMANCE / Progress Overview".
- **Consistency ring** — a custom-drawn circular ring showing completion %, center label "X% /
  TARGET MET|KEEP GOING", caption "X% completion in last 30 days".
- **Streak card** (solid blue) — flame + "CURRENT STREAK" + big number + "days" + caption.
- **Next milestone** card — the closest locked achievement with a progress bar + "N to go".
- **Completion rate** card — % + delta vs last month + bar.
- **Volume lifted** card — big lbs number + **W / M / 6M** period toggle + a mini bar chart (current
  bar highlighted blue).
- **Personal records** — rows of barbell icon + lift name + date + max weight.
- **Achievements** — a 3-wide badge grid; unlocked badges are tier-colored (bronze/silver/gold),
  locked ones are dimmed with a lock dot and progress text. "N of M".
- **Share sheet** mounted here.

---

## 7. Tab 4 — Profile (`(tabs)/profile.tsx`)
Gaming-flavored profile + all settings. Header: "TEMPO" + edit (pencil) icon.

- **Hero banner** (colored by avatar) — a "LVL n · TITLE" chip, large avatar, display name,
  goal·experience subline, a **level progress bar**, and "N more workouts to Level n+1".
- **Stat grid** (2×2 tiles, each taps to Progress): Workouts, Day streak, Lbs lifted, Badges (N/M).
- **Achievements** badge grid (same as Progress).
- **Body Stats** — weight trend card: current 7-day avg, weekly trend (lb/wk), total change, plus
  optional body-fat % and waist chips. "Log entry" opens the **measurement modal** (weight, body
  fat %, waist, **progress photo** attach). Empty state explains the trend feature.
- **Personal Records** — top 4, "View all".
- **Exercise Swaps** — saved substitution preferences (original → substitute rows); tap opens the
  **swap editor modal** (pick a different alternative or revert to original). Empty state explains
  how swaps are remembered.
- **My Plan** card — setting rows: Primary goal, Experience, Days per week, **Equipment** (opens
  equipment modal), **Injuries & limitations** (opens injury modal — knees/back/shoulders/etc.),
  **Travel mode** (opens Travel Mode), and a **Change Plan** link (re-runs onboarding).
- **Settings** card — **Availability & schedule** (→ Availability), **Calendar** (choose Google/
  Device, shows connection status), **Notifications** (a Switch — server push on/off for this
  device), **Privacy & Terms** (→ legal).
- **Sign Out** (red) and **Delete Account** (red, double-confirm, App-Store-required) + hint.
- **Modals mounted here:** Edit profile (name + avatar grid), Equipment, Injuries, Log measurement,
  Swap editor. All are dark bottom sheets with a drag handle, title, hint, options, and a blue Save.

---

## 8. Standalone feature screens

### Quick Workout (`quick-workout.tsx`) — modal
The flagship "build a session for the time you have" flow.
- Header: close (×), "Quick Workout".
- "How much time do you have?" + **duration chips grid** (e.g. 5/10/15/20/30/45 min squares).
- "FOCUS" — a horizontal scroll of **purpose chips** (Strength / Muscle / Conditioning / Athletic /
  Recovery / Mobility), default inferred from the user's goal.
- **Generated preview card** — purpose badge + "~N min", title, a blue **"Why this" box** (sparkles
  + reasoning — never a random list), the **exercise list** (index, name, muscles, sets×reps dose),
  and a "WHY IT COUNTS" long-term-contribution box. Loading + empty states.
- Sticky footer: **"Start N-Minute Workout"** (blue, play icon).

### Workout Complete (`workout-complete.tsx`) — full-screen
- Big blue **checkmark badge**, "Nice work.", and a motivational **lead line** (chooses the most
  motivating true stat — streak, volume vs last week, etc.).
- **PR card** (gold) if any personal records were hit this session.
- **Streak card** (blue), two **stat tiles** (Consistency, This Week n/target), **Weekly target**
  progress bar.
- **"How did that feel?"** — Too easy / Just right / Too hard (feeds adaptation); shows a confirming
  sentence after choosing.
- Quick-workout note (if applicable). Footer: **Share a card** + **Done**.

### Weekly Report (`weekly-report.tsx`) — modal
"Your Week" recap: workouts + consistency tiles, **Volume lifted** card (with up/down delta pill),
**Estimated strength** ("Up in N lifts" + per-lift +est. 1RM gains), Weight trend + New PRs tiles,
and **"Share my week"**. Empty state when no sessions yet.

### Smart Scheduler (`smart-scheduler.tsx`) — modal
Google-Calendar-driven weekly auto-scheduler.
- Disconnected state: connect icon + "Connect Google Calendar" + explanation + connect button.
- Connected: a **plan summary** (duration / ×per week / goal chips) + **preferred-time** segmented;
  a **"YOUR WEEK"** list (7 days; each shows a workout pill in tomato-red or "Open"/"N events");
  primary **"Smart Schedule My Week"** (sparkles); on success a green summary card listing the
  built sessions; "Disconnect Google Calendar" secondary link.

### Travel Mode (`travel-mode.tsx`) — modal
Airplane hero + explanation. "WHAT DO YOU HAVE RIGHT NOW?" equipment multi-select; "HOW LONG?"
duration chips (Just today / This weekend / 1 week / 2 weeks / Until I turn it off); optional label
input. Active badge when on. Footer: **"I'm back home"** (clear) + **Turn on / Update travel mode**.

### Availability (`availability.tsx`) — modal (settings version)
Full version of the onboarding availability step + extras: Sleep, Work, School, Preferred time,
**Days I can train** chips, **Times I'm completely unavailable** (add-block form: days, all-day
toggle or from/until times, label), **Schedule flexibility** (Strict / Balanced / Flexible radio
cards), and **Sync workouts to** (Google / Device segmented). Blue **Save**. Uses TimePickerSheet.

### Plan Explainer (`plan-explainer.tsx`) — modal
"Why this week." A phase card (Base/Build/Peak/Deload/Maintain with plain-language explanation), a
**"THIS WEEK'S DIALS"** card (Volume / Intensity / Recovery rows), an adaptation-mode note, and the
next-deload timing. Deload styled green.

### Legal (`legal.tsx`) — modal
In-app Privacy Policy + Terms of Use (plain-language sections). Support email `fittempo.app@gmail.com`.

---

## 9. Shared sheet components
- **TimePickerSheet** — custom dependency-free 12-hour time list in 15-min steps (rows with a blue
  check on the selected); optional "Clear". Used by all time fields.
- **RecoveryCheckIn** — daily check-in sheet: 4 metrics (Sleep, Energy, Soreness, Stress) each a
  1–5 scale of buttons with low/high hints, a live **READINESS /100** preview, blue **Save check-in**.
- **EditWorkoutSheet** — move a workout: horizontal **next-14-days** chips + a time button
  (TimePickerSheet) + **Save changes** + **Remove from schedule** (red). Keeps the calendar in sync.
- **ExerciseFormSheet** — form guide: uppercase "<pattern> · FORM GUIDE" eyebrow, exercise name,
  a **GIF hero** (animated demo, loading skeleton, fallback, optional "Watch video" pill), **Muscles
  worked** chips (primary blue / secondary grey), numbered **How to do it** steps, **Equipment**
  chips, blue **Done**.
- **ShareCardSheet + WrappedCard** — "Share your card": card-type chips (Weekly / Streak / PR / Goal
  / Month / Top Lifts / Weight), a rendered **WrappedCard** preview, an auto-caption box with
  **Copy caption**, and **Share image** (snapshots the card to PNG → OS share sheet).

---

## 10. Notes for the redesign
What's strong and should survive: the **calendar-native schedule feed**, the **"why this" coaching
voice** (target reasons, plan explainer, quick-workout rationale), the **readiness ring**, and the
**Wrapped share cards**. These are the differentiators.

What reads as generic today and is the biggest opportunity to make it *ownable*:
- **One-accent dark theme.** It's competent but indistinguishable from a dozen fitness apps. A
  distinct palette, a secondary accent, texture/gradient, or a signature motif (the runner-in-clock
  logo) would give identity.
- **Repetitive card-on-dark layout** — nearly every screen is the same stacked rounded cards.
  Hierarchy, rhythm, and a few hero moments would help.
- **Wordmark inconsistency** — "Tempo" appears at several sizes/letter-spacings; a single defined
  logo lockup would tighten it.
- **Typography is Inter-only** — a characterful display face for headlines/numbers (this app is very
  number-heavy: timers, weights, streaks, %) could carry a lot of personality.
- **Iconography is stock Ionicons** — a custom icon set or at least a consistent weight/treatment
  would de-genericize it.
- **Empty/loading states** are functional but plain — prime spots for brand personality.
```
