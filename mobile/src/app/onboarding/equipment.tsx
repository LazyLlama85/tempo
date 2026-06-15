import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import type { Equipment } from '@/types'

const C = Colors.light

const OPTIONS: { id: Equipment; label: string; description: string; icon: string }[] = [
  { id: 'full_gym', label: 'Full gym', description: 'Barbells, cables, machines — the works', icon: 'business-outline' },
  { id: 'dumbbells', label: 'Dumbbells only', description: 'Adjustable or fixed dumbbells at home', icon: 'barbell-outline' },
  { id: 'barbell', label: 'Barbell & plates', description: 'Home setup with a rack or bench', icon: 'fitness-outline' },
  { id: 'resistance_bands', label: 'Resistance bands', description: 'Bands and bodyweight only', icon: 'pulse-outline' },
  { id: 'bodyweight', label: 'No equipment', description: 'Bodyweight training anywhere', icon: 'body-outline' },
]

export default function EquipmentScreen() {
  const router = useRouter()
  const { goal, experience } = useLocalSearchParams<{ goal: string; experience: string }>()
  const [selected, setSelected] = useState<Equipment[]>([])

  const toggle = (id: Equipment) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.logo}>TEMPO</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '60%' }]} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 3 OF 5</Text>
        <Text style={styles.title}>What equipment do you have?</Text>
        <Text style={styles.subtitle}>Select all that apply. We'll only program what you can actually use.</Text>

        <View style={styles.options}>
          {OPTIONS.map((option) => {
            const isSelected = selected.includes(option.id)
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => toggle(option.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBox, isSelected && styles.iconBoxSelected]}>
                  <Ionicons name={option.icon as any} size={22} color={isSelected ? C.onPrimary : C.primary} />
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{option.label}</Text>
                  <Text style={styles.optionDesc}>{option.description}</Text>
                </View>
                <View style={[styles.check, isSelected && styles.checkOn]}>
                  {isSelected && <Ionicons name="checkmark" size={15} color={C.onPrimary} />}
                </View>
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, selected.length === 0 && styles.continueBtnDisabled]}
          onPress={() =>
            selected.length > 0 &&
            router.push({
              pathname: '/onboarding/schedule',
              params: { goal, experience, equipment: selected.join(',') },
            })
          }
          disabled={selected.length === 0}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Continue →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  logo: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: C.primary, letterSpacing: 2 },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  options: { gap: Spacing.sm, marginTop: Spacing.xs },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1.5, borderColor: 'transparent',
  },
  optionSelected: { borderColor: C.primary, backgroundColor: C.background },
  iconBox: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
  },
  iconBoxSelected: { backgroundColor: C.primary },
  optionText: { flex: 1 },
  optionLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  optionLabelSelected: { color: C.primary },
  optionDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 2, lineHeight: 18 },
  check: {
    width: 24, height: 24, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnDisabled: { backgroundColor: C.surfaceContainerHigh },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
