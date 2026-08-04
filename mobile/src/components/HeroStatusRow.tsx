// Fitaround — Home's daily status instrument (streak / readiness / check-in).
//
// Replaces three near-duplicate ad-hoc rows of small `borderRadius: full` pills
// (one per Home state: mid-day, day-complete, rest-day) with one reusable strip.
// The pills read as scattered badges with no relationship to each other; this is
// one instrument with up to three dials, divided by hairlines — matching the
// "every metric reads like a dial" design principle (theme.ts's own header
// comment) instead of a chip a settings screen would use for a filter toggle.
// Purely presentational — callers compute captions/colors (readinessLabel,
// readinessColor) so this component carries no readiness-scoring knowledge of
// its own. Every existing behavior is preserved: which segments show in which
// state, the streak's "muted until earned today" treatment, and check-in's tap
// target opening the same RecoveryCheckIn sheet — only the container changes.

import { type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius, Elevation, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'

export interface HeroStatusRowProps {
  streak: number
  /** True on a not-yet-done day — the count stays visible, just reads "not earned yet today". */
  streakMuted?: boolean
  /** Omitted on the day-complete / rest-day states (nothing left to decide today). */
  readiness?: { score: number; caption: string; dotColor: string } | null
  onReadinessPress?: () => void
  /** null = not checked in yet today. */
  checkin: { caption: string; dotColor: string } | null
  onCheckinPress: () => void
}

export function HeroStatusRow({
  streak, streakMuted, readiness, onReadinessPress, checkin, onCheckinPress,
}: HeroStatusRowProps) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)

  const segments: ReactNode[] = []

  if (streak > 0) {
    segments.push(
      <View key="streak" style={styles.segment}>
        <Ionicons name="flame" size={15} color={streakMuted ? C.outline : C.ember} />
        <Text style={[styles.value, streakMuted && { color: C.outline }]}>{streak}</Text>
        <Text style={styles.caption} numberOfLines={1}>session streak</Text>
      </View>,
    )
  }

  if (readiness) {
    segments.push(
      <PressableScale key="readiness" style={styles.segment} onPress={onReadinessPress} scaleTo={0.97}>
        <View style={[styles.dot, { backgroundColor: readiness.dotColor }]} />
        <Text style={styles.value}>{readiness.score}%</Text>
        <Text style={styles.caption} numberOfLines={1}>{readiness.caption.toLowerCase()}</Text>
      </PressableScale>,
    )
  }

  segments.push(
    <PressableScale key="checkin" style={styles.segment} onPress={onCheckinPress} scaleTo={0.97}>
      {checkin
        ? <View style={[styles.dot, { backgroundColor: checkin.dotColor }]} />
        : <Ionicons name="pulse-outline" size={15} color={C.primary} />}
      <Text style={styles.value} numberOfLines={1}>{checkin ? 'Checked in' : 'Check in'}</Text>
      <Text style={styles.caption} numberOfLines={1}>{checkin ? checkin.caption : 'how do you feel?'}</Text>
    </PressableScale>,
  )

  return (
    <View style={styles.row}>
      {segments.map((seg, i) => (
        <View key={i} style={styles.segWrap}>
          {i > 0 && <View style={styles.divider} />}
          {seg}
        </View>
      ))}
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    ...Elevation.e1,
  },
  segWrap: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  divider: { width: 1, backgroundColor: C.outlineVariant, marginVertical: Spacing.sm },
  segment: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.sm, paddingHorizontal: 6, gap: 2,
  },
  dot: { width: 7, height: 7, borderRadius: Radius.full, marginBottom: 1 },
  value: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: C.text, letterSpacing: -0.2 },
  caption: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: C.textSecondary, letterSpacing: 0.1 },
})
