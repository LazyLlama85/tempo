// Tempo — the shareable "Wrapped" card visual.
//
// A deliberately premium share asset: near-black background, one electric-blue
// accent, oversized numbers, minimal words — Spotify-Wrapped, not a spreadsheet.
// Rendered at a fixed size and handed a ref so the parent can snapshot it to a PNG
// with react-native-view-shot. Pure presentation: all numbers come from buildWrappedCards.

import { forwardRef } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Radius } from '@/constants/theme'
import { wrappedFmt, type WrappedCard as CardModel } from '@/lib/wrapped'

const INK = '#070809'
const CARD = '#101218'
const BLUE = '#3D82F7'
const TEXT = '#F4F6FB'
const MUTED = '#8A92A4'
const LINE = 'rgba(255,255,255,0.07)'

export const CARD_W = 320
export const CARD_H = 400

// One "big number + unit + label" stat row used across variants.
function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statValue}>
        {value}{unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function Eyebrow({ icon, text }: { icon?: string; text: string }) {
  return (
    <View style={styles.eyebrowRow}>
      {icon ? <Text style={styles.eyebrowIcon}>{icon}</Text> : null}
      <Text style={styles.eyebrow}>{text}</Text>
    </View>
  )
}

function Body({ card }: { card: CardModel }) {
  switch (card.kind) {
    case 'weekly':
      return (
        <>
          <Eyebrow text="THIS WEEK" />
          <Text style={styles.hero}>{card.workouts}</Text>
          <Text style={styles.heroUnit}>Workout{card.workouts === 1 ? '' : 's'}</Text>
          <View style={styles.stats}>
            <Stat value={wrappedFmt.minutes(card.minutes)} label="Training time" />
            <Stat value={wrappedFmt.num(card.volumeLbs)} unit="lbs" label="Lifted" />
            <Stat value={`${card.adherencePct}%`} label="Of planned workouts completed" />
            {card.prs > 0 && <Stat value={`${card.prs}`} label={`New PR${card.prs === 1 ? '' : 's'}`} />}
          </View>
          {card.topExercise && card.topDeltaLbs ? (
            <View style={styles.highlight}>
              <Text style={styles.highlightLabel}>TOP LIFT</Text>
              <Text style={styles.highlightText}>{card.topExercise} +{card.topDeltaLbs} lbs</Text>
            </View>
          ) : null}
        </>
      )
    case 'streak':
      return (
        <>
          <Eyebrow icon="🔥" text="STREAK" />
          <Text style={styles.hero}>{card.days}</Text>
          <Text style={styles.heroUnit}>Day Streak</Text>
          <View style={styles.stats}>
            <Stat value={`${card.workouts}`} label="Workouts" />
            <Stat value={`${card.hours}`} unit="hours" label="Trained" />
          </View>
          <View style={styles.highlight}>
            <Text style={styles.highlightText}>Never missed a scheduled workout.</Text>
          </View>
        </>
      )
    case 'pr':
      return (
        <>
          <Eyebrow icon="🏆" text="NEW PR" />
          <Text style={styles.prExercise}>{card.exercise}</Text>
          <Text style={styles.hero}>{wrappedFmt.num(card.weight)}</Text>
          <Text style={styles.heroUnit}>lbs</Text>
          {card.deltaLbs ? (
            <View style={styles.highlight}>
              <Text style={styles.highlightText}>+{card.deltaLbs} lbs from your last best</Text>
            </View>
          ) : null}
        </>
      )
    case 'goal':
      return (
        <>
          <Eyebrow text={card.title} />
          <Text style={styles.hero}>{card.pct}%</Text>
          <Text style={styles.heroUnit}>Complete</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${card.pct}%` as `${number}%` }]} />
          </View>
          <View style={styles.stats}>
            <Stat value={`${card.weeksRemaining}`} label={`Week${card.weeksRemaining === 1 ? '' : 's'} remaining`} />
            <Stat value={`${card.workoutsCompleted}`} label="Workouts completed" />
          </View>
        </>
      )
    case 'monthVolume':
      return (
        <>
          <Eyebrow icon="🏋️" text={`${card.monthLabel} VOLUME`} />
          <Text style={styles.hero}>{wrappedFmt.num(card.lbs)}</Text>
          <Text style={styles.heroUnit}>lbs lifted this month</Text>
          <View style={styles.stats}>
            <Stat value={`${card.workouts}`} label="Workouts this month" />
          </View>
          <View style={styles.highlight}>
            <Text style={styles.highlightText}>That's the work behind the progress.</Text>
          </View>
        </>
      )
    case 'topLifts':
      return (
        <>
          <Eyebrow icon="💪" text={`${card.monthLabel} TOP LIFTS`} />
          <View style={[styles.stats, { marginTop: 22 }]}>
            {card.lifts.map((l, i) => (
              <View key={l.name} style={styles.liftRow}>
                <Text style={styles.liftRank}>{i + 1}</Text>
                <Text style={styles.liftName} numberOfLines={1}>{l.name}</Text>
                <Text style={styles.liftWeight}>{wrappedFmt.num(l.weight)} lbs</Text>
              </View>
            ))}
          </View>
        </>
      )
    case 'weightTrend': {
      const diff = Math.round((card.nowLbs - card.startLbs) * 10) / 10
      return (
        <>
          <Eyebrow icon="📉" text="WEIGHT TREND" />
          <Text style={styles.hero}>{diff < 0 ? '' : '+'}{diff}</Text>
          <Text style={styles.heroUnit}>lbs over {card.weeks} week{card.weeks === 1 ? '' : 's'}</Text>
          <View style={styles.stats}>
            <Stat value={`${card.startLbs}`} unit="lbs" label="Where I started" />
            <Stat value={`${card.nowLbs}`} unit="lbs" label="Where I am now" />
            {card.perWeek != null && <Stat value={`${card.perWeek > 0 ? '+' : ''}${card.perWeek}`} unit="lb/wk" label="Current pace" />}
          </View>
        </>
      )
    }
  }
}

interface Props { card: CardModel }

export const WrappedCard = forwardRef<View, Props>(function WrappedCard({ card }, ref) {
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      {/* Soft blue glow in the corner for depth without a gradient dependency */}
      <View style={styles.glow} />
      <View style={styles.inner}>
        <View>{Body({ card })}</View>
        <View style={styles.footer}>
          <View style={styles.brandDot}>
            <Ionicons name="flash" size={12} color="#fff" />
          </View>
          <Text style={styles.brand}>Tempo</Text>
        </View>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  card: {
    width: CARD_W, height: CARD_H, borderRadius: Radius.xl, backgroundColor: INK,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute', top: -90, right: -70, width: 240, height: 240, borderRadius: 120,
    backgroundColor: BLUE, opacity: 0.22,
  },
  inner: {
    flex: 1, backgroundColor: 'transparent', padding: 26, justifyContent: 'space-between',
    borderRadius: Radius.xl, borderWidth: 1, borderColor: LINE,
  },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrowIcon: { fontSize: 14 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 13, color: BLUE, letterSpacing: 1.4 },

  hero: { fontFamily: 'Inter_800ExtraBold', fontSize: 76, color: TEXT, letterSpacing: -3, lineHeight: 80, marginTop: 6 },
  heroUnit: { fontFamily: 'Inter_700Bold', fontSize: 20, color: MUTED, marginTop: -2 },
  prExercise: { fontFamily: 'Inter_700Bold', fontSize: 22, color: TEXT, marginTop: 10 },

  stats: { marginTop: 18, gap: 12 },
  statRow: { gap: 1 },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: TEXT, letterSpacing: -0.5 },
  statUnit: { fontFamily: 'Inter_500Medium', fontSize: 14, color: MUTED },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: MUTED },

  highlight: {
    marginTop: 16, backgroundColor: CARD, borderRadius: Radius.lg, padding: 12,
    borderWidth: 1, borderColor: LINE,
  },
  highlightLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: BLUE, letterSpacing: 0.8, marginBottom: 2 },
  highlightText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: TEXT },

  progressTrack: { height: 8, backgroundColor: CARD, borderRadius: Radius.full, marginTop: 16, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: BLUE, borderRadius: Radius.full },

  liftRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  liftRank: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: BLUE, width: 20 },
  liftName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 17, color: TEXT },
  liftWeight: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: TEXT, letterSpacing: -0.3 },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandDot: {
    width: 20, height: 20, borderRadius: 6, backgroundColor: BLUE,
    alignItems: 'center', justifyContent: 'center',
  },
  brand: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: TEXT, letterSpacing: -0.2 },
})
