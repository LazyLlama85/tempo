// Tempo — badge shelf. Renders the consistency badges (lib/badges) on a profile:
// earned ones lit, the rest dimmed as something to chase. Read-only, no state.

import { View, Text, StyleSheet } from 'react-native'
import { BADGES } from '@/lib/badges'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useThemedStyles } from '@/theme'

interface Props {
  earned: Set<string> | string[]
  /** Show locked badges dimmed (default) so there's something to earn; false = only earned. */
  showLocked?: boolean
}

export function BadgeShelf({ earned, showLocked = true }: Props) {
  const styles = useThemedStyles(makeStyles)
  const earnedSet = earned instanceof Set ? earned : new Set(earned)
  const list = showLocked ? BADGES : BADGES.filter((b) => earnedSet.has(b.key))
  if (!list.length) return null
  return (
    <View style={styles.wrap}>
      {list.map((b) => {
        const on = earnedSet.has(b.key)
        return (
          <View key={b.key} style={[styles.chip, on ? styles.chipOn : styles.chipOff]}>
            <Text style={[styles.emoji, !on && styles.dim]}>{b.emoji}</Text>
            <Text style={[styles.label, on ? styles.labelOn : styles.labelOff]} numberOfLines={1}>
              {b.label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.sm, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1,
  },
  chipOn: { backgroundColor: C.primarySoft, borderColor: C.primary },
  chipOff: { backgroundColor: C.surfaceContainerLow, borderColor: C.outlineVariant },
  emoji: { fontSize: 15 },
  dim: { opacity: 0.4 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  labelOn: { color: C.text },
  labelOff: { color: C.outline },
})
