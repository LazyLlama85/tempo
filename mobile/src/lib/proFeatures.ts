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

export type IoniconName = ComponentProps<typeof Ionicons>['name']

// Depth & horizon model (audit §10): the free app is fully functional; Pro sells
// depth, foresight, breadth, and personalization on top of the same engine. The
// engine itself (plan generation, adaptation, quick workouts, logging) is NEVER here.
export type ProFeatureId =
  | 'advanced_analytics'
  | 'schedule_optimization'
  | 'long_horizon_planning'
  | 'premium_personalization'
  | 'smart_notifications'
  | 'tempo_coach'
  | 'muscle_intelligence'
  | 'travel_mode'
  | 'multi_calendar'

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
    // B2.1: this is specifically the one-tap "reschedule my whole week" action
    // (lib/reschedule.rescheduleWholeWeek) — NOT the free, always-on background
    // auto-scheduler (lib/autoSchedule.ts) that quietly time-optimizes every user's
    // plan around their calendar. That stays free; only the on-demand full re-plan
    // is gated. Keep this distinction explicit here so a future call site doesn't
    // accidentally gate the ambient engine by using this same feature id.
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
    title: 'Tempo Coach',
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
  // B1.5: dormant until the calendar.calendarlist.readonly OAuth scope is granted
  // (services/googleCalendar/config.ts) — registered here so the picker screen has
  // a ProGate id ready, but deliberately left OUT of PAYWALL_POINTS below until it
  // actually works (App Store review rejects paywalls advertising non-functional
  // features).
  multi_calendar: {
    id: 'multi_calendar',
    title: 'Multi-Calendar',
    benefit: 'Read busy time from every calendar you use, not just your primary one, so Tempo never double-books you.',
    icon: 'calendar',
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

// B2.1: analytics/charts moved to free (nobody subscribes for charts) — the
// paywall now sells the two things that are actually gated: the one-tap
// reschedule-week action and Muscle Intelligence. Every point here still maps
// to something a Pro user can use today; add to this list only as new gates
// actually ship.
export const PAYWALL_POINTS: PaywallPoint[] = [
  { icon: 'repeat', title: 'Reschedule My Week', benefit: 'One tap re-plans your whole upcoming week around a busy stretch — recovery-aware and calendar-aware.' },
  { icon: 'body', title: 'Muscle Intelligence', benefit: 'An interactive body map of your balance, recovery, and weak points.' },
  { icon: 'airplane', title: 'Travel Mode', benefit: 'Rewrite your upcoming workouts to match whatever gear you have with you on the road.' },
]
