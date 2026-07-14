// Tempo — badge shelf. Renders the consistency badges (lib/badges) in the same
// tile language as the Achievements section: a tier-tinted icon in a circle, label,
// and description/progress. Earned badges are lit; locked ones dim to something to
// chase. Read-only, no state.

import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { BADGES, type BadgeStats, type BadgeTier } from '@/lib/badges'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'

const TIER_COLOR: Record<BadgeTier, string> = { bronze: '#B45309', silver: '#64748B', gold: '#B8860B' }

interface Props {
  earned: Set<string> | string[]
  /** Provide to show progress on locked derived badges (e.g. "18/30"). */
  stats?: BadgeStats
  /** Show locked badges dimmed (default) so there's something to earn; false = only earned. */
  showLocked?: boolean
}

export function BadgeShelf({ earned, stats, showLocked = true }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const earnedSet = earned instanceof Set ? earned : new Set(earned)
  const list = showLocked ? BADGES : BADGES.filter((b) => earnedSet.has(b.key))
  if (!list.length) return null

  return (
    <View style={styles.row}>
      {list.map((b) => {
        const on = earnedSet.has(b.key)
        const tint = on ? TIER_COLOR[b.tier] : C.outline
        const prog = stats && b.progress ? b.progress(stats) : null
        return (
          <View key={b.key} style={[styles.badge, !on && styles.badgeLocked]}>
            <View style={[styles.icon, { backgroundColor: on ? tint + '22' : C.surfaceContainerHigh }]}>
              <Ionicons name={b.icon as any} size={24} color={tint} />
              {!on && (
                <View style={styles.lockDot}><Ionicons name="lock-closed" size={9} color={C.outline} /></View>
              )}
            </View>
            <Text style={[styles.label, !on && styles.labelLocked]} numberOfLines={1}>{b.label}</Text>
            {!on && prog && prog.target > 1 ? (
              <Text style={styles.prog}>{Math.round(prog.current).toLocaleString()}/{prog.target.toLocaleString()}</Text>
            ) : (
              <Text style={styles.desc} numberOfLines={2}>{b.description}</Text>
            )}
          </View>
        )
      })}
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  badge: {
    flexGrow: 1, flexBasis: '30%', maxWidth: '32%', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.sm, alignItems: 'center', gap: 4,
  },
  badgeLocked: { opacity: 0.7 },
  icon: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  lockDot: { position: 'absolute', bottom: -2, right: -2, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, padding: 2 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.text, textAlign: 'center' },
  labelLocked: { color: C.outline },
  desc: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textSecondary, textAlign: 'center', lineHeight: 13 },
  prog: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary },
})
