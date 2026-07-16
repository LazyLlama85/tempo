// Tempo — the day-timeline hero glance (Home redesign, plan approved 2026-07-16).
//
// A compact, NON-INTERACTIVE visual strip showing today's real calendar shape —
// busy blocks + the Tempo workout dropped into its actual gap — so the
// scheduling intelligence is *felt* in a glance ("your real calendar gaps with
// the workout dropped in place"), not just implied by a time label buried in a
// card. Deliberately does NOT replace or modify the existing interactive cards
// below it (`renderWorkout`/`renderEvent` in `(tabs)/index.tsx`) — those keep
// every bit of their existing badge/reschedule/conflict logic completely
// untouched. This is a new, additive element that sits above them; a design
// fork was raised and this (over a full absolute-position replacement of the
// card list) was the explicitly chosen lower-risk option.
//
// No new data: fed entirely by `lib/dayTimeline.ts`'s pure layout over Home's
// already-merged, already-sorted today feed — no new fetches, no new state.

import { View, Text, StyleSheet } from 'react-native'
import { Spacing, Radius } from '@/constants/theme'
import { useThemedStyles, type Palette } from '@/theme'
import type { TimelineBlock, TimelineBounds } from '@/lib/dayTimeline'

const ROW_HEIGHT = 20
const AXIS_TOP_OFFSET = 18

function hourLabel(min: number): string {
  const h24 = Math.floor((((min % 1440) + 1440) % 1440) / 60)
  const h = h24 % 12 || 12
  return `${h}${h24 >= 12 ? 'p' : 'a'}`
}

interface Props {
  blocks: TimelineBlock[]
  bounds: TimelineBounds
}

export function DayTimelineStrip({ blocks, bounds }: Props) {
  const styles = useThemedStyles(makeStyles)
  // Honest empty state: nothing to glance at (no calendar connected, no
  // workout, no events) means no ruler — never an empty box that looks broken.
  if (!blocks.length) return null

  const rows = Math.max(...blocks.map((b) => b.lane)) + 1
  const height = AXIS_TOP_OFFSET + rows * ROW_HEIGHT + 6

  return (
    // Purely decorative/supplementary — the real, accessible content is the
    // card list below. Screen readers skip this entirely rather than trying
    // to make sense of a wall of positioned Views (the exact "custom visual =
    // screen-reader dead zone" risk called out for this app's other rings).
    <View
      style={[styles.wrap, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.axisLine} />
      <Text style={[styles.axisLabel, styles.axisLabelStart]}>{hourLabel(bounds.startMin)}</Text>
      <Text style={[styles.axisLabel, styles.axisLabelEnd]}>{hourLabel(bounds.endMin)}</Text>
      {blocks.map((b) => {
        const isHero = b.item.kind === 'workout' && b.item.hero
        const left = Math.max(0, Math.min(100, b.topPct))
        const width = Math.max(2, Math.min(100 - left, b.heightPct))
        return (
          <View
            key={b.item.kind === 'workout' ? `w-${b.item.workout.id}` : `e-${b.item.event.id}`}
            style={[
              styles.block,
              isHero ? styles.blockHero : styles.blockEvent,
              { left: `${left}%` as `${number}%`, width: `${width}%` as `${number}%`, top: AXIS_TOP_OFFSET + b.lane * ROW_HEIGHT },
            ]}
          >
            {b.item.kind === 'workout' && b.item.hero && (
              <Text style={styles.blockLabel} numberOfLines={1}>{b.item.workout.focus}</Text>
            )}
          </View>
        )
      })}
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  wrap: {
    position: 'relative',
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    overflow: 'hidden',
  },
  axisLine: {
    position: 'absolute', left: Spacing.sm, right: Spacing.sm, top: AXIS_TOP_OFFSET - 1,
    height: 1, backgroundColor: C.outlineVariant,
  },
  axisLabel: { position: 'absolute', top: 2, fontFamily: 'Inter_500Medium', fontSize: 10, color: C.outline },
  axisLabelStart: { left: Spacing.sm },
  axisLabelEnd: { right: Spacing.sm },
  block: { position: 'absolute', height: ROW_HEIGHT - 6, borderRadius: Radius.sm, justifyContent: 'center', paddingHorizontal: 4 },
  blockEvent: { backgroundColor: C.surfaceContainerHigh },
  blockHero: { backgroundColor: C.primary },
  blockLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.onPrimary },
})
