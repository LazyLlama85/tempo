import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ThemedView } from '@/components/themed-view'
import { ThemedText } from '@/components/themed-text'
import { Colors, Spacing } from '@/constants/theme'
import { useColorScheme } from 'react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { generatePlan } from '@/lib/generatePlan'
import { requestPermissions, scheduleWorkoutReminders } from '@/lib/notifications'
import type { ScheduledWorkout } from '@/lib/notifications'
import type { Equipment, Experience, Goal } from '@/types'

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build Muscle',
  fat_loss: 'Lose Fat',
  strength: 'Get Stronger',
  general_fitness: 'General Fitness',
  athletic: 'Athletic Performance',
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
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light']
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary">Step 5 of 5</ThemedText>
          <ThemedText type="subtitle" style={styles.title}>Your plan is ready.</ThemedText>
          <ThemedText themeColor="textSecondary">Here's what we built for you.</ThemedText>
        </View>

        <View style={[styles.planCard, { backgroundColor: colors.backgroundElement }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">PROGRAM</ThemedText>
          <ThemedText type="subtitle" style={styles.programName}>{programName}</ThemedText>

          <View style={styles.divider} />

          <View style={styles.details}>
            <View style={styles.detailRow}>
              <ThemedText themeColor="textSecondary">Goal</ThemedText>
              <ThemedText type="smallBold">{GOAL_LABELS[goal ?? ''] ?? '—'}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText themeColor="textSecondary">Experience</ThemedText>
              <ThemedText type="smallBold" style={{ textTransform: 'capitalize' }}>{experience}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText themeColor="textSecondary">Days per week</ThemedText>
              <ThemedText type="smallBold">{days} days</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText themeColor="textSecondary">Duration</ThemedText>
              <ThemedText type="smallBold">~45 min / session</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText themeColor="textSecondary">Length</ThemedText>
              <ThemedText type="smallBold">4 weeks (then repeats)</ThemedText>
            </View>
          </View>
        </View>

        {status === 'generating' && (
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', fontSize: 14 }}>
            Building your plan…
          </ThemedText>
        )}
        <TouchableOpacity
          style={[styles.confirmButton, { opacity: status !== 'idle' ? 0.6 : 1 }]}
          onPress={handleConfirm}
          disabled={status !== 'idle'}
          activeOpacity={0.8}
        >
          {status !== 'idle' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <ThemedText type="smallBold" style={styles.confirmText}>Let's Go →</ThemedText>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  header: { gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 36 },
  planCard: {
    flex: 1,
    padding: Spacing.four,
    borderRadius: 16,
    gap: Spacing.three,
  },
  programName: { fontSize: 22, lineHeight: 30 },
  divider: { height: 1, backgroundColor: 'rgba(128,128,128,0.15)' },
  details: { gap: Spacing.two },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confirmButton: {
    backgroundColor: '#3B82F6',
    padding: Spacing.three,
    borderRadius: 14,
    alignItems: 'center',
  },
  confirmText: { color: '#FFFFFF' },
})
