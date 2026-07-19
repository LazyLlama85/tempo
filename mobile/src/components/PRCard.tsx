// Tempo — the personal-record celebration card. Shared by workout-complete.tsx
// (the "hero" moment, animated with an icon per row) and session-detail.tsx (a
// compact static recap). Themed via C.gold so it reads correctly in both the
// dark "Ink" and light "Paper" palettes — the old inline version hardcoded
// #B8860B, which rendered as a muddy dark gold against the light theme.

import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { PopIn } from '@/components/motion'
import { prLine, type SessionPR } from '@/lib/prs'
import type { WeightUnit } from '@/lib/units'

interface Props {
  prs: SessionPR[]
  unit: WeightUnit
  /** hero = animated, icon per row (workout-complete); compact = static recap (session-detail). */
  variant?: 'hero' | 'compact'
  /** PopIn stagger delay — hero variant only. */
  delay?: number
  maxItems?: number
}

export function PRCard({ prs, unit, variant = 'hero', delay = 0, maxItems = 3 }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  if (!prs.length) return null

  const hero = variant === 'hero'
  const title = hero
    ? (prs.length === 1 ? 'NEW PERSONAL RECORD' : `${prs.length} NEW PERSONAL RECORDS`)
    : (prs.length === 1 ? 'PERSONAL RECORD' : `${prs.length} PERSONAL RECORDS`)

  const content = (
    <>
      <View style={hero ? styles.header : styles.headerCompact}>
        <Ionicons name="trophy" size={hero ? 18 : 15} color={C.onPrimary} />
        <Text style={hero ? styles.headerText : styles.headerTextCompact}>{title}</Text>
      </View>
      {prs.slice(0, maxItems).map((pr) => hero ? (
        <View key={pr.exercise + pr.kind} style={styles.row}>
          <Ionicons name="arrow-up-circle" size={16} color={C.onPrimary} />
          <Text style={styles.rowText}>{prLine(pr, unit)}</Text>
        </View>
      ) : (
        <Text key={pr.exercise + pr.kind} style={styles.rowTextCompact}>{prLine(pr, unit)}</Text>
      ))}
    </>
  )

  if (hero) return <PopIn delay={delay} style={styles.card}>{content}</PopIn>
  return <View style={styles.cardCompact}>{content}</View>
}

const makeStyles = (C: Palette) => StyleSheet.create({
  card: { backgroundColor: C.gold, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs, marginTop: Spacing.xs },
  cardCompact: { backgroundColor: C.gold, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  headerCompact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerText: { fontFamily: C.fontDisplay, fontSize: 12, color: C.onPrimary, letterSpacing: 0.6 },
  headerTextCompact: { fontFamily: C.fontDisplay, fontSize: 11, color: C.onPrimary, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
  rowTextCompact: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.onPrimary },
})
