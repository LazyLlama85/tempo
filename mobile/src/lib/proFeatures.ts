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
    title: 'Smart Scheduling',
    benefit: 'Auto-reshuffle around a busy week and recovery-aware workout timing.',
    icon: 'sparkles',
  },
  long_horizon_planning: {
    id: 'long_horizon_planning',
    title: 'Long-Term Planning',
    benefit: 'Goal-date programs, periodization blocks, and your plan months ahead.',
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

export const PAYWALL_POINTS: PaywallPoint[] = [
  { icon: 'trending-up', title: 'Volume Trends', benefit: 'Track total volume week-over-week and month-over-month.' },
  { icon: 'barbell', title: 'Strength Progress', benefit: 'Watch every lift’s estimated 1RM climb over time.' },
  { icon: 'trophy', title: 'Records History', benefit: 'Search and revisit all your PRs — not just the latest few.' },
  { icon: 'stats-chart', title: 'Deep Charts', benefit: 'Rich, animated performance charts across your training.' },
]
