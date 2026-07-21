// Tempo — plate-loading calculator (Pro). "245 lbs → 45+45+25 per side."
//
// Reachable from a set row's weight column in the workout runner, pre-filled
// with that set's prescribed/logged weight. Pure UI over lib/plateCalc.ts —
// no persistence, nothing saved, just the math made visible.

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TextInput } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TempoSheet } from '@/components/TempoSheet'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { calculatePlates, defaultBarWeight, PLATES_LBS, PLATES_KG } from '@/lib/plateCalc'
import type { WeightUnit } from '@/lib/units'

interface Props {
  visible: boolean
  onClose: () => void
  initialWeight?: number | null
  unit: WeightUnit
}

// A distinct color per plate size so the stack reads at a glance — standard
// gym plate colors (IWF-ish), not tied to the app's brand palette on purpose.
const PLATE_COLOR: Record<number, string> = {
  45: '#D64545', 25: '#3A7BD5', 20: '#3A7BD5', 15: '#3A9B5C',
  35: '#E8A93B', 10: '#E8E8E8', 5: '#3A3A3A', 2.5: '#B8B8B8', 1.25: '#8A8A8A',
}

export function PlateCalcSheet({ visible, onClose, initialWeight, unit }: Props) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const [weightStr, setWeightStr] = useState('')
  const [barWeight, setBarWeight] = useState(defaultBarWeight(unit))

  useEffect(() => {
    if (!visible) return
    setWeightStr(initialWeight ? String(initialWeight) : '')
    setBarWeight(defaultBarWeight(unit))
  }, [visible, initialWeight, unit])

  const target = parseFloat(weightStr) || 0
  const result = calculatePlates(target, barWeight, unit)
  const barOptions = unit === 'kg' ? [15, 20] : [35, 45]

  return (
    <TempoSheet visible={visible} onClose={onClose}>
      <View style={s.sheet}>
        <View style={s.headerRow}>
          <Ionicons name="barbell" size={20} color={C.primary} />
          <Text style={s.title}>Plate Calculator</Text>
        </View>

        <Text style={s.label}>TARGET WEIGHT</Text>
        <View style={s.weightRow}>
          <TextInput
            style={s.weightInput}
            value={weightStr}
            onChangeText={setWeightStr}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={C.outline}
            autoFocus
          />
          <Text style={s.unitLabel}>{unit}</Text>
        </View>

        <Text style={s.label}>BAR</Text>
        <View style={s.barRow}>
          {barOptions.map(b => (
            <PressableScale
              key={b}
              style={[s.barChip, barWeight === b && s.barChipActive]}
              onPress={() => setBarWeight(b)}
              scaleTo={0.95}
              accessibilityRole="button"
              accessibilityState={{ selected: barWeight === b }}
            >
              <Text style={[s.barChipText, barWeight === b && s.barChipTextActive]}>{b} {unit}</Text>
            </PressableScale>
          ))}
        </View>

        {target > 0 && (
          <View style={s.resultCard}>
            {result.perSide.length === 0 ? (
              <Text style={s.resultEmpty}>Just the bar — no plates needed.</Text>
            ) : (
              <>
                <Text style={s.resultLabel}>PER SIDE</Text>
                <View style={s.stackRow}>
                  {result.perSide.map((p, i) => (
                    <View key={i} style={[s.plateBlock, { backgroundColor: PLATE_COLOR[p] ?? C.outline }]}>
                      <Text style={s.plateText}>{p}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.resultLine}>
                  {result.perSide.join(' + ')} {unit} per side
                </Text>
              </>
            )}
            <Text style={s.totalLine}>
              {result.total} {unit} total ({barWeight} bar + {result.loadedPerSide * 2} plates)
            </Text>
            {!result.exact && (
              <View style={s.inexactRow}>
                <Ionicons name="information-circle-outline" size={14} color={C.outline} />
                <Text style={s.inexactText}>
                  Closest with standard plates — {result.remainder} {unit} short per side.
                </Text>
              </View>
            )}
          </View>
        )}

        <Text style={s.footnote}>
          Standard plates: {(unit === 'kg' ? PLATES_KG : PLATES_LBS).join(', ')} {unit}.
        </Text>
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { padding: Spacing.lg, gap: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xs },
  title: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  weightRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs },
  weightInput: {
    flex: 1, fontFamily: C.fontDisplay, fontSize: 32, color: C.text,
    borderBottomWidth: 2, borderBottomColor: C.primary, paddingVertical: 4,
  },
  unitLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.textSecondary },
  barRow: { flexDirection: 'row', gap: Spacing.sm },
  barChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full,
    backgroundColor: C.surfaceContainerLow, borderWidth: 1, borderColor: C.outlineVariant,
  },
  barChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  barChipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text },
  barChipTextActive: { color: C.onPrimary },
  resultCard: {
    marginTop: Spacing.sm, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, gap: 6,
  },
  resultLabel: { fontFamily: 'Inter_700Bold', fontSize: 10.5, color: C.outline, letterSpacing: 0.6 },
  resultEmpty: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  stackRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, flexWrap: 'wrap' },
  plateBlock: {
    width: 34, height: 46, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center',
  },
  plateText: { fontFamily: 'Inter_800ExtraBold', fontSize: 11, color: '#fff' },
  resultLine: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, marginTop: 2 },
  totalLine: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },
  inexactRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  inexactText: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: C.outline, flex: 1 },
  footnote: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.outline, marginTop: Spacing.xs },
})
