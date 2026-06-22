import { useState, useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Platform, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { connectGoogleCalendar, isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { requestCalendarPermissions, getCalendarPermissionStatus } from '@/services/calendarService'

const C = Colors.light

const WHY_CONNECT = [
  'Tempo schedules your workouts automatically around your real events',
  'When a meeting moves, your workout quietly reschedules itself',
  'Your calendar stays on your device — your events are never uploaded',
]

// Map the connect error codes to plain language (mirrors the Smart Scheduler).
function friendlyConnect(code?: string): string {
  switch (code) {
    case 'cancelled': return 'Sign-in was cancelled.'
    case 'no_refresh_token': return 'Google didn’t grant offline access — allow Calendar permission and try again.'
    case 'store_failed': return 'Couldn’t reach the scheduling service. Please try again.'
    default: return code ? `Connection failed — ${code}` : 'Something went wrong connecting. Please try again.'
  }
}

export default function ScheduleScreen() {
  const router = useRouter()
  const { goal, experience, equipment } = useLocalSearchParams<{ goal: string; experience: string; equipment: string }>()
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  // Real connection state — which calendar is connected, and which (if any) is
  // mid-connect. No more "just turn the button green".
  const [connectedProvider, setConnectedProvider] = useState<'google' | 'device' | null>(null)
  const [connecting, setConnecting] = useState<null | 'google' | 'device'>(null)

  // Reflect any existing connection (e.g. re-running onboarding via "Change Plan").
  useEffect(() => {
    (async () => {
      try {
        if (await isGoogleCalendarConnected()) { setConnectedProvider('google'); return }
        if ((await getCalendarPermissionStatus()) === 'granted') setConnectedProvider('device')
      } catch { /* leave disconnected */ }
    })()
  }, [])

  // Real Google OAuth — the exact same flow as Settings / Smart Scheduler.
  const handleConnectGoogle = async () => {
    if (connecting) return
    setConnecting('google')
    const r = await connectGoogleCalendar()
    setConnecting(null)
    if (r.ok) setConnectedProvider('google')
    else Alert.alert('Couldn’t connect', friendlyConnect(r.error))
  }

  // Device (Apple) calendar — real OS permission prompt.
  const handleConnectDevice = async () => {
    if (connecting) return
    setConnecting('device')
    const granted = await requestCalendarPermissions()
    setConnecting(null)
    if (granted) setConnectedProvider('device')
    else Alert.alert('Permission needed', 'Allow calendar access to sync workouts to your device calendar. You can enable this later in Settings.')
  }

  // Carry the connected calendar forward so plan-preview saves it as the default.
  const goNext = () => router.push({
    pathname: '/onboarding/plan-preview',
    params: {
      goal, experience, equipment, daysPerWeek: String(daysPerWeek),
      ...(connectedProvider ? { preferredCalendar: connectedProvider } : {}),
    },
  })

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
        <View style={[styles.progressFill, { width: '80%' }]} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 4 OF 5</Text>
        <Text style={styles.title}>Choose your calendar.</Text>
        <Text style={styles.subtitle}>
          Pick the calendar you actually use. Tempo reads your free time from it and
          schedules your workouts around your real life — automatically.
        </Text>

        {/* Days per week selector */}
        <View style={styles.daysSection}>
          <Text style={styles.daysSectionLabel}>DAYS PER WEEK</Text>
          <View style={styles.daysRow}>
            {[2, 3, 4, 5].map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.dayBtn, daysPerWeek === d && styles.dayBtnSelected]}
                onPress={() => setDaysPerWeek(d)}
                activeOpacity={0.7}
              >
                <Text style={[styles.dayBtnText, daysPerWeek === d && styles.dayBtnTextSelected]}>
                  {d}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Calendar connect buttons — real auth, clear connected status */}
        {connectedProvider ? (
          <View style={styles.connectedBadge}>
            <Ionicons name="checkmark-circle" size={20} color={C.success} />
            <Text style={styles.connectedText}>
              {connectedProvider === 'google' ? 'Google Calendar connected' : 'Device Calendar connected'}
            </Text>
          </View>
        ) : (
          <View style={styles.calendarButtons}>
            <TouchableOpacity
              style={[styles.calendarBtn, !!connecting && { opacity: 0.6 }]}
              onPress={handleConnectGoogle}
              disabled={!!connecting}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={20} color="#EA4335" />
              <Text style={styles.calendarBtnText}>Connect Google Calendar</Text>
              {connecting === 'google'
                ? <ActivityIndicator color={C.primary} />
                : <Ionicons name="chevron-forward" size={16} color={C.outline} />}
            </TouchableOpacity>
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={[styles.calendarBtn, !!connecting && { opacity: 0.6 }]}
                onPress={handleConnectDevice}
                disabled={!!connecting}
                activeOpacity={0.7}
              >
                <Ionicons name="calendar" size={20} color={C.text} />
                <Text style={styles.calendarBtnText}>Connect Device Calendar</Text>
                {connecting === 'device'
                  ? <ActivityIndicator color={C.primary} />
                  : <Ionicons name="chevron-forward" size={16} color={C.outline} />}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Why connect */}
        <View style={styles.whySection}>
          <Text style={styles.whyLabel}>WHY CONNECT?</Text>
          {WHY_CONNECT.map((item) => (
            <View key={item} style={styles.whyRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={C.primary} />
              <Text style={styles.whyText}>{item}</Text>
            </View>
          ))}
        </View>

        {/* Calendar preview */}
        <View style={styles.calendarPreview}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewDate}>Tuesday, Oct 24</Text>
            <View style={styles.previewDots}>
              <View style={[styles.dot, { backgroundColor: '#EA4335' }]} />
              <View style={[styles.dot, { backgroundColor: C.primary }]} />
            </View>
          </View>
          {/* Timeline preview */}
          <View style={styles.previewTimeline}>
            <View style={styles.previewRow}>
              <Text style={styles.previewTime}>8:00 AM</Text>
              <View style={styles.previewEvent}><Text style={styles.previewEventText}>Team Standup</Text></View>
            </View>
            <View style={styles.previewRow}>
              <Text style={[styles.previewTime, { color: C.primary }]}>10:30 AM</Text>
              <View style={styles.previewWorkout}>
                <View style={styles.idealBadge}>
                  <Text style={styles.idealBadgeText}>IDEAL TRAINING WINDOW</Text>
                  <Ionicons name="sparkles" size={10} color={C.primary} />
                </View>
                <Text style={styles.previewWorkoutTitle}>Upper Body Power</Text>
                <Text style={styles.previewWorkoutMeta}>45 Minutes • Free Time detected</Text>
              </View>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewTime}>12:00 PM</Text>
              <View style={styles.previewEvent}><Text style={styles.previewEventText}>Project Review</Text></View>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.continueBtn} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goNext}>
          <Text style={styles.skipText}>Maybe later</Text>
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
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.lg },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  connectedBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: C.successSoft, padding: Spacing.md, borderRadius: Radius.lg },
  connectedText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.success },
  calendarButtons: { gap: Spacing.sm },
  calendarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: C.outlineVariant,
  },
  calendarBtnText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  whySection: { gap: Spacing.sm },
  whyLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  whyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  whyText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  calendarPreview: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.md },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewDate: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  previewDots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: Radius.full },
  previewTimeline: { gap: Spacing.sm },
  previewRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  previewTime: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, width: 58, paddingTop: 12 },
  previewEvent: { flex: 1, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.md, padding: Spacing.sm },
  previewEventText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  previewWorkout: {
    flex: 1, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1.5, borderColor: C.primary, borderStyle: 'dashed',
    backgroundColor: `${C.primary}08`, gap: 3,
  },
  idealBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  idealBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.primary, letterSpacing: 0.4 },
  previewWorkoutTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  previewWorkoutMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary },
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  skipText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.outline, textAlign: 'center', paddingVertical: Spacing.xs },
  daysSection: { gap: Spacing.xs },
  daysSectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  daysRow: { flexDirection: 'row', gap: Spacing.sm },
  dayBtn: {
    flex: 1, aspectRatio: 1, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  dayBtnSelected: { backgroundColor: C.primary, borderColor: C.primary },
  dayBtnText: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text },
  dayBtnTextSelected: { color: C.onPrimary },
})
