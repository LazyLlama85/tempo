// Tempo — the Pro feature registry (single source of truth for gating copy).
//
// Every gated surface references a ProFeatureId here instead of hand-writing
// upsell strings at the call site, so the paywall, lock cards, and Pro badges all
// speak with one voice and a feature's benefit copy is changed in exactly one place.
//
// This is metadata only — it does NOT decide access. Access is `useProAccess().locked`
// (proEnabled && !isPro). While Pro is dormant, none of this is ever shown.

import type { ComponentProps } from 'react'
import type { Ionicons } from '@expo/vector-icons'
import { BRAND_NAME } from '@/constants/brand'

export type IoniconName = ComponentProps<typeof Ionicons>['name']

// Depth & horizon model (audit §10): the free app is fully functional; Pro sells
// depth, foresight, breadth, and personalization on top of the same engine. The
// engine itself (plan generation, adaptation, quick workouts, logging) is NEVER here.
export type ProFeatureId =
  | 'advanced_analytics'
  | 'schedule_optimization'
  | 'long_horizon_planning'
  | 'pr_forecasting'
  | 'full_history'
  | 'premium_personalization'
  | 'smart_notifications'
  | 'tempo_coach'
  | 'muscle_intelligence'
  | 'travel_mode'
  | 'multi_calendar'
  | 'plate_calculator'
  | 'rolling_schedule'
  | 'auto_reschedule'

export interface ProFeatureMeta {
  id: ProFeatureId
  /** Short label for the lock card header / paywall row. */
  title: string
  /** One-line benefit — what the user actually gets. */
  benefit: string
  icon: IoniconName
}

export const PRO_FEATURES: Record<ProFeatureId, ProFeatureMeta> = {
  advanced_analytics: {
    id: 'advanced_analytics',
    title: 'Advanced Analytics',
    benefit: 'Volume trends over time and a deep dive into every lift’s strength progress.',
    icon: 'analytics',
  },
  schedule_optimization: {
    id: 'schedule_optimization',
    // This is specifically the one-tap "reschedule my whole week" action
    // (lib/reschedule.rescheduleWholeWeek) — a distinct gate from
    // rolling_schedule below, which covers the AMBIENT background
    // auto-scheduler. (Superseded note, kept for history: this used to say the
    // ambient scheduler "stays free" with no horizon limit at all — audit §24
    // revised that; see rolling_schedule.)
    title: 'Smart Scheduling',
    benefit: 'One-tap "reschedule my whole week" — re-lay every session around a busy stretch, recovery-aware.',
    icon: 'sparkles',
  },
  long_horizon_planning: {
    id: 'long_horizon_planning',
    title: 'Long-Term Planning',
    benefit: 'Goal-date programs, structured training blocks, and your plan months ahead.',
    icon: 'map',
  },
  // LAUNCH_SCORE_PLAN.md T2.1 (2026-07-23) — the OTHER half of MONETIZATION_PLAN.md
  // Pillar 2 (long_horizon_planning is the program-structure half; this is the
  // per-lift half). Deliberately its own id rather than reusing
  // long_horizon_planning's copy, which describes a different, larger,
  // not-yet-built feature (goal-date programs) — hand-writing borrowed upsell
  // copy for a shipped feature is exactly what this registry exists to prevent.
  pr_forecasting: {
    id: 'pr_forecasting',
    title: 'PR Forecast',
    benefit: 'A real projection from your own numbers — "at this rate, you’ll hit a 2-plate bench by October."',
    icon: 'trending-up',
  },
  // 2026-08-02, founder-requested: the read-BACKWARD counterpart to
  // pr_forecasting's read-FORWARD gate. Free sees the last 4 months of
  // training history (lib/historyHorizon.ts); Pro sees everything. Data is
  // never deleted for a free user — this is a display clamp only, so buying
  // Pro immediately reveals every session that was always there.
  full_history: {
    id: 'full_history',
    title: 'Full History',
    benefit: 'See every workout, lift, and muscle trend you’ve ever logged — no 4-month cutoff.',
    icon: 'time',
  },
  // ⛔ NOT BUILT (verified 2026-07-22): there is no theme picker and no alternate app
  // icon anywhere in the app — this id has no call site. Registered for later. It must
  // NOT appear in PAYWALL_POINTS or the paywall's compare table until it exists.
  premium_personalization: {
    id: 'premium_personalization',
    title: 'Premium Look',
    benefit: 'Exclusive themes, custom app icons, and extra profile flair.',
    icon: 'color-palette',
  },
  smart_notifications: {
    id: 'smart_notifications',
    title: 'Coaching Insights',
    benefit: 'Personalized recovery nudges and schedule-change alerts.',
    icon: 'notifications',
  },
  tempo_coach: {
    id: 'tempo_coach',
    title: `${BRAND_NAME} Coach`,
    benefit: 'A coach that reprograms on command and explains every decision.',
    icon: 'chatbubbles',
  },
  muscle_intelligence: {
    id: 'muscle_intelligence',
    title: 'Muscle Intelligence',
    benefit: 'An interactive body map — training balance, recovery, and weak points, muscle by muscle.',
    icon: 'body',
  },
  travel_mode: {
    id: 'travel_mode',
    title: 'Travel Mode',
    benefit: 'Away from your usual setup? Rewrite your upcoming workouts to match whatever gear you have with you.',
    icon: 'airplane',
  },
  // B1.5. ✅ LIVE since 2026-07-18 — the calendar.calendarlist.readonly scope was
  // granted (services/googleCalendar/config.ts), so fetchCalendarList() and the
  // picker screen work and this IS legitimately advertised in PAYWALL_POINTS.
  // (This comment previously said the opposite; corrected 2026-07-22 after
  // re-verifying the scope config, because a stale "don't advertise this" note is
  // exactly what gets a working feature pulled from the paywall by mistake.)
  multi_calendar: {
    id: 'multi_calendar',
    title: 'Multi-Calendar',
    benefit: `Read busy time from every calendar you use, not just your primary one, so ${BRAND_NAME} never double-books you.`,
    icon: 'calendar',
  },
  plate_calculator: {
    id: 'plate_calculator',
    title: 'Plate Calculator',
    benefit: 'See exactly which plates to load per side for any target weight and bar.',
    icon: 'barbell',
  },
  // The two headline gates (audit §24/§30): free auto-scheduling only fits the
  // CURRENT week; Pro keeps every future week auto-fitted too. Generation
  // itself (lib/generatePlan.ts) is never touched by either — every week's
  // plan always exists and is fully usable; this only gates the AUTOMATIC
  // time-placement pass (lib/autoSchedule.ts).
  rolling_schedule: {
    id: 'rolling_schedule',
    title: 'Rolling Auto-Schedule',
    benefit: `${BRAND_NAME} keeps fitting every future week around your calendar — not just this one.`,
    icon: 'infinite',
  },
  // Free still DETECTS a conflict (a Home card: "your session now clashes with
  // X") and lets the user move it manually — Pro is the silent auto-move on
  // top. See lib/autoSchedule.ts's resolveCalendarConflicts (Pro) vs
  // findCalendarConflicts (free, detect-only).
  auto_reschedule: {
    id: 'auto_reschedule',
    title: 'Auto-Reschedule',
    benefit: `When a meeting lands on a workout, ${BRAND_NAME} quietly moves it before you even notice.`,
    icon: 'shuffle',
  },
}

