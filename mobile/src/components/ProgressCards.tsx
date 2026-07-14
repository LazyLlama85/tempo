// Tempo — Progress "Fitness Intelligence" cards.
//
// Pure presentational components fed by lib/fitnessInsights (+ tempoScore). They
// hold no data logic — the Progress screen computes the derivations once and
// passes them in — so they stay cheap and testable. Every card leads with a
// decision, not a raw number, per the design brief.

import { ReactNode } from 'react'
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, Typography, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { FadeInView, PressableScale } from '@/components/motion'
import { CountUp } from '@/components/celebration'
import { SvgProgressRing } from '@/components/SvgProgressRing'
import type {
  Momentum, Readiness, Predictor, Heatmap, ForecastDay, OptimalWindow, JourneyEvent,
} from '@/lib/fitnessInsights'
import type { TempoScoreBreakdown } from '@/lib/tempoScore'

// ── Section header ──────────────────────────────────────────────────────────────

export function SectionLabel({ title, hint }: { title: string; hint?: string }) {
  const s = useThemedStyles(makeStyles)
  return (
    <View style={s.sectionLabelWrap}>
      <Text style={s.sectionLabelTitle}>{title}</Text>
      {hint ? <Text style={s.sectionLabelHint}>{hint}</Text> : null}
    </View>
  )
}

// ── 1. Tempo Score hero ─────────────────────────────────────────────────────────

const COMPONENT_META: { key: keyof TempoScoreBreakdown['components']; label: string; phrase: string }[] = [
  { key: 'completion', label: 'Finish', phrase: 'finishing what you start' },
  { key: 'goal', label: 'Goal', phrase: 'hitting your weekly goal' },
  { key: 'consistency', label: 'Weekly', phrase: 'showing up every week' },
  { key: 'streak', label: 'Streak', phrase: 'your current streak' },
  { key: 'frequency', label: 'Cadence', phrase: 'your training cadence' },
]

