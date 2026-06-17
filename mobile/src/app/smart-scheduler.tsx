import { useState, useEffect } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import {
  isGoogleCalendarConnected, connectGoogleCalendar, disconnectGoogleCalendar, getGoogleAccessToken,
} from '@/services/googleCalendar/CalendarAuthService'
import {
  fetchUserBusySlots, findBestWorkoutSlot, autoScheduleWorkout, deleteCalendarEvent,
  type BusySlot, type TimeOfDay,
} from '@/services/googleCalendar/CalendarApiService'
import {
  getProfileForQuick, generateQuickWorkout, goalToPurpose,
  snapToQuickMinutes, persistPlannedWorkout,
  type QuickWorkout, type MovementPattern,
} from '@/lib/quickWorkout'

const C = Colors.light

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build Muscle',
  fat_loss: 'Lose Fat',
  strength: 'Gain Strength',
  general_fitness: 'General Fitness',
  athletic: 'Athletic Performance',
}

const TODS: { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
]

// Rotate the lead movement per day so the week isn't five identical sessions —
// gives a rough upper/lower/full split for free.
const SPLIT: MovementPattern[] = ['squat', 'push', 'pull', 'hinge', 'core']

type Phase = 'checking' | 'disconnected' | 'idle' | 'scheduling' | 'done'

interface PickedWorkout {
  startTime: string
  endTime: string
  title: string
  calendarEventId: string | null
}

interface DayWorkout {
  id: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  focus: string
}

// ── Date helpers ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function startOfNextDay(iso: string): Date { const x = startOfDay(new Date(iso)); x.setDate(x.getDate() + 1); return x }
function sameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime() }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
}
function fmtTime(d: Date): string {
  let h = d.getHours(); const m = d.getMinutes()
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}
function workoutToSlot(w: DayWorkout): BusySlot {
  const start = new Date(`${w.planned_date}T${w.planned_start_time}`)
  return { start, end: new Date(start.getTime() + w.planned_duration_min * 60_000) }
}
// "40-Minute Muscle Builder" → "Muscle Builder"
function sessionFocus(w: QuickWorkout): string {
  return w.title.replace(/^\d+-Minute\s*/, '')
}

function defaultTod(goal?: string): TimeOfDay {
  return goal === 'strength' ? 'evening' : 'morning'
}

function friendlyConnect(code?: string): string {
  switch (code) {
    case 'cancelled': return 'Sign-in was cancelled.'
    case 'no_refresh_token': return 'Google didn’t grant offline access — allow Calendar permission and try again.'
    case 'store_failed': return 'Couldn’t reach the scheduling service. Is the Edge Function deployed?'
    default: return 'Something went wrong connecting. Please try again.'
  }
}
function friendlyApi(e: unknown): string {
  const msg = e instanceof Error ? e.message : ''
  if (msg.includes('not_connected') || msg.includes('reconnect')) {
    return 'Your Google session expired — reconnect and try again.'
  }
  return 'Couldn’t schedule your week. Please try again.'
}

// ── Component ────────────────────────────────────────────────────────────────────

