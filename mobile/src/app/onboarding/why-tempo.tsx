// Tempo — "Why Tempo" onboarding differentiator (2026-07-18).
//
// Sits between Basics and Schedule — before any more data-collection questions,
// while attention is highest. Not a form: it's the one screen whose entire job
// is making sure a new user understands what makes Tempo different BEFORE they
// answer five more questions about their week. Most fitness apps log workouts;
// Tempo schedules them, around a real calendar. This screen says that plainly,
// shows it with a small hand-built animation (no Lottie — same house style as
// SvgProgressRing/TempoPulse), and offers the same optional calendar connect the
// plan-preview reveal offers later — reused, not reinvented, via the same
// services/googleCalendar + services/calendarService calls. Skippable, like
// every other onboarding step; connecting here just means the LATER reveal never
// has to ask again (plan-preview's own tap-in only renders when still
// unconnected).
//
// No `user_profiles` row is guaranteed to exist yet at this point in onboarding
// (train-time.tsx does the first upsert) — so this screen never writes
// `preferred_calendar` itself. It forwards the chosen provider through the same
// params chain every other onboarding answer already rides (schedule → sleep →
// work-school → train-time → plan-preview), and plan-preview's existing upsert
// (which already reads a `preferredCalendar` param) persists it.

import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, TouchableOpacity, View, Text, ActivityIndicator } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale, FadeInView, useReducedMotion } from '@/components/motion'
import { track } from '@/lib/analytics'
import { connectGoogleCalendar, isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { requestCalendarPermissions, getCalendarPermissionStatus } from '@/services/calendarService'
import { friendlyConnectError } from '@/services/googleCalendar/connectErrors'
import { trackCalendarConnected } from '@/lib/activation'
import { useAuthStore } from '@/stores/auth'
import * as haptics from '@/lib/haptics'

const TOTAL_STEPS = 7

// A day with two real commitments and a workout that finds the gap between them
// — the whole pitch in one glance. Entrance-only (plays once on mount); follows
// motion.tsx's hard rule: values start at their RESTING pose, dip to hidden only
// in the same synchronous tick the animation starts, and a JS deadline force-
// snaps to rest if the native driver ever stalls — so this can never end up
// stuck invisible.
function ScheduleAnimation() {
  const C = useTheme()
  const reduce = useReducedMotion()
  const slideY = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (reduce) return
    slideY.setValue(-24)
    fade.setValue(0)
    const anim = Animated.parallel([
      Animated.spring(slideY, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 6 }),
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
    ])
    anim.start()
    const t = setTimeout(() => { slideY.setValue(0); fade.setValue(1) }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce])

  const styles = makeAnimStyles(C)
  return (
    <View style={styles.track}>
      <View style={styles.busyBlock}>
        <Ionicons name="briefcase-outline" size={14} color={C.textSecondary} />
        <Text style={styles.busyText}>Meeting · 9:00</Text>
      </View>
      <Animated.View style={[styles.workoutBlock, { opacity: fade, transform: [{ translateY: slideY }] }]}>
        <Ionicons name="barbell" size={16} color={C.onPrimary} />
        <Text style={styles.workoutText}>Push Day · 6:00pm</Text>
      </Animated.View>
      <View style={styles.busyBlock}>
        <Ionicons name="people-outline" size={14} color={C.textSecondary} />
        <Text style={styles.busyText}>Dinner · 8:00</Text>
      </View>
    </View>
  )
}

const makeAnimStyles = (C: Palette) => StyleSheet.create({
  track: { gap: Spacing.sm, marginTop: Spacing.md },
  busyBlock: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  busyText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  workoutBlock: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  workoutText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.onPrimary },
})

