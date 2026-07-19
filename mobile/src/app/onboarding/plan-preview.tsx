import { useEffect, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark, TempoPulse } from '@/components/brand'
import { FadeInView, PressableScale } from '@/components/motion'
import { SvgProgressRing } from '@/components/SvgProgressRing'
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
import { formatTime12 } from '@/components/TimePickerSheet'
import type { ScheduledWorkout } from '@/lib/notifications'
import { connectGoogleCalendar, isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { requestCalendarPermissions, getCalendarPermissionStatus } from '@/services/calendarService'
import { friendlyConnectError } from '@/services/googleCalendar/connectErrors'
import { trackCalendarConnected } from '@/lib/activation'
import { syncUpcomingWorkouts } from '@/lib/calendarAutoSync'
import * as haptics from '@/lib/haptics'

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

const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

interface RevealWorkout {
  id: string
  focus: string
  planned_date: string
  planned_start_time: string
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
  const { goal, experience, equipment, daysPerWeek, preferredCalendar, schedulingMode, sessionMinutes, buildMode, includeCardio } = useLocalSearchParams<{
    goal: string
    experience: string
    equipment: string
    daysPerWeek: string
    preferredCalendar?: string
    schedulingMode?: string
    sessionMinutes?: string
    buildMode?: string
    includeCardio?: string
  }>()
  const wantsCardio = includeCardio === 'true'
  // "I'll build my own" (Phase 7d): Tempo still saves goal/experience/equipment/
  // schedule (they're used everywhere else — Quick Workout, substitutions, the
  // free-slot engine), but skips plan GENERATION entirely and drops the user into
  // split-editor instead of a generated week. Free for everyone, not a Pro gate.
  const isCustomBuild = buildMode === 'custom'
  const { session, profile, refreshProfile } = useAuthStore()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'idle' | 'saving' | 'generating' | 'revealing'>('idle')
  // B3.3 — the onboarding aha: the real week ahead, animating into place, instead
  // of an instant jump into the app. Best-effort fetch; a failure just skips the
  // reveal and goes straight in, same as before this batch.
  const [revealWorkouts, setRevealWorkouts] = useState<RevealWorkout[]>([])
  const confirmLatch = useRef(false)
  // Re-running onboarding from Profile → Change Plan: the account already exists,
  // so we must not clobber personal fields and shouldn't re-run the intro steps.
  const isReplan = !!profile?.onboarding_complete

  // The optional calendar tap-in at the reveal (audit §05's prescribed fix): only
  // offered to a brand-new user with NOTHING connected yet. 'checking' renders the
  // same honest copy as 'none' — never block the reveal on this lookup.
  const [calState, setCalState] = useState<'checking' | 'connected' | 'none'>('checking')
  const [calBusy, setCalBusy] = useState<null | 'google' | 'device'>(null)
  const [calError, setCalError] = useState<string | null>(null)
  // Tracks whether the tap-in card was ever actually shown, so 'skipped' only
  // fires for someone who genuinely saw the offer and didn't take it — not for
  // isReplan/isCustomBuild/already-connected users who never saw a card at all.
  const calPromptShown = useRef(false)
  const calConnectedThisSession = useRef(false)

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
  // B3.3 — the time-budget question, answered on schedule.tsx. Falls back to the
  // saved profile value (Change Plan re-entry without re-answering) then 45.
  const sessionMin = sessionMinutes ? parseInt(sessionMinutes, 10) : (profile?.preferred_duration_min ?? 45)

  // The next 7 days' real, saved schedule — used to build the reveal, and
  // re-fetched after a successful calendar tap-in so the list reflects any times
  // autoScheduleUpcoming just moved around the newly-visible busy blocks.
  const fetchRevealWorkouts = async (): Promise<RevealWorkout[]> => {
    if (!session) return []
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 6)
    const { data } = await supabase
      .from('scheduled_workouts')
      .select('id, focus, planned_date, planned_start_time')
      .eq('user_id', session.user.id)
      .eq('status', 'scheduled')
      .gte('planned_date', toDateStr(today))
      .lte('planned_date', toDateStr(weekEnd))
      .order('planned_date')
    return (data ?? []) as RevealWorkout[]
  }

  const handleConfirm = async (attempt = 0) => {
    // Ref latch, not state: two taps in the same frame both read status==='idle'
    // (setState hasn't committed), so state alone can run the save+generate chain
    // twice concurrently. attempt > 0 is our own silent retry — already latched.
    if (attempt === 0) {
      if (confirmLatch.current || status !== 'idle') return
      confirmLatch.current = true
      track('onboarding_step_completed', { step: 'plan_confirmed' })
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
        preferred_duration_min: sessionMin,
        include_cardio: wantsCardio,
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

      // Custom-build users skip generation entirely — there is no plan to build,
      // by their own explicit choice. Everything else (profile fields, reminders,
      // tutorials) still happens so the rest of the app behaves identically to any
      // other onboarded account with no plan/split yet (an already-supported state).
      if (!isCustomBuild) {
        setStatus('generating')
        await generatePlan(supabase, session.user.id, {
          goal: goal as Goal,
          experience: experience as Experience,
          equipment: equipmentList,
          days_per_week: days,
          preferred_duration_min: sessionMin,
          include_cardio: wantsCardio,
        })
      }

      // The plan exists (or the user chose not to have one yet) — NOW the account
      // counts as onboarded. (On a re-plan this is already true; harmless no-op.)
      const { error: completeErr } = await supabase
        .from('user_profiles')
        .update({ onboarding_complete: true })
        .eq('user_id', session.user.id)
      if (completeErr) throw completeErr

      // In auto mode, place those workouts at real, calendar-aware times around the
      // calendar the user just connected. In manual mode the user owns the times, so
      // we leave the curated template times. (autoScheduleUpcoming also self-guards on
      // scheduling_mode; this just skips the work entirely.) Best-effort either way.
      // Nothing to place yet for a custom build — it self-guards on there being no
      // scheduled rows, but skip the call outright since we know there's nothing.
      if (!isCustomBuild && schedulingMode !== 'manual') {
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

      // Brand-new user: arm the first-run tutorials at this deterministic moment
      // (the only place they're ever armed, so existing users never see them) —
      // done here, BEFORE the reveal below, so a force-close during the reveal
      // still leaves the account correctly set up. The reveal you're about to see
      // (below) IS the welcome moment now — there's no separate /welcome screen to
      // force-close out of (removed 2026-07-17: it repeated the same plan facts this
      // reveal already shows). 'welcome_done' is a gate several other screens check
      // before their own first-run tours fire (Home/Plan spotlight tours, the
      // Concepts tour) — mark it satisfied right here, atomically with the other
      // arms, so it can never get stuck false. Re-planners are NOT armed — they've
      // seen the app.
      if (!isReplan) {
        const tut = useTutorialStore.getState()
        tut.init(session.user.id)
        tut.arm(T.homeTour); tut.arm(T.firstWorkout); tut.arm(T.planTour); tut.arm(T.conceptsTour)
        tut.completeStep('welcome_done')
        tut.setFirstPlanCreated()
      }

      // The onboarding aha (B3.3): fetch the real week ahead and animate it into
      // place instead of jumping straight into the app. Best-effort AND honest —
      // any failure, or a genuinely empty week, just skips straight to entering
      // the app (exactly the old behavior) rather than show a misleading
      // all-rest-days screen right after generating a plan. Custom-build users have
      // no generated week by definition — skip straight to entering.
      if (isCustomBuild) { enterApp(); return }
      try {
        const upcoming = await fetchRevealWorkouts()
        if (upcoming.length > 0) {
          setRevealWorkouts(upcoming)
          setStatus('revealing')
          return
        }
      } catch {
        // Cosmetic only — fall through to entering the app either way
      }
      enterApp()
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

  // Called from the reveal's Continue button — the exact same destinations
  // handleConfirm used to navigate to immediately; only the timing moved.
  const enterApp = () => {
    if (calPromptShown.current && !calConnectedThisSession.current) {
      track('onboarding_calendar_prompt', { action: 'skipped' })
    }
    if (isReplan) {
      // Pop the whole onboarding stack so back-swipe can't land on a stale step.
      if (router.canDismiss()) router.dismissAll()
      router.replace('/(tabs)')
    } else {
      // Tutorials were already armed in handleConfirm, before the reveal.
      // Forward buildMode so profile-setup knows whether to drop a custom-build
      // user into split-editor instead of the (empty, but perfectly valid) tabs.
      router.replace({ pathname: '/onboarding/profile-setup', params: { buildMode: buildMode ?? '' } })
    }
  }

  // Check connection state once the reveal is showing (never before — don't slow
  // the confirm chain on this). isReplan/isCustomBuild users never see the tap-in
  // card at all, so skip the check entirely for them (calState stays 'checking',
  // which is harmless since the card's render condition already excludes them).
  useEffect(() => {
    if (status !== 'revealing' || isReplan || isCustomBuild) return
    let cancelled = false
    Promise.all([
      isGoogleCalendarConnected().catch(() => false),
      getCalendarPermissionStatus().catch(() => 'undetermined' as const),
    ]).then(([google, device]) => {
      if (cancelled) return
      setCalState(google || device === 'granted' ? 'connected' : 'none')
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Record (once) that the tap-in card was genuinely shown, for honest 'skipped'
  // analytics — never during render itself (impure), so a separate effect.
  useEffect(() => {
    if (status === 'revealing' && calState === 'none' && !isReplan) calPromptShown.current = true
  }, [status, calState, isReplan])

  // Same post-connect sequence calendar-setup.tsx uses (preferred_calendar,
  // refreshProfile, best-effort auto-sync) — reused, not reinvented — plus a
  // re-fetch of the reveal list so a successful connect visibly re-places times
  // around the now-visible busy blocks.
  const afterCalendarConnected = async (provider: 'google' | 'device') => {
    if (!session) return
    trackCalendarConnected(session.user.id, provider)
    try {
      await supabase.from('user_profiles').update({ preferred_calendar: provider }).eq('user_id', session.user.id)
      await refreshProfile()
    } catch { /* best-effort — the connection still works without the default set */ }
    try { await autoScheduleUpcoming(supabase, session.user.id) } catch { /* keep current times */ }
    syncUpcomingWorkouts(supabase, session.user.id, { ...(profile as any), preferred_calendar: provider }).catch(() => {})
    try {
      const upcoming = await fetchRevealWorkouts()
      if (upcoming.length > 0) setRevealWorkouts(upcoming)
    } catch { /* reveal list just keeps its pre-connect times */ }
    calConnectedThisSession.current = true
    haptics.success()
    setCalState('connected')
  }

  const handleConnectGoogleAtReveal = async () => {
    if (calBusy) return
    setCalBusy('google')
    setCalError(null)
    const r = await connectGoogleCalendar()
    setCalBusy(null)
    if (r.ok) {
      track('onboarding_calendar_prompt', { action: 'connected_google' })
      await afterCalendarConnected('google')
    } else {
      track('onboarding_calendar_prompt', { action: 'failed' })
      setCalError(friendlyConnectError(r.error))
    }
  }

  const handleConnectDeviceAtReveal = async () => {
    if (calBusy) return
    setCalBusy('device')
    setCalError(null)
    const granted = await requestCalendarPermissions()
    setCalBusy(null)
    if (granted) {
      track('onboarding_calendar_prompt', { action: 'connected_device' })
      await afterCalendarConnected('device')
    } else {
      track('onboarding_calendar_prompt', { action: 'failed' })
      setCalError('You can allow calendar access later in Settings.')
    }
  }

  const busy = status !== 'idle'

  // The next 7 days (today first), each with any real workout(s) Tempo placed —
  // the data behind the reveal animation below.
  const revealDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i)
    const dateStr = toDateStr(d)
    return { date: d, dateStr, workouts: revealWorkouts.filter(w => w.planned_date === dateStr) }
  })

  const DETAILS = [
    { label: 'Goal', value: GOAL_LABELS[goal ?? ''] ?? '—' },
    { label: 'Experience', value: EXP_LABELS[experience ?? ''] ?? '—' },
    { label: 'Days per week', value: `${days} days` },
    { label: 'Duration', value: `~${sessionMin} min / session` },
    ...(wantsCardio ? [{ label: 'Cardio finisher', value: 'Included' }] : []),
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

      {status === 'generating' ? (
        // A real, dedicated "personalizing your plan" screen (founder ask) — was
        // just a footer text row before, which read as "stuck" on a slow chain
        // (profile save → generate → auto-schedule → reminders, all real network
        // round-trips). The ring's value tracks BUILD_STEPS' progress through that
        // chain — not fake, each step really is a phase of it — so it never looks
        // frozen even on a slow connection.
        <View style={styles.generatingWrap}>
          <SvgProgressRing
            value={((buildStep + 1) / BUILD_STEPS.length) * 100}
            size={180}
            stroke={12}
            gradientFrom={C.primary}
            gradientTo={C.primary}
          >
            <TempoPulse size={22} />
          </SvgProgressRing>
          {/* isCustomBuild never reaches 'generating' — it skips generatePlan entirely */}
          <Text style={styles.generatingTitle}>Personalizing your plan…</Text>
          <FadeInView key={buildStep} duration={220}>
            <Text style={styles.generatingStep}>{BUILD_STEPS[buildStep]}</Text>
          </FadeInView>
        </View>
      ) : status === 'revealing' ? (
        // The onboarding aha (B3.3): the REAL week Tempo just built, dropping into
        // place one day at a time — the payoff, with the lights on, not a mockup.
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <FadeInView>
            <Text style={styles.stepLabel}>YOUR WEEK</Text>
            <Text style={styles.title}>{calState === 'connected' ? 'Already on your calendar.' : 'Your first week, planned.'}</Text>
            <Text style={styles.subtitle}>
              {calState === 'connected'
                ? 'Tempo placed every session below — the what and the when, decided for you.'
                : 'Tempo schedules every session around your real life — sleep, work, and (when you connect one) your actual calendar.'}
            </Text>
          </FadeInView>
          <View style={styles.revealList}>
            {revealDays.map((day, i) => (
              <FadeInView key={day.dateStr} delay={120 + i * 90} style={styles.revealRow}>
                <View style={styles.revealDateCol}>
                  <Text style={styles.revealWeekday}>{WEEKDAY_LABELS[day.date.getDay()]}</Text>
                  <Text style={styles.revealDateNum}>{day.date.getDate()}</Text>
                </View>
                {day.workouts.length > 0 ? (
                  <View style={styles.revealWorkoutCard}>
                    <Ionicons name="barbell" size={16} color={C.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.revealWorkoutTitle}>{day.workouts[0].focus}</Text>
                      <Text style={styles.revealWorkoutTime}>{formatTime12(day.workouts[0].planned_start_time)}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.revealRestCard}>
                    <Text style={styles.revealRestText}>Rest day</Text>
                  </View>
                )}
              </FadeInView>
            ))}
          </View>

          {/* Optional, skippable calendar tap-in — the audit's own prescribed fix:
              "a low-friction 'want us to fit this into your calendar?' moment right
              after the plan appears." Never blocks "Enter Tempo →" below. */}
          {!isReplan && calState === 'none' && (
            <FadeInView delay={120 + revealDays.length * 90} style={styles.calCard}>
              <View style={styles.calCardHeader}>
                <View style={styles.calIcon}><Ionicons name="calendar-outline" size={18} color={C.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.calCardTitle}>See it with your real calendar</Text>
                  <Text style={styles.calCardSub}>Tempo reads busy times only — event details never leave your phone.</Text>
                </View>
              </View>
              {calError && <Text style={styles.calError}>{calError}</Text>}
              <View style={styles.calBtnRow}>
                <PressableScale
                  style={[styles.calBtnPrimary, calBusy && { opacity: 0.6 }]}
                  onPress={handleConnectGoogleAtReveal}
                  disabled={!!calBusy}
                >
                  {calBusy === 'google' ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.calBtnPrimaryText}>Connect Google Calendar</Text>}
                </PressableScale>
                <TouchableOpacity onPress={handleConnectDeviceAtReveal} disabled={!!calBusy} hitSlop={8}>
                  {calBusy === 'device' ? <ActivityIndicator color={C.primary} /> : <Text style={styles.calBtnSecondaryText}>Use device calendar</Text>}
                </TouchableOpacity>
              </View>
            </FadeInView>
          )}
          {!isReplan && calState === 'connected' && calConnectedThisSession.current && (
            <FadeInView style={styles.calSuccessRow}>
              <Ionicons name="checkmark-circle" size={18} color={C.success} />
              <Text style={styles.calSuccessText}>Scheduled around your calendar</Text>
            </FadeInView>
          )}
        </ScrollView>
      ) : (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <FadeInView>
          <Text style={styles.stepLabel}>{isReplan ? 'NEW PLAN' : 'STEP 6 OF 6'}</Text>
          <Text style={styles.title}>
            {isCustomBuild ? "You're all set." : isReplan ? 'Your new plan is ready.' : "Here's your plan."}
          </Text>
          <Text style={styles.subtitle}>
            {isCustomBuild
              ? "No generated plan — you're building your own. Tempo still schedules whatever you create around your real day."
              : isReplan ? 'This replaces your current plan — history and PRs stay.' : "Take a look, then we'll build it and set up your week."}
          </Text>
        </FadeInView>

        {isCustomBuild ? (
          <FadeInView delay={100} style={styles.planCard}>
            <Text style={styles.programEyebrow}>YOUR SETUP</Text>
            <Text style={styles.programName}>Build your own</Text>
            <View style={styles.divider} />
            <View style={styles.details}>
              {DETAILS.slice(0, 4).map((d) => (
                <View key={d.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{d.label}</Text>
                  <Text style={styles.detailValue}>{d.value}</Text>
                </View>
              ))}
            </View>
          </FadeInView>
        ) : (
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
        )}

        {/* Reinforce the core promise right at the finish line */}
        <FadeInView delay={200} style={styles.adaptNote}>
          <Ionicons name="sparkles" size={16} color={C.primary} style={{ marginTop: 1 }} />
          <Text style={styles.adaptNoteText}>
            {isCustomBuild
              ? "Next you'll add a name and photo, then land straight in the split builder to create your first workout."
              : 'This is a starting point, not a contract. Tempo reshapes it around your real schedule — and when life gets busy, a Quick Workout keeps you moving.'}
          </Text>
        </FadeInView>
      </ScrollView>
      )}

      {status !== 'generating' && (
      <View style={styles.footer}>
        {status === 'revealing' ? (
          <PressableScale style={styles.confirmBtn} onPress={enterApp} activeOpacity={0.85}>
            <Text style={styles.confirmText}>Enter Tempo →</Text>
          </PressableScale>
        ) : (
        <PressableScale
          style={[styles.confirmBtn, busy && { opacity: 0.6 }]}
          onPress={() => handleConfirm()}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <Text style={styles.confirmText}>
              {isReplan ? 'Switch to This Plan →' : isCustomBuild ? 'Continue →' : "Let's Go →"}
            </Text>
          )}
        </PressableScale>
        )}
      </View>
      )}
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
  generatingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.xl },
  generatingTitle: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.2 },
  generatingStep: { fontFamily: 'Inter_500Medium', fontSize: 14.5, color: C.textSecondary, textAlign: 'center' },
  confirmBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  // ── Onboarding aha reveal (B3.3) ──────────────────────────────────────────
  revealList: { gap: Spacing.sm, marginTop: Spacing.sm },
  revealRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  revealDateCol: { width: 44, alignItems: 'center' },
  revealWeekday: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.4 },
  revealDateNum: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, marginTop: 1 },
  revealWorkoutCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: C.primaryLine,
  },
  revealWorkoutTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  revealWorkoutTime: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  revealRestCard: {
    flex: 1, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: C.outlineVariant, borderStyle: 'dashed',
  },
  revealRestText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  // ── Optional calendar tap-in at the reveal ──────────────────────────────────
  calCard: {
    marginTop: Spacing.lg, backgroundColor: C.background, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.lg, gap: Spacing.md, ...Elevation.e1,
  },
  calCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  calIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  calCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  calCardSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 2, lineHeight: 17 },
  calError: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.error, lineHeight: 17 },
  calBtnRow: { gap: Spacing.sm, alignItems: 'center' },
  calBtnPrimary: {
    width: '100%', height: 48, backgroundColor: C.primary, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
  calBtnPrimaryText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.onPrimary },
  calBtnSecondaryText: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.primary, paddingVertical: Spacing.xs },
  calSuccessRow: {
    marginTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md,
  },
  calSuccessText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
})