export function proFeature(id: ProFeatureId): ProFeatureMeta {
  return PRO_FEATURES[id]
}

// ── Paywall value props ─────────────────────────────────────────────────────────
// These describe what a subscriber gets RIGHT NOW (the delivered Advanced Analytics
// surface). App Store review rejects paywalls that advertise features that don't
// exist, so every bullet here maps to something a Pro user can actually use today.
// As more Pro surfaces ship (scheduling optimization, premium themes, Tempo Coach),
// add their points here — the paywall reads this list, so it stays in sync.
export interface PaywallPoint {
  icon: IoniconName
  title: string
  benefit: string
}

// Audit §24/§30: Pro used to be entirely accessories nobody hits weekly (a
// plate calculator, themes, creation caps most users never reach) — which is
// exactly why founder instinct said nobody would buy it. The first two points
// now lead because they're the ones a real user actually hits every week (a
// calendar changes every week) — everything else stays real, still shipped,
// but demoted to supporting cast. Every point here maps to something a Pro
// user can use today; add to this list only as new gates actually ship.
export const PAYWALL_POINTS: PaywallPoint[] = [
  { icon: 'infinite', title: 'Your Week, Every Week', benefit: `${BRAND_NAME} keeps auto-fitting your training around your calendar — not just this week, every week ahead.` },
  { icon: 'shuffle', title: 'Never Lose a Session to a Meeting', benefit: `A conflict lands on your calendar and ${BRAND_NAME} quietly moves your workout before you even notice.` },
  { icon: 'repeat', title: 'Reschedule My Week', benefit: 'One tap re-plans your whole upcoming week around a busy stretch — recovery-aware and calendar-aware.' },
  { icon: 'airplane', title: 'Travel Mode & Multi-Calendar', benefit: 'Rewrite workouts to match gear on the road, and read busy time from every calendar you use.' },
  { icon: 'body', title: 'Muscle Intelligence', benefit: 'An interactive body map of your balance, recovery, and weak points.' },
  // 2026-07-23: added the moment exercise-progress.tsx's forecast card shipped
  // (LAUNCH_SCORE_PLAN.md T2.1) — same rule as every bullet here, only advertise
  // what's actually live today.
  { icon: 'trending-up', title: 'PR Forecast', benefit: 'See exactly when you’ll hit your next lift milestone, projected from your own logged sets.' },
  // 2026-08-02: added the moment the 4-month free horizon shipped (lib/historyHorizon.ts)
  // across exercise-progress/muscle-history/workout-history — same rule, only what's live.
  { icon: 'time', title: 'Full History', benefit: 'No 4-month cutoff — every workout, lift, and muscle trend you’ve ever logged, always.' },
  // 2026-07-22: "and premium themes" REMOVED from this bullet. `premium_personalization`
  // is a registered id with ZERO implementation — no theme picker, no alternate app
  // icons, nothing. Advertising it on the purchase screen is the exact App Store
  // rejection reason this list exists to prevent, and the paywall carousel made it a
  // full-screen slide. Put it back only when a user can actually change a theme.
  { icon: 'sparkles', title: 'Unlimited Everything', benefit: 'Build unlimited custom plans, workouts, and exercises — plus the plate calculator for every lift.' },
]
