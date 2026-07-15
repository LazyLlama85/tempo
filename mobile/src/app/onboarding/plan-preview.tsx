import { useEffect, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark, TempoPulse } from '@/components/brand'
import { FadeInView, PressableScale } from '@/components/motion'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useTutorialStore } from '@/stores/tutorial'
import { T } from '@/lib/tutorial'
import { track } from '@/lib/analytics'
import { generatePlan } from '@/lib/generatePlan'
import { autoScheduleUpcoming } from '@/lib/autoSchedule'
import { requestPermissions, scheduleWorkoutReminders, cancelAllReminders } from '@/lib/notifications'
import { registerPushToken } from '@/lib/pushTokens'
import { invalidateTrainingData } from '@/lib/queryInvalidation'
import { describeSaveError, isAuthError } from '@/lib/saveErrors'
import type { ScheduledWorkout } from '@/lib/notifications'

// Prime before the one-shot OS permission prompt: explain the value in our own
// words first, so the system dialog isn't the first thing the user sees. iOS only
// asks once — a reflex "Don't Allow" here would kill reminders AND every retention
// push forever, so this framing moment matters.
function askForReminders(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Get a nudge before each workout?',
      'Tempo reminds you 30 minutes before each scheduled session — on busy days that heads-up is most of the battle.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Remind me', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    )
  })
}
import type { Equipment, Experience, Goal } from '@/types'


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
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { goal, experience, equipment, daysPerWeek, preferredCalendar, schedulingMode } = useLocalSearchParams<{
    goal: string
    experience: string
    equipment: string
    daysPerWeek: string
    preferredCalendar?: string
    schedulingMode?: string
  }>()
  const { session, profile, refreshProfile } = useAuthStore()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'idle' | 'saving' | 'generating'>('idle')
  const confirmLatch = useRef(false)
  // Re-running onboarding from Profile → Change Plan: the account already exists,
  // so we must not clobber personal fields and shouldn't re-run the intro steps.
  const isReplan = !!profile?.onboarding_complete

  // While the plan generates, narrate what's actually happening — the wait
  // becomes the moment the coach proves it's working, not a dead spinner.
  const BUILD_STEPS = [
    'Reading your schedule…',
    'Choosing your lifts…',
    'Balancing your training week…',
    'Placing sessions around your day…',
  ]
  const [buildStep, setBuildStep] = useState(0)
  useEffect(() => {
    if (status !== 'generating') { setBuildStep(0); return }
    const t = setInterval(() => setBuildStep(s => (s + 1) % BUILD_STEPS.length), 1400)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  if (!session) return <Redirect href="/sign-in" />

  const days = parseInt(daysPerWeek ?? '3', 10)
  const equipmentList = (equipment ?? '').split(',').filter(Boolean) as Equipment[]
  const programName = getProgramName(goal ?? '', experience ?? '', days)

  const handleConfirm = async (attempt = 0) => {
    // Ref latch, not state: two taps in the same frame both read status==='idle'
    // (setState hasn't committed), so state alone can run the save+generate chain
    // twice concurrently. attempt > 0 is our own silent retry — already latched.
    if (attempt === 0) {
      if (confirmLatch.current || status !== 'idle') return
      confirmLatch.current = true
    }
    setStatus('saving')
    try {
      // Make sure the auth token is fresh before the write chain — after a long
      // background stint the first request can otherwise fire with an expired JWT.
      try { await supabase.auth.getSession() } catch { /* the writes will surface it */ }

      const { error: profileErr } = await supabase.from('user_profiles').upsert({
        user_id: session.user.id,
        goal: goal as Goal,
        experience: experience as Experience,
        equipment: equipmentList,
        days_per_week: days,
        preferred_duration_min: profile?.preferred_duration_min ?? 45,
        // onboarding_complete is deliberately NOT set here — it flips below, after
        // generatePlan succeeds. Setting it first meant a mid-chain failure + force
        // quit produced an "onboarded" account with no plan at next launch.
        // Connecting a calendar doesn't force auto — persist the user's choice.
        scheduling_mode: schedulingMode === 'manual' ? 'manual' : 'auto',
        // Persist the calendar the user connected during onboarding as the default
        // sync target (only when it's a known provider).
        ...(preferredCalendar === 'google' || preferredCalendar === 'device'
          ? { preferred_calendar: preferredCalendar }
          : {}),
        // Seed name/avatar from the sign-in identity ONLY while they're unset —
        // a plan change must never overwrite what the user picked in their profile.
        ...(profile?.display_name
          ? {}
          : { display_name: session.user.user_metadata?.full_name ?? null }),
        ...(profile?.avatar_url
          ? {}
          : { avatar_url: session.user.user_metadata?.avatar_url ?? null }),
      })
      if (profileErr) throw profileErr

      setStatus('generating')
      await generatePlan(supabase, session.user.id, {
        goal: goal as Goal,
        experience: experience as Experience,
        equipment: equipmentList,
        days_per_week: days,
        preferred_duration_min: profile?.preferred_duration_min ?? 45,
      })

      // The plan exists — NOW the account counts as onboarded. (On a re-plan this
      // is already true; the update is a harmless no-op.)
      const { error: completeErr } = await supabase
        .from('user_profiles')
        .update({ onboarding_complete: true })
        .eq('user_id', session.user.id)
      if (completeErr) throw completeErr

      // In auto mode, place those workouts at real, calendar-aware times around the
      // calendar the user just connected. In manual mode the user owns the times, so
      // we leave the curated template times. (autoScheduleUpcoming also self-guards on
      // scheduling_mode; this just skips the work entirely.) Best-effort either way.
      if (schedulingMode !== 'manual') {
        try { await autoScheduleUpcoming(supabase, session.user.id) } catch { /* keep template times */ }
      }

      // Schedule reminders — best-effort, never blocks onboarding. Primed ask
      // first, then the OS prompt; on grant, also register this device for the
      // server-driven retention pushes (sign-in no longer prompts for this).
      // On a re-plan we skip the ask (they answered it once) and just re-point
      // reminders at the new sessions if permission is already there.
      try {
        const granted = isReplan
          ? await requestPermissions()
          : (await askForReminders()) && (await requestPermissions())
        if (granted) {
          registerPushToken(supabase, session.user.id).catch(() => {})
          // Clear any reminders tied to the previous plan's (now-retired) workout
          // IDs first, so re-generating a plan can't leave stale notifications
          // firing for sessions that no longer exist.
          await cancelAllReminders()
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

      track('onboarding_complete', {
        goal: goal ?? '',
        experience: experience ?? '',
        days_per_week: days,
      })

      await refreshProfile().catch(() => {}) // plan is saved — a refresh blip can't unsave it
      // Every cached training query still shows the old plan — flush them so the
      // tabs paint the new schedule immediately.
      invalidateTrainingData(queryClient)

      if (isReplan) {
        // Existing user changing plans: straight back into the app (pop the whole
        // onboarding stack so back-swipe can't land on a stale step). Re-planners
        // are NOT armed for the first-run tutorials — they've seen the app.
        if (router.canDismiss()) router.dismissAll()
        router.replace('/(tabs)')
      } else {
        // Brand-new user: arm the first-run tutorials at this deterministic moment
        // (the only place they're ever armed, so existing users never see them).
        // The (tabs) gate then routes through /welcome after profile-setup.
        const tut = useTutorialStore.getState()
        tut.init(session.user.id)
        tut.arm(T.welcome); tut.arm(T.homeTour); tut.arm(T.firstWorkout)
        tut.setFirstPlanCreated()
        // Finish with a quick "make it yours" profile step before entering the app.
        router.replace('/onboarding/profile-setup')
      }
    } catch (err) {
      // An expired session refreshes in one call — do that and retry silently once
      // before involving the user.
      if (attempt === 0 && isAuthError(err)) {
        try {
          await supabase.auth.refreshSession()
          return handleConfirm(1)
        } catch { /* fall through to the alert */ }
      }
      confirmLatch.current = false
      setStatus('idle')
      const info = describeSaveError(err, 'save your plan')
      Alert.alert(info.title, info.message, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Try Again', onPress: () => handleConfirm() },
      ])
    }
  }

  const busy = status !== 'idle'
  const sessionMin = profile?.preferred_duration_min ?? 45

  const DETAILS = [
    { label: 'Goal', value: GOAL_LABELS[goal ?? ''] ?? '—' },
    { label: 'Experience', value: EXP_LABELS[experience ?? ''] ?? '—' },
    { label: 'Days per week', value: `${days} days` },
    { label: 'Duration', value: `~${sessionMin} min / session` },
    { label: 'Length', value: '4 weeks (then repeats)' },
  ]

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back" disabled={busy}>
          <Ionicons name="arrow-back" size={22} color={busy ? C.outlineVariant : C.text} />
        </TouchableOpacity>
        <TempoWordmark size={16} />
        <View style={{ width: 38 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '100%' }]} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <FadeInView>
          <Text style={styles.stepLabel}>{isReplan ? 'NEW PLAN' : 'STEP 4 OF 4'}</Text>
          <Text style={styles.title}>{isReplan ? 'Your new plan is ready.' : "Here's your plan."}</Text>
          <Text style={styles.subtitle}>
            {isReplan ? 'This replaces your current plan — history and PRs stay.' : "Take a look, then we'll build it and set up your week."}
          </Text>
        </FadeInView>

        <FadeInView delay={100} style={styles.planCard}>
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
        </FadeInView>

        {/* Reinforce the core promise right at the finish line */}
        <FadeInView delay={200} style={styles.adaptNote}>
          <Ionicons name="sparkles" size={16} color={C.primary} style={{ marginTop: 1 }} />
          <Text style={styles.adaptNoteText}>
            This is a starting point, not a contract. Tempo reshapes it around your real
            schedule — and when life gets busy, a Quick Workout keeps you moving.
          </Text>
        </FadeInView>
      </ScrollView>

      <View style={styles.footer}>
        {status === 'generating' && (
          <View style={styles.buildingRow}>
            <TempoPulse size={18} />
            <Text style={styles.buildingText}>{BUILD_STEPS[buildStep]}</Text>
          </View>
        )}
        <PressableScale
          style={[styles.confirmBtn, busy && { opacity: 0.6 }]}
          onPress={() => handleConfirm()}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <Text style={styles.confirmText}>{isReplan ? 'Switch to This Plan →' : "Let's Go →"}</Text>
          )}
        </PressableScale>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  logo: { fontFamily: C.fontDisplay, fontSize: 15, color: C.primary, letterSpacing: 2 },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  planCard: {
    backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1, gap: Spacing.sm, marginTop: Spacing.xs,
  },
  programEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  programName: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3, marginTop: -2 },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginVertical: Spacing.xs },
  details: { gap: Spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary },
  detailValue: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  adaptNote: { flexDirection: 'row', gap: 8, backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md },
  adaptNoteText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xs },
  buildingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: 4 },
  buildingText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary, textAlign: 'center' },
  confirmBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