export function TempoScoreHero({ breakdown, delay = 0 }: { breakdown: TempoScoreBreakdown; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const comps = breakdown.components
  const ranked = [...COMPONENT_META].sort((a, b) => comps[b.key] - comps[a.key])
  const top = ranked[0]
  const bottom = ranked[ranked.length - 1]
  const why = comps[bottom.key] < 0.5 && bottom.key !== top.key
    ? `Lifted most by ${top.phrase}. Grow it by ${bottom.phrase}.`
    : `Lifted most by ${top.phrase}.`

  return (
    <FadeInView style={s.heroCard} delay={delay}>
      <View style={s.heroGlow} pointerEvents="none" />
      <Text style={s.heroEyebrow}>TEMPO SCORE</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <CountUp value={breakdown.score} delay={delay + 200} duration={900} style={s.heroNumber} />
        <Text style={s.heroDenom}>/ 1000</Text>
      </View>
      <View style={s.whyBars}>
        {COMPONENT_META.map((m) => (
          <View key={m.key} style={s.whyBarCol}>
            <View style={s.whyBarTrack}>
              <View style={[s.whyBarFill, { height: `${Math.max(4, Math.round(comps[m.key] * 100))}%` as `${number}%` }]} />
            </View>
            <Text style={s.whyBarLabel}>{m.label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.heroWhy}>{why}</Text>
    </FadeInView>
  )
}

// ── 2. Readiness ────────────────────────────────────────────────────────────────

function toneColor(C: Palette, tone: 'good' | 'ok' | 'low'): string {
  return tone === 'good' ? C.readyHigh : tone === 'ok' ? C.readyMed : C.readyLow
}
function scoreBand(C: Palette, score: number): string {
  return score >= 80 ? C.readyHigh : score >= 55 ? C.readyMed : C.readyLow
}

export function ReadinessCard({ readiness, delay = 0 }: { readiness: Readiness; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const band = scoreBand(C, readiness.score)

  return (
    <FadeInView style={s.card} delay={delay}>
      <View style={s.rowBetween}>
        <Text style={s.cardLabel}>READINESS</Text>
        <Text style={[s.pill, { color: band, borderColor: band }]}>{readiness.label}</Text>
      </View>
      <View style={s.readyBody}>
        <SvgProgressRing value={readiness.score} size={104} stroke={11} gradientFrom={band} gradientTo={band} delay={delay + 150}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <CountUp value={readiness.score} delay={delay + 250} style={[s.readyNum, { color: band }]} />
            <Text style={[s.readyPct, { color: band }]}>%</Text>
          </View>
        </SvgProgressRing>
        <View style={s.readyRight}>
          <Text style={s.readyHeadline}>{readiness.headline}</Text>
          <ReadyComponentRow label="Recovery" comp={readiness.recovery} />
          <ReadyComponentRow label="Load" comp={readiness.load} />
        </View>
      </View>
    </FadeInView>
  )
}

function ReadyComponentRow({ label, comp }: { label: string; comp: Readiness['recovery'] }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const color = toneColor(C, comp.tone)
  return (
    <View style={s.readyComp}>
      <View style={[s.readyDot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.readyCompHead}>
          {label}: <Text style={{ color }}>{comp.label}</Text>
        </Text>
        <Text style={s.readyCompDetail}>{comp.detail}</Text>
      </View>
    </View>
  )
}

// ── 3. Momentum ─────────────────────────────────────────────────────────────────

export function MomentumCard({ momentum, delay = 0 }: { momentum: Momentum; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  return (
    <FadeInView style={[s.card, s.momentumCard]} delay={delay}>
      <View style={s.rowBetween}>
        <Text style={[s.cardLabel, { color: 'rgba(255,255,255,0.72)' }]}>MOMENTUM</Text>
        <Ionicons name="flame" size={18} color={momentum.isBest ? C.gold : 'rgba(255,255,255,0.85)'} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <CountUp value={momentum.score} delay={delay + 200} style={s.momentumNum} />
        <Text style={s.momentumLabel}>{momentum.label}</Text>
      </View>
      <View style={s.momentumTrack}>
        <View style={[s.momentumFill, { width: `${Math.max(3, momentum.score)}%` as `${number}%` }]} />
      </View>
      <Text style={s.momentumMsg}>{momentum.message}</Text>
    </FadeInView>
  )
}

// ── 4. Consistency predictor (this week) ────────────────────────────────────────

export function PredictorCard({ predictor, delay = 0 }: { predictor: Predictor; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const dots = Array.from({ length: predictor.goal }, (_, i) => {
    if (i < predictor.completed) return 'done'
    if (i < predictor.completed + predictor.remainingScheduled) return 'scheduled'
    return 'open'
  })
  return (
    <FadeInView style={s.card} delay={delay}>
      <View style={s.rowBetween}>
        <Text style={s.cardLabel}>THIS WEEK</Text>
        <Text style={[s.pill, { color: predictor.onTrack ? C.readyHigh : C.readyMed, borderColor: predictor.onTrack ? C.readyHigh : C.readyMed }]}>
          {predictor.onTrack ? 'On track' : 'Behind'}
        </Text>
      </View>
      <View style={s.dotsRow}>
        {dots.map((kind, i) => (
          <View
            key={i}
            style={[
              s.goalDot,
              kind === 'done' && { backgroundColor: C.primary, borderColor: C.primary },
              kind === 'scheduled' && { borderColor: C.primary, borderStyle: 'dashed' },
            ]}
          />
        ))}
      </View>
      <Text style={s.predictorMsg}>{predictor.message}</Text>
    </FadeInView>
  )
}

// ── 5. Consistency heatmap (GitHub-style) ───────────────────────────────────────

export function ConsistencyHeatmap({ heatmap, streak, delay = 0 }: { heatmap: Heatmap; streak: number; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const cellColor = (kind: 'none' | 'completed' | 'missed') =>
    kind === 'completed' ? C.primary : kind === 'missed' ? C.emberSoft : C.surfaceContainerHigh

  return (
    <FadeInView style={s.card} delay={delay}>
      <View style={s.rowBetween}>
        <Text style={s.cardLabel}>CONSISTENCY</Text>
        <Text style={s.heatStreak}>{streak > 0 ? `${streak}-session streak` : 'Build your streak'}</Text>
      </View>
      <View style={s.heatGrid}>
        {heatmap.weeks.map((week, wi) => (
          <View key={wi} style={s.heatCol}>
            {week.map((cell, di) => (
              <View key={di} style={[s.heatCell, { backgroundColor: cellColor(cell.kind) }]} />
            ))}
          </View>
        ))}
      </View>
      <Text style={s.heatCaption}>
        {heatmap.totalCompleted} sessions · best week {heatmap.bestWeekCount} · last {heatmap.weeks.length} weeks
      </Text>
    </FadeInView>
  )
}

// ── 6. Forecast strip ───────────────────────────────────────────────────────────

export function ForecastStrip({ days, delay = 0 }: { days: ForecastDay[]; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const dot = (level: ForecastDay['level']) => (level === 'good' ? C.readyHigh : level === 'moderate' ? C.readyMed : C.readyLow)
  return (
    <FadeInView style={s.card} delay={delay}>
      <Text style={s.cardLabel}>WORKOUT FORECAST</Text>
      <View style={s.forecastRow}>
        {days.map((d) => (
          <View key={d.date} style={s.forecastCell}>
            <Text style={s.forecastDay}>{d.dayLabel}</Text>
            <View style={[s.forecastDot, { backgroundColor: dot(d.level) }]} />
            <Text style={s.forecastReason}>{d.reason}</Text>
          </View>
        ))}
      </View>
    </FadeInView>
  )
}

// ── 7. Insights + optimal window ────────────────────────────────────────────────

export function InsightsCard({
  patterns, optimal, onSchedule, delay = 0,
}: { patterns: string[]; optimal: OptimalWindow; onSchedule?: () => void; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  if (!patterns.length && !optimal.hasData) return null
  return (
    <FadeInView style={s.card} delay={delay}>
      <Text style={s.cardLabel}>TEMPO INSIGHTS</Text>
      {optimal.hasData && (
        <View style={s.optimalRow}>
          <View style={s.insightIcon}><Ionicons name="time-outline" size={16} color={C.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.optimalWindow}>Best window · {optimal.windowLabel}</Text>
            <Text style={s.insightText}>{optimal.reason}</Text>
          </View>
          {onSchedule && (
            <PressableScale style={s.scheduleBtn} onPress={onSchedule} scaleTo={0.94}>
              <Text style={s.scheduleBtnText}>Schedule</Text>
            </PressableScale>
          )}
        </View>
      )}
      {patterns.map((p, i) => (
        <View key={i} style={s.insightRow}>
          <View style={s.insightIcon}><Ionicons name="bulb-outline" size={16} color={C.gold} /></View>
          <Text style={s.insightText}>{p}</Text>
        </View>
      ))}
      {optimal.weekdayInsight && (
        <View style={s.insightRow}>
          <View style={s.insightIcon}><Ionicons name="calendar-outline" size={16} color={C.primary} /></View>
          <Text style={s.insightText}>{optimal.weekdayInsight}</Text>
        </View>
      )}
    </FadeInView>
  )
}

// ── 8. Journey timeline ─────────────────────────────────────────────────────────

export function JourneyTimeline({ events, delay = 0 }: { events: JourneyEvent[]; delay?: number }) {
  const s = useThemedStyles(makeStyles)
  const C = useTheme()
  if (!events.length) return null
  return (
    <FadeInView style={s.card} delay={delay}>
      <Text style={s.cardLabel}>YOUR JOURNEY</Text>
      <View style={{ gap: 0 }}>
        {events.map((e, i) => (
          <View key={`${e.title}-${i}`} style={s.journeyRow}>
            <View style={s.journeyRail}>
              <View style={s.journeyDot}><Ionicons name={e.icon as any} size={12} color={C.onPrimary} /></View>
              {i < events.length - 1 && <View style={s.journeyLine} />}
            </View>
            <View style={s.journeyBody}>
              <Text style={s.journeyTitle}>{e.title}</Text>
              <Text style={s.journeyDetail}>{e.detail}</Text>
            </View>
          </View>
        ))}
      </View>
    </FadeInView>
  )
}

// ── Card wrapper (for arbitrary extra content in a consistent shell) ─────────────

export function InfoCard({ children, style, delay = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const s = useThemedStyles(makeStyles)
  return <FadeInView style={[s.card, style]} delay={delay}>{children}</FadeInView>
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const makeStyles = (C: Palette) => StyleSheet.create({
  sectionLabelWrap: { gap: 2, marginTop: Spacing.xs, marginBottom: 2 },
  sectionLabelTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  sectionLabelHint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary },

  card: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card, padding: Spacing.lg, gap: Spacing.md, ...Elevation.e1 },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, borderWidth: 1, overflow: 'hidden' },

  // Hero
  heroCard: { backgroundColor: C.surfaceContainer, borderRadius: Radius.card, padding: Spacing.lg, gap: Spacing.md, overflow: 'hidden', borderWidth: 1, borderColor: C.glassBorder, ...Elevation.e2 },
  heroGlow: { position: 'absolute', top: -80, right: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: C.primarySoft },
  heroEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 1 },
  heroNumber: { fontFamily: C.fontDisplay, fontSize: Typography.metricHero.fontSize, lineHeight: Typography.metricHero.lineHeight, color: C.text, letterSpacing: Typography.metricHero.letterSpacing },
  heroDenom: { fontFamily: 'Inter_500Medium', fontSize: 18, color: C.textSecondary, marginBottom: 8 },
  whyBars: { flexDirection: 'row', gap: 8, height: 64, alignItems: 'flex-end' },
  whyBarCol: { flex: 1, alignItems: 'center', gap: 6 },
  whyBarTrack: { width: '100%', height: 44, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  whyBarFill: { width: '100%', backgroundColor: C.primary, borderRadius: Radius.sm },
  whyBarLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textSecondary },
  heroWhy: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 19 },

  // Readiness
  readyBody: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  readyNum: { fontFamily: C.fontDisplay, fontSize: 30, letterSpacing: -1 },
  readyPct: { fontFamily: C.fontDisplay, fontSize: 16 },
  readyRight: { flex: 1, gap: Spacing.xs },
  readyHeadline: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, lineHeight: 19, marginBottom: 2 },
  readyComp: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  readyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  readyCompHead: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.text },
  readyCompDetail: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.textSecondary, lineHeight: 15 },

  // Momentum
  momentumCard: { backgroundColor: C.primaryContainer },
  momentumNum: { fontFamily: C.fontDisplay, fontSize: 44, color: '#FFFFFF', letterSpacing: -1.5 },
  momentumLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, color: 'rgba(255,255,255,0.9)', marginBottom: 6 },
  momentumTrack: { height: 7, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: Radius.pill },
  momentumFill: { height: 7, backgroundColor: '#FFFFFF', borderRadius: Radius.pill },
  momentumMsg: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: 'rgba(255,255,255,0.92)', lineHeight: 19 },

  // Predictor
  dotsRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  goalDot: { width: 22, height: 22, borderRadius: Radius.pill, borderWidth: 2, borderColor: C.outlineVariant, backgroundColor: 'transparent' },
  predictorMsg: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.text, lineHeight: 19 },

  // Heatmap
  heatStreak: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  heatGrid: { flexDirection: 'row', gap: 3, justifyContent: 'space-between' },
  heatCol: { gap: 3, flex: 1 },
  heatCell: { width: '100%', aspectRatio: 1, borderRadius: 2, maxHeight: 14 },
  heatCaption: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.textSecondary },

  // Forecast
  forecastRow: { flexDirection: 'row', gap: Spacing.sm },
  forecastCell: { flex: 1, gap: 6, alignItems: 'center', backgroundColor: C.surfaceContainer, borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: 6 },
  forecastDay: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },
  forecastDot: { width: 12, height: 12, borderRadius: 6 },
  forecastReason: { fontFamily: 'Inter_400Regular', fontSize: 10.5, color: C.textSecondary, textAlign: 'center', lineHeight: 14 },

  // Insights
  optimalRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  insightRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  insightIcon: { width: 30, height: 30, borderRadius: Radius.md, backgroundColor: C.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  optimalWindow: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  insightText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, flex: 1, alignSelf: 'center' },
  scheduleBtn: { backgroundColor: C.primary, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  scheduleBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.onPrimary },

  // Journey
  journeyRow: { flexDirection: 'row', gap: Spacing.md },
  journeyRail: { alignItems: 'center', width: 24 },
  journeyDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  journeyLine: { width: 2, flex: 1, backgroundColor: C.outlineVariant, marginVertical: 2, minHeight: 16 },
  journeyBody: { flex: 1, paddingBottom: Spacing.md },
  journeyTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  journeyDetail: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 1 },
})
