// Tempo — the day-timeline vertical rail (Home IA redesign, plan approved
// 2026-07-16, superseding the horizontal ruler from the first day-timeline pass
// the same day). Home's founder-reviewed feedback: the horizontal strip read as
// a weak afterthought above the real cards. This version makes the existing
// card list itself feel like a timeline instead — a continuous rail line behind
// the naturally-flowing `renderWorkout`/`renderEvent` cards (still rendered by
// `(tabs)/index.tsx`, still completely unchanged), plus a `GapRow` between
// items so "your real calendar gaps with the workout dropped in place" is
// visible, not just implied.
//
// Deliberately NOT time-proportional (no absolute positioning by minute): card
// heights vary a lot (a conflict note, a MISSED badge, an overdue prompt all
// add height), and this RN0.85/React19/new-arch stack has already produced
// several silent-rendering bugs this session — position-by-time risks visually
// overlapping cards. The rail line is a single decorative absolutely-positioned
// element spanning the whole (naturally-flowing) list, which carries none of
// that per-item risk.

import { useState } from 'react'
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'

// Must match `index.tsx`'s `railTime` column width exactly so the rail line
// (drawn here) lines up with the time labels (drawn there) — imported by both
// rather than duplicated as two magic numbers that could quietly drift apart.
export const RAIL_COLUMN_WIDTH = 52

// The rail fades out over this many px at each end, so it emerges before the
// first activity and dissolves after the last instead of running past them into
// the surrounding layout with a hard cut.
const RAIL_FADE_PX = 26

interface RailProps {
  children: React.ReactNode
}

/** Wraps a vertically-flowing list of timeline rows with one continuous rail
 * line behind them, centered in the time-label column. Purely decorative.
 * Measured rather than percentage-faded so the fade is a consistent length
 * whether the day has two items or ten. */
export function TimelineRail({ children }: RailProps) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [height, setHeight] = useState(0)
  const onLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)

  // Guard against a fade longer than the rail itself on a very short day —
  // otherwise the two fade zones overlap and the line never reaches full opacity.
  const fade = height > 0 ? Math.min(RAIL_FADE_PX, height / 3) / height : 0

  return (
    <View style={styles.railWrap} onLayout={onLayout}>
      {height > 0 && (
        <Svg
          pointerEvents="none"
          style={styles.railLine}
          width={2}
          height={height}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Defs>
            <LinearGradient id="tempoRailFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={C.outlineVariant} stopOpacity={0} />
              <Stop offset={fade} stopColor={C.outlineVariant} stopOpacity={1} />
              <Stop offset={1 - fade} stopColor={C.outlineVariant} stopOpacity={1} />
              <Stop offset="1" stopColor={C.outlineVariant} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={2} height={height} rx={1} fill="url(#tempoRailFade)" />
        </Svg>
      )}
      {children}
    </View>
  )
}

function formatGapDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

interface GapRowProps {
  minutes: number
}

/** A single "N free" row between two timeline items — the visible proof of
 * "Tempo found the space in your real day," not just an asserted claim. */
export function GapRow({ minutes }: GapRowProps) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.gapRow}>
      {/* Centered in a column the same width as `railTime` so the dot sits
          exactly on the rail line, like a marker along it — decorative only,
          the text carries the actual information. */}
      <View style={styles.gapRailCell} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.gapDot} />
      </View>
      <Text style={styles.gapText}>{formatGapDuration(minutes)} free</Text>
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  railWrap: { position: 'relative' },
  // Height/width come from the measured <Svg> itself (see TimelineRail) — the
  // gradient needs a real pixel height, so this only pins its position.
  railLine: {
    position: 'absolute',
    left: RAIL_COLUMN_WIDTH / 2 - 1,
    top: 0,
  },
  gapRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 6,
  },
  gapRailCell: { width: RAIL_COLUMN_WIDTH, alignItems: 'center', justifyContent: 'center' },
  gapDot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: C.outlineVariant },
  gapText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, fontStyle: 'italic' },
})
