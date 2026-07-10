// Tempo — Welcome Experience (post-onboarding, before the app).
//
// The first thing a new user sees after their plan is generated: a branded reveal
// that proves Tempo built something FOR them. Plan facts reveal one card at a time.
// Reached only via the (tabs) gate (armed at onboarding success) — force-close-proof:
// reopening returns here until "Explore My Plan" completes it.

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, Redirect } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { TempoPulse } from '@/components/brand'
import { FadeInView, PopIn, PressableScale } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useTutorialStore } from '@/stores/tutorial'
import { T } from '@/lib/tutorial'
import * as haptics from '@/lib/haptics'

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build Muscle', fat_loss: 'Lose Fat', strength: 'Get Stronger',
  general_fitness: 'General Fitness', athletic: 'Athletic Performance',
}
const EXP_LABELS: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

function programName(goal: string | undefined, experience: string | undefined, days: number): string {
  if (experience === 'beginner') return 'Beginner Full Body'
  if (days <= 3) return `${GOAL_LABELS[goal ?? ''] ?? 'Fitness'} — Full Body`
  if (days === 4) return `${GOAL_LABELS[goal ?? ''] ?? 'Fitness'} — Upper / Lower`
  return `${GOAL_LABELS[goal ?? ''] ?? 'Fitness'} — Push / Pull / Legs`
}

export default function WelcomeScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [firstWorkout, setFirstWorkout] = useState<{ focus: string; date: string; time: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { haptics.success() }, [])

  useEffect(() => {
    if (!userId) return
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    supabase
      .from('scheduled_workouts')
      .select('focus, planned_date, planned_start_time')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('planned_date', todayStr)
      .order('planned_date', { ascending: true })
      .order('planned_start_time', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setFirstWorkout({ focus: data.focus, date: data.planned_date, time: data.planned_start_time })
      })
      .then(() => setLoaded(true), () => setLoaded(true))
  }, [userId])

  if (!session) return <Redirect href="/sign-in" />

  const days = profile?.days_per_week ?? 3
  const finish = () => {
    haptics.tapMedium()
    useTutorialStore.getState().completeStep('welcome_done')
    router.replace('/(tabs)')
  }
  const skip = () => {
    useTutorialStore.getState().skip(T.welcome)
    router.replace('/(tabs)')
  }

  const whenLabel = (() => {
    if (!firstWorkout) return 'Coming up'
    const d = new Date(`${firstWorkout.date}T00:00:00`)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const dayWord = d.getTime() === today.getTime() ? 'Today'
      : d.getTime() === tomorrow.getTime() ? 'Tomorrow'
        : d.toLocaleDateString('en-US', { weekday: 'long' })
    const [h, m] = firstWorkout.time.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12
    return `${dayWord} ${h12}:${String(m).padStart(2, '0')} ${ampm}`
  })()

  const cards = [
    { icon: 'flag', label: 'Goal', value: GOAL_LABELS[profile?.goal ?? ''] ?? 'General Fitness' },
    { icon: 'calendar', label: 'Schedule', value: `${days} days / week · ${EXP_LABELS[profile?.experience ?? ''] ?? 'Beginner'}` },
    { icon: 'barbell', label: 'Program', value: programName(profile?.goal, profile?.experience, days) },
    { icon: 'time', label: 'First workout', value: firstWorkout ? `${firstWorkout.focus} · ${whenLabel}` : 'Coming up next' },
  ]

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <PopIn style={styles.pulseWrap}><TempoPulse size={40} /></PopIn>
        <FadeInView>
          <Text style={styles.eyebrow}>YOUR PLAN IS READY</Text>
          <Text style={styles.title}>Built around your goals, schedule, and equipment.</Text>
        </FadeInView>

        <View style={styles.cards}>
          {loaded ? cards.map((c, i) => (
            <FadeInView key={c.label} delay={120 + i * 130} style={styles.card}>
              <View style={styles.cardIcon}><Ionicons name={c.icon as any} size={18} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>{c.label.toUpperCase()}</Text>
                <Text style={styles.cardValue}>{c.value}</Text>
              </View>
            </FadeInView>
          )) : (
            <View style={styles.loadingWrap}><ActivityIndicator color={C.primary} /></View>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PressableScale style={styles.cta} onPress={finish}>
          <Text style={styles.ctaText}>Explore My Plan</Text>
          <Ionicons name="arrow-forward" size={18} color={C.onPrimary} />
        </PressableScale>
        <PressableScale style={styles.skip} onPress={skip} scaleTo={0.97}>
          <Text style={styles.skipText}>Skip the tour</Text>
        </PressableScale>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.xl, gap: Spacing.lg },
  pulseWrap: { alignItems: 'center', marginBottom: Spacing.sm },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary, letterSpacing: 0.8, textAlign: 'center' },
  title: { fontFamily: C.fontDisplay, fontSize: 26, color: C.text, letterSpacing: -0.4, lineHeight: 32, textAlign: 'center', marginTop: Spacing.xs },
  cards: { gap: Spacing.sm, marginTop: Spacing.md },
  loadingWrap: { paddingVertical: Spacing.xl, alignItems: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant,
    padding: Spacing.lg, ...CardShadow,
  },
  cardIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 10.5, color: C.outline, letterSpacing: 0.6 },
  cardValue: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.md, gap: Spacing.xs },
  cta: { height: 56, borderRadius: Radius.lg, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  skip: { alignItems: 'center', paddingVertical: Spacing.sm },
  skipText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
})
