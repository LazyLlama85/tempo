import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import type { Experience } from '@/types'

const C = Colors.light

const LEVELS: { id: Experience; label: string; quote: string }[] = [
  { id: 'beginner', label: 'Beginner', quote: '"Focusing on foundational movements and proper form with guided instructions."' },
  { id: 'intermediate', label: 'Intermediate', quote: '"Building progressive overload with compound lifts and structured programming."' },
  { id: 'advanced', label: 'Advanced', quote: '"Periodized training with advanced techniques and performance optimization."' },
]

export default function ExperienceScreen() {
  const router = useRouter()
  const { goal } = useLocalSearchParams<{ goal: string }>()
  const [selected, setSelected] = useState<Experience>('beginner')

  const current = LEVELS.find((l) => l.id === selected)!

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
        <View style={[styles.progressFill, { width: '40%' }]} />
      </View>

      <View style={styles.content}>
        <Text style={styles.stepLabel}>STEP 2 OF 6</Text>
        <Text style={styles.title}>How much experience do you have?</Text>
        <Text style={styles.subtitle}>We'll tailor your starting weights and complexity accordingly.</Text>

        {/* Segmented control */}
        <View style={styles.segmented}>
          {LEVELS.map((level) => (
            <TouchableOpacity
              key={level.id}
              style={[styles.segment, selected === level.id && styles.segmentActive]}
              onPress={() => setSelected(level.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentText, selected === level.id && styles.segmentTextActive]}>
                {level.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Preview card */}
        <View style={styles.previewCard}>
          <View style={styles.previewImage}>
            <Ionicons name="barbell" size={48} color={C.outlineVariant} />
          </View>
          <Text style={styles.previewQuote}>{current.quote}</Text>
        </View>
      </View>

      {/* CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={() => router.push({ pathname: '/onboarding/equipment', params: { goal, experience: selected } })}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Continue</Text>
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
  content: { flex: 1, paddingHorizontal: Spacing.containerPadding, gap: Spacing.lg },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  segmented: {
    flexDirection: 'row', backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg, padding: 4, gap: 4,
  },
  segment: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  segmentActive: { backgroundColor: C.background, shadowColor: C.text, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  segmentText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  segmentTextActive: { fontFamily: 'Inter_700Bold', color: C.text },
  previewCard: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, overflow: 'hidden', gap: Spacing.md, padding: Spacing.lg },
  previewImage: { height: 140, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  previewQuote: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22, fontStyle: 'italic', textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