export default function SmartSchedulerDashboard() {
  const router = useRouter()
  const { profile, session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const duration = profile?.preferred_duration_min ?? 45
  const daysPerWeek = profile?.days_per_week ?? 3
  const goalLabel = profile?.goal ? GOAL_LABELS[profile.goal] ?? 'Workout' : 'Workout'

  const [phase, setPhase] = useState<Phase>('checking')
  const [connecting, setConnecting] = useState(false)
  const [busy, setBusy] = useState<BusySlot[]>([])
  const [workouts, setWorkouts] = useState<DayWorkout[]>([])
  const [picked, setPicked] = useState<PickedWorkout[]>([])
  const [tod, setTod] = useState<TimeOfDay>(defaultTod(profile?.goal))
  const [error, setError] = useState<string | null>(null)

  // The next 7 calendar days, starting today.
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = startOfDay(new Date()); d.setDate(d.getDate() + i); return d
  })

  useEffect(() => { checkConnection() }, [])

  async function checkConnection() {
    setPhase('checking')
    const connected = await isGoogleCalendarConnected()
    if (!connected) { setPhase('disconnected'); return }
    await loadWeek()
    setPhase('idle')
  }

  // Pull both the user's real agenda (busy, Tempo events excluded) and the Tempo
  // workouts already on the books for the coming week.
  async function loadWeek() {
    const today = startOfDay(new Date())
    const end = new Date(today); end.setDate(today.getDate() + 7)
    const [busyRes, wRes] = await Promise.all([
      fetchUserBusySlots(7).catch(() => [] as BusySlot[]),
      supabase
        .from('scheduled_workouts')
        .select('id, planned_date, planned_start_time, planned_duration_min, focus')
        .eq('user_id', userId)
        .eq('status', 'scheduled')
        .gte('planned_date', toDateStr(today))
        .lt('planned_date', toDateStr(end))
        .order('planned_date')
        .order('planned_start_time'),
    ])
    setBusy(busyRes)
    setWorkouts((wRes.data ?? []) as DayWorkout[])
  }

  async function handleConnect() {
    if (connecting) return
    setConnecting(true)
    const r = await connectGoogleCalendar()
    setConnecting(false)
    if (!r.ok) { Alert.alert('Couldn’t connect', friendlyConnect(r.error)); return }
    setPhase('checking')
    await loadWeek()
    setPhase('idle')
  }

  function handleDisconnect() {
    Alert.alert(
      'Disconnect Google Calendar?',
      'Tempo will stop reading your calendar and scheduling new workouts. Workouts already on your schedule stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnectGoogleCalendar()
            setPicked([]); setWorkouts([]); setBusy([]); setError(null)
            setPhase('disconnected')
          },
        },
      ],
    )
  }

  async function handleSchedule() {
    setPhase('scheduling'); setError(null)
    try {
      // Pre-flight: confirm Google is actually reachable before building a batch
      // of sessions. If the token can't be minted (revoked / connection dropped),
      // send the user to reconnect instead of creating un-synced workouts.
      const token = await getGoogleAccessToken()
      if (!token) {
        setError('Your Google connection expired — please reconnect.')
        setPhase('disconnected')
        return
      }

      const profileForQuick = await getProfileForQuick(supabase, userId)
      const genMinutes = snapToQuickMinutes(duration)
      const purpose = goalToPurpose(profileForQuick.goal)

      // Occupied = real calendar events + Tempo workouts already scheduled, so we
      // never overlap a meeting OR a workout that's already on the books.
      const events = await fetchUserBusySlots(7)
      const occupied: BusySlot[] = [...events, ...workouts.map(workoutToSlot)]

      const results: PickedWorkout[] = []
      const today0 = startOfDay(new Date())
      let cursor = new Date() // first search starts "now" (respects the 60-min lead)

      for (let i = 0; i < daysPerWeek; i++) {
        const dayIndex = Math.floor((startOfDay(cursor).getTime() - today0.getTime()) / DAY_MS)
        const horizonDays = 7 - dayIndex
        if (horizonDays <= 0) break

        const slot = findBestWorkoutSlot(
          occupied,
          { durationMinutes: duration, timeOfDayPreference: tod, workoutGoal: goalLabel },
          { now: cursor, horizonDays },
        )
        if (!slot) break

        // Build a real, startable session (lead movement rotates per day).
        const workout = await generateQuickWorkout(
          supabase, userId,
          { minutes: genMinutes, purpose, targetPattern: SPLIT[i % SPLIT.length] },
          profileForQuick,
        )

        // No exercises match this user's equipment/experience (e.g. an empty
        // library). Bail clearly rather than book blank, un-startable sessions.
        if (!workout.exercises.length) {
          if (!results.length) {
            setError('Couldn’t build a session — add equipment in your profile, or make sure your exercise library is loaded.')
            setPhase('idle')
            return
          }
          break
        }

        // Reserve this slot and spread to the next day for the following pick.
        occupied.push({ start: new Date(slot.startTime), end: new Date(slot.endTime) })

        const focus = sessionFocus(workout)
        const startDate = new Date(slot.startTime)

        // Push to Google Calendar (tomato). Keep going on a transient failure —
        // the Tempo workout is the primary artifact and shows in-app regardless.
        let calendarEventId: string | null = null
        try {
          const ev = await autoScheduleWorkout(`Tempo · ${focus}`, slot.startTime, duration)
          calendarEventId = ev.id
        } catch { /* report the sync gap in the summary below */ }

        const workoutId = await persistPlannedWorkout(supabase, userId, workout, {
          plannedDate: toDateStr(startDate),
          plannedStartTime: fmtClock(startDate),
          durationMin: duration,
          focus,
          calendarEventId,
        })

        // If the DB write failed, roll back the calendar event so we never leave
        // an orphaned event with no matching Tempo workout.
        if (!workoutId) {
          if (calendarEventId) await deleteCalendarEvent(calendarEventId).catch(() => {})
          setError('Couldn’t save your workouts. Please try again.')
          setPhase('idle')
          return
        }

        results.push({ startTime: slot.startTime, endTime: slot.endTime, title: focus, calendarEventId })
        cursor = startOfNextDay(slot.startTime)
      }

      if (!results.length) {
        setError('No open slots this week for that time of day. Try a different time.')
        setPhase('idle')
        return
      }

      await loadWeek()
      setPicked(results)
      setPhase('done')
    } catch (e) {
      setError(friendlyApi(e))
      setPhase('idle')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const Header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="chevron-down" size={26} color={C.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Smart Scheduler</Text>
      <View style={{ width: 26 }} />
    </View>
  )

  if (phase === 'checking') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {Header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.muted}>Checking your calendar…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (phase === 'disconnected') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {Header}
        <View style={styles.center}>
          <View style={styles.connectIcon}>
            <Ionicons name="calendar" size={32} color={C.primary} />
          </View>
          <Text style={styles.connectTitle}>Connect Google Calendar</Text>
          <Text style={styles.connectSub}>
            Tempo reads the free gaps in your week and builds workouts around your real
            schedule — automatically.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, connecting && { opacity: 0.6 }]}
            onPress={handleConnect}
            disabled={connecting}
            activeOpacity={0.85}
          >
            {connecting
              ? <ActivityIndicator color={C.onPrimary} />
              : <Text style={styles.primaryBtnText}>Connect Google Calendar</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const scheduling = phase === 'scheduling'
  const syncedCount = picked.filter(p => p.calendarEventId).length

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {Header}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Plan summary */}
        <View style={styles.prefCard}>
          <Text style={styles.prefEyebrow}>YOUR PLAN</Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}><Ionicons name="time-outline" size={13} color={C.primary} /><Text style={styles.chipText}>{duration} min</Text></View>
            <View style={styles.chip}><Ionicons name="repeat" size={13} color={C.primary} /><Text style={styles.chipText}>{daysPerWeek}× / week</Text></View>
            <View style={styles.chip}><Ionicons name="trophy-outline" size={13} color={C.primary} /><Text style={styles.chipText}>{goalLabel}</Text></View>
          </View>

          <Text style={[styles.prefEyebrow, { marginTop: Spacing.md }]}>PREFERRED TIME</Text>
          <View style={styles.segmented}>
            {TODS.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.segment, tod === t.id && styles.segmentActive]}
                onPress={() => setTod(t.id)}
                disabled={scheduling}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, tod === t.id && styles.segmentTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Success banner */}
        {phase === 'done' && (
          <View style={styles.successCard}>
            <View style={styles.successHead}>
              <Ionicons name="checkmark-circle" size={20} color={C.success} />
              <Text style={styles.successTitle}>
                Built {picked.length} workout{picked.length !== 1 ? 's' : ''} this week
              </Text>
            </View>
            {picked.map((p) => {
              const d = new Date(p.startTime)
              return (
                <View key={p.startTime} style={styles.successRow}>
                  <View style={styles.tomatoDot} />
                  <Text style={styles.successDay}>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                  <Text style={styles.successTime}>{fmtTime(d)}</Text>
                </View>
              )
            })}
            <Text style={styles.successHint}>
              {syncedCount === picked.length
                ? 'Saved to your Tempo schedule and added to Google Calendar in tomato red.'
                : syncedCount === 0
                  ? 'Saved to your Tempo schedule. (Couldn’t reach Google Calendar — reconnect to sync.)'
                  : `Saved to your Tempo schedule; ${syncedCount} synced to Google Calendar.`}
            </Text>
          </View>
        )}

        {/* Week view */}
        <Text style={styles.weekLabel}>YOUR WEEK</Text>
        <View style={styles.weekCard}>
          {week.map((day, i) => {
            const events = busy.filter(b => sameDay(b.start, day)).length
            const dayWorkout = workouts.find(w => w.planned_date === toDateStr(day))
            const isToday = i === 0
            return (
              <View key={day.toISOString()} style={[styles.dayRow, i > 0 && styles.dayRowBorder]}>
                <View style={styles.dayLeft}>
                  <Text style={styles.dayWd}>{day.toLocaleDateString('en-US', { weekday: 'short' })}{isToday ? ' · Today' : ''}</Text>
                  <Text style={styles.dayMd}>{day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                </View>
                {dayWorkout ? (
                  <View style={styles.workoutPill}>
                    <View style={styles.tomatoDot} />
                    <Text style={styles.workoutPillText} numberOfLines={1}>
                      {fmtTime(new Date(`${dayWorkout.planned_date}T${dayWorkout.planned_start_time}`))} · {dayWorkout.focus}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.dayMeta}>{events > 0 ? `${events} event${events !== 1 ? 's' : ''}` : 'Open'}</Text>
                )}
              </View>
            )
          })}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>

      {/* Action bar */}
      <View style={styles.footer}>
        {phase === 'done' ? (
          <>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPicked([]); setPhase('idle') }} hitSlop={8}>
              <Text style={styles.secondaryText}>Schedule more</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, scheduling && { opacity: 0.7 }]}
              onPress={handleSchedule}
              disabled={scheduling}
              activeOpacity={0.85}
            >
              {scheduling ? (
                <View style={styles.row}>
                  <ActivityIndicator color={C.onPrimary} />
                  <Text style={[styles.primaryBtnText, { marginLeft: Spacing.sm }]}>Building your week…</Text>
                </View>
              ) : (
                <View style={styles.row}>
                  <Ionicons name="sparkles" size={16} color={C.onPrimary} />
                  <Text style={[styles.primaryBtnText, { marginLeft: Spacing.xs }]}>Smart Schedule My Week</Text>
                </View>
              )}
            </TouchableOpacity>
            {!scheduling && (
              <TouchableOpacity onPress={handleDisconnect} hitSlop={8}>
                <Text style={styles.secondaryText}>Disconnect Google Calendar</Text>
              </TouchableOpacity>
            )}
          </>
        )}
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
  headerTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.text, letterSpacing: -0.2 },
  scroll: { padding: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  muted: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },

  // Connect (disconnected) state
  connectIcon: {
    width: 64, height: 64, borderRadius: Radius.full, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs,
  },
  connectTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.3, textAlign: 'center' },
  connectSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 21, paddingHorizontal: Spacing.md },

  // Preferences
  prefCard: {
    backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: Spacing.xs,
  },
  prefEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6,
  },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },
  segmented: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 4, marginTop: Spacing.xs },
  segment: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  segmentActive: { backgroundColor: C.background, ...CardShadow, shadowOpacity: 0.08 },
  segmentText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  segmentTextActive: { fontFamily: 'Inter_700Bold', color: C.text },

  // Week view
  weekLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  weekCard: {
    backgroundColor: C.background, borderRadius: Radius.xl, ...CardShadow,
    borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden', marginTop: -Spacing.xs,
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, gap: Spacing.sm },
  dayRowBorder: { borderTopWidth: 1, borderTopColor: C.surfaceContainerHigh },
  dayLeft: { gap: 1 },
  dayWd: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  dayMd: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary },
  dayMeta: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.outline },
  workoutPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primarySoft,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6, flexShrink: 1,
  },
  workoutPillText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary, flexShrink: 1 },
  tomatoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D50000' },

  // Success
  successCard: { backgroundColor: C.successSoft, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  successHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  successTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.text, letterSpacing: -0.2 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  successDay: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text },
  successTime: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  successHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 17 },

  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.error, textAlign: 'center' },

  // Footer / actions
  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm, alignItems: 'center' },
  primaryBtn: {
    height: 56, alignSelf: 'stretch', backgroundColor: C.primary, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  secondaryText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary, textDecorationLine: 'underline' },
})
