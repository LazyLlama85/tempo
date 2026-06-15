import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import type { Goal } from '@/types'

const C = Colors.light

const GOALS: { id: Goal; label: string; description: string; icon: string }[] = [
  { id: 'muscle_gain', label: 'Build Muscle', description: 'Hypertrophy and mass building focus.', icon: 'barbell-outline' },
  { id: 'fat_loss', label: 'Lose Fat', description: 'High intensity metabolic conditioning.', icon: 'flame-outline' },
  { id: 'strength', label: 'Gain Strength', description: 'Powerlifting and CNS optimization.', icon: 'battery-charging-outline' },
  { id: 'athletic', label: 'Athletic Performance', description: 'Agility, power, and coordination.', icon: 'speedometer-outline' },
  { id: 'general_fitness', label: 'General Fitness', description: 'Longevity and everyday wellness.', icon: 'pulse-outline' },
]

export default function GoalScreen() {
  const router = useRouter()
  const [selected, setSelected] = useState<Goal | null>(null)

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
        <View style={[styles.progressFill, { width: '33%' }]} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Step label */}
        <Text style={styles.stepLabel}>ONBOARDING 01/03</Text>
        <Text style={styles.title}>What is your primary goal?</Text>
        <Text style={styles.subtitle}>
          Select the outcome that best describes your ideal fitness transformation. You can refine this later.
        </Text>

        {/* Goal list */}
        <View style={styles.options}>
          {GOALS.map((goal) => {
            const isSelected = selected === goal.id
            return (
              <TouchableOpacity
                key={goal.id}
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => setSelected(goal.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBox, isSelected && styles.iconBoxSelected]}>
                  <Ionicons name={goal.icon as any} size={22} color={isSelected ? C.onPrimary : C.primary} />
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{goal.label}</Text>
                  <Text style={styles.optionDesc}>{goal.description}</Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, !selected && styles.continueBtnDisabled]}
          onPress={() => selected && router.push({ pathname: '/onboarding/experience', params: { goal: selected } })}
          disabled={!selected}
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
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnDisabled: { backgroundColor: C.surfaceContainerHigh },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
