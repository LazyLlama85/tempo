import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { generatePlan } from '@/lib/generatePlan'
import { requestPermissions, scheduleWorkoutReminders } from '@/lib/notifications'
import type { ScheduledWorkout } from '@/lib/notifications'
import type { Equipment, Experience, Goal } from '@/types'

const C = Colors.light

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build Muscle',
  fat_loss: 'Lose Fat',
  strength: 'Get Stronger',
  general_fitness: 'General Fitness',
  athletic: 'Athletic Performance',
}

const EXP_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

// Returns a human-readable program name based on inputs
function getProgramName(goal: string, experience: string, days: number): string {
  if (experience === 'beginner') return `Beginner Full Body (${days}x/week)`
  if (days <= 3) return `${GOAL_LABELS[goal]} — Full Body`
  return `${GOAL_LABELS[goal]} — Upper/Lower Split`
}

export default function PlanPreviewScreen() {
  const router = useRouter()
  const { goal, experience, equipment, daysPerWeek } = useLocalSearchParams<{
    goal: string
    experience: string
    equipment: string
    daysPerWeek: string
  }>()
  const { session, refreshProfile } = useAuthStore()
  const [status, setStatus] = useState<'idle' | 'saving' | 'generating'>('idle')

  if (!session) return <Redirect href="/sign-in" />

  const days = parseInt(daysPerWeek ?? '3', 10)
  const equipmentList = (equipment ?? '').split(',').filter(Boolean) as Equipment[]
  const programName = getProgramName(goal ?? '', experience ?? '', days)

  const handleConfirm = async () => {
    setStatus('saving')
    try {
      const { error: profileErr } = await supabase.from('user_profiles').upsert({
        user_id: session.user.id,
        display_name: session.user.user_metadata?.full_name ?? null,
        avatar_url: session.user.user_metadata?.avatar_url ?? null,
        goal: goal as Goal,
        experience: experience as Experience,
        equipment: equipmentList,
        days_per_week: days,
        preferred_duration_min: 45,
        onboarding_complete: true,
      })
      if (profileErr) throw profileErr

      setStatus('generating')
      await generatePlan(supabase, session.user.id, {
        goal: goal as Goal,
        experience: experience as Experience,
        equipment: equipmentList,
        days_per_week: days,
        preferred_duration_min: 45,
      })

      // Schedule reminders — best-effort, never blocks onboarding
      try {
        const granted = await requestPermissions()
        if (granted) {
          const { data: workouts } = await supabase
            .from('scheduled_workouts')
            .select('id, focus, planned_date, planned_start_time, planned_duration_min, status')
            .eq('user_id', session.user.id)
            .eq('status', 'scheduled')
          await scheduleWorkoutReminders((workouts ?? []) as ScheduledWorkout[])
        }
      } catch {
        // Notification errors must not block the user from entering the app
      }

      await refreshProfile()
      router.replace('/(tabs)')
    } catch (err) {
      setStatus('idle')
      Alert.alert(
        'Something went wrong',
        err instanceof Error ? err.message : 'Please try again.',
        [{ text: 'Retry', onPress: handleConfirm }]
      )
    }
  }

  const busy = status !== 'idle'

  const DETAILS = [
    { label: 'Goal', value: GOAL_LABELS[goal ?? ''] ?? '—' },
    { label: 'Experience', value: EXP_LABELS[experience ?? ''] ?? '—' },
    { label: 'Days per week', value: `${days} days` },
    { label: 'Duration', value: '~45 min / session' },
    { label: 'Length', value: '4 weeks (then repeats)' },
  ]

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} disabled={busy}>
          <Ionicons name="arrow-back" size={22} color={busy ? C.outlineVariant : C.text} />
        </TouchableOpacity>
        <Text style={styles.logo}>TEMPO</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '100%' }]} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 5 OF 5</Text>
        <Text style={styles.title}>Your plan is ready.</Text>
        <Text style={styles.subtitle}>Here's what we built for you.</Text>

        <View style={styles.planCard}>
          <Text style={styles.programEyebrow}>PROGRAM</Text>
          <Text style={styles.programName}>{programName}</Text>
          <View style={styles.divider} />
          <View style={styles.details}>
            {DETAILS.map((d) => (
              <View key={d.label} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{d.label}</Text>
                <Text style={styles.detailValue}>{d.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Reinforce the core promise right at the finish line */}
        <View style={styles.adaptNote}>
          <Ionicons name="sparkles" size={16} color={C.primary} style={{ marginTop: 1 }} />
          <Text style={styles.adaptNoteText}>
            This is a starting point, not a contract. Tempo reshapes it around your real
            schedule — and when life gets busy, a Quick Workout keeps you moving.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {status === 'generating' && (
          <Text style={styles.buildingText}>Building your plan…</Text>
        )}
        <TouchableOpacity
          style={[styles.confirmBtn, busy && { opacity: 0.6 }]}
          onPress={handleConfirm}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <Text style={styles.confirmText}>Let's Go →</Text>
          )}
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
  planCard: {
    backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: Spacing.sm, marginTop: Spacing.xs,
  },
  programEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  programName: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.3, marginTop: -2 },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginVertical: Spacing.xs },
  details: { gap: Spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary },
  detailValue: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  adaptNote: { flexDirection: 'row', gap: 8, backgroundColor: '#EFF4FF', borderRadius: Radius.lg, padding: Spacing.md },
  adaptNoteText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xs },
  buildingText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center' },
  confirmBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