export default function WhyTempoScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const params = useLocalSearchParams<{ goal: string; experience: string; equipment: string; buildMode?: string }>()

  const [connected, setConnected] = useState<'google' | 'device' | null>(null)
  const [busy, setBusy] = useState<null | 'google' | 'device'>(null)
  const [error, setError] = useState<string | null>(null)
  const promptShownRef = useRef(true) // this screen always shows the card, so 'skipped' is always meaningful here

  // Rare edge case (an abandoned onboarding attempt reconnected before quitting,
  // then restarted onboarding fresh) — check once, best-effort, never blocking:
  // reusing connectGoogleCalendar() would just idempotently re-consent anyway,
  // but showing "connected" up front instead of "Connect" is honest and cheap.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      isGoogleCalendarConnected().catch(() => false),
      getCalendarPermissionStatus().catch(() => 'undetermined' as const),
    ]).then(([google, device]) => {
      if (cancelled) return
      if (google) setConnected('google')
      else if (device === 'granted') setConnected('device')
    })
    return () => { cancelled = true }
  }, [])

  const goNext = () => {
    track('onboarding_step_completed', { step: 'why_tempo' })
    if (!connected && promptShownRef.current) track('onboarding_calendar_prompt', { action: 'skipped', context: 'why_tempo' })
    router.push({
      pathname: '/onboarding/schedule',
      params: { ...params, preferredCalendar: connected ?? '' },
    })
  }

  const afterConnected = (provider: 'google' | 'device') => {
    if (session) trackCalendarConnected(session.user.id, provider)
    haptics.success()
    setConnected(provider)
  }

  const handleConnectGoogle = async () => {
    if (busy) return
    setBusy('google')
    setError(null)
    const r = await connectGoogleCalendar()
    setBusy(null)
    if (r.ok) {
      track('onboarding_calendar_prompt', { action: 'connected_google', context: 'why_tempo' })
      afterConnected('google')
    } else {
      track('onboarding_calendar_prompt', { action: 'failed', context: 'why_tempo' })
      setError(friendlyConnectError(r.error))
    }
  }

  const handleConnectDevice = async () => {
    if (busy) return
    setBusy('device')
    setError(null)
    const granted = await requestCalendarPermissions()
    setBusy(null)
    if (granted) {
      track('onboarding_calendar_prompt', { action: 'connected_device', context: 'why_tempo' })
      afterConnected('device')
    } else {
      track('onboarding_calendar_prompt', { action: 'failed', context: 'why_tempo' })
      setError('You can allow calendar access later in Settings.')
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <TempoWordmark size={16} />
        <TouchableOpacity onPress={goNext} hitSlop={8}>
          <Text style={styles.skipTop}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(2 / TOTAL_STEPS) * 100}%` }]} />
      </View>

      <View style={{ flex: 1, paddingHorizontal: Spacing.containerPadding }}>
        <FadeInView style={{ gap: Spacing.md }}>
          <Text style={styles.stepLabel}>STEP 2 OF {TOTAL_STEPS}</Text>
          <Text style={styles.title}>Most apps just log workouts.</Text>
          <Text style={styles.subtitle}>Tempo schedules them — around your real week, and moves them when life does.</Text>

          <ScheduleAnimation />

          <View style={styles.calCard}>
            <View style={styles.calCardHeader}>
              <View style={styles.calIcon}><Ionicons name="calendar-outline" size={18} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.calCardTitle}>See it with your real calendar</Text>
                <Text style={styles.calCardSub}>Tempo reads busy times only — event details never leave your phone.</Text>
              </View>
            </View>
            {error && <Text style={styles.calError}>{error}</Text>}
            {connected ? (
              <View style={styles.calSuccessRow}>
                <Ionicons name="checkmark-circle" size={18} color={C.success} />
                <Text style={styles.calSuccessText}>
                  {connected === 'google' ? 'Google Calendar connected' : 'Device calendar connected'}
                </Text>
              </View>
            ) : (
              <View style={styles.calBtnRow}>
                <PressableScale
                  style={[styles.calBtnPrimary, busy && { opacity: 0.6 }]}
                  onPress={handleConnectGoogle}
                  disabled={!!busy}
                >
                  {busy === 'google' ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.calBtnPrimaryText}>Connect Google Calendar</Text>}
                </PressableScale>
                <TouchableOpacity onPress={handleConnectDevice} disabled={!!busy} hitSlop={8}>
                  {busy === 'device' ? <ActivityIndicator color={C.primary} /> : <Text style={styles.calBtnSecondaryText}>Use device calendar</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </FadeInView>
      </View>

      <View style={styles.footer}>
        <PressableScale style={styles.continueBtn} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue →</Text>
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
  skipTop: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.textSecondary },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
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
  calSuccessRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  calSuccessText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
