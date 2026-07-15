// Tempo — Profile premium cards.
//
// The identity + insight surfaces that make Profile feel personal and premium
// rather than a settings list: a Fitness Identity card (goal/frequency/duration/
// equipment/split as chips) and a Tempo Insights grid (WHOOP/Oura-style stat tiles).
// Pure/presentational — the screen computes the values and passes them in.

import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { FadeInView } from '@/components/motion'

type IconName = keyof typeof Ionicons.glyphMap

// ── Fitness Identity ──────────────────────────────────────────────────────────

export interface IdentityChip { icon: IconName; label: string; value: string }

export function FitnessIdentityCard({ chips, delay = 0 }: { chips: IdentityChip[]; delay?: number }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  return (
    <FadeInView style={s.card} delay={delay}>
      <Text style={s.cardLabel}>FITNESS IDENTITY</Text>
      <View style={s.chipGrid}>
        {chips.map((c, i) => (
          <View key={i} style={s.identityChip}>
            <View style={s.chipIcon}><Ionicons name={c.icon} size={16} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.chipValue} numberOfLines={1}>{c.value}</Text>
              <Text style={s.chipLabel} numberOfLines={1}>{c.label}</Text>
            </View>
          </View>
        ))}
      </View>
    </FadeInView>
  )
}

// ── Tempo Insights ──────────────────────────────────────────────────────────--

export interface InsightTile { icon: IconName; label: string; value: string; tint: string }

export function InsightsGrid({ tiles, delay = 0 }: { tiles: InsightTile[]; delay?: number }) {
  const s = useThemedStyles(makeStyles)
  return (
    <FadeInView style={s.insightsWrap} delay={delay}>
      <Text style={s.sectionTitle}>Tempo Insights</Text>
      <View style={s.tileGrid}>
        {tiles.map((t, i) => (
          <View key={i} style={s.tile}>
            <View style={[s.tileIcon, { backgroundColor: t.tint + '22' }]}>
              <Ionicons name={t.icon} size={16} color={t.tint} />
            </View>
            <Text style={s.tileValueText} numberOfLines={1}>{t.value}</Text>
            <Text style={s.tileLabel} numberOfLines={1}>{t.label}</Text>
          </View>
        ))}
      </View>
    </FadeInView>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────--

const makeStyles = (C: Palette) => StyleSheet.create({
  card: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1 },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  identityChip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    flexGrow: 1, flexBasis: '46%', minWidth: '46%',
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm,
  },
  chipIcon: { width: 32, height: 32, borderRadius: Radius.sm + 2, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  chipValue: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  chipLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, marginTop: 1 },

  insightsWrap: { gap: Spacing.sm },
  sectionTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    flexGrow: 1, flexBasis: '30%', minWidth: '30%',
    backgroundColor: C.background, borderRadius: Radius.lg, padding: Spacing.md, gap: 6,
    borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1,
  },
  tileIcon: { width: 30, height: 30, borderRadius: Radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
  tileValue: { height: 0 },
  tileValueText: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.6 },
  tileLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary },
})
