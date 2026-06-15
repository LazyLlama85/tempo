import { useState, useRef, useMemo, useEffect } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, RefreshControl, Alert, Linking } from 'react-native'
import { LoadingCard } from '@/components/LoadingCard'
import { ErrorBanner } from '@/components/ErrorBanner'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Colors, Spacing, Radius, CardShadow, Typography } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { createWorkoutEvent, deleteWorkoutEvent, getCalendarPermissionStatus } from '@/services/calendarService'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'
import { suggestNextSlot, rescheduleWorkout } from '@/lib/reschedule'
import { getTodayCheckin, readinessLabel } from '@/lib/recovery'
import { RecoveryCheckIn } from '@/components/RecoveryCheckIn'

const C = Colors.light
const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// ── Date helpers (local time, no UTC shift) ───────────────────────────────────

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function getMonthBounds(d: Date) {
  const y = d.getFullYear(), m = d.getMonth()
  return {
    first: toDateStr(new Date(y, m, 1)),
    last: toDateStr(new Date(y, m + 1, 0)),
  }
}

function getDaysInMonth(d: Date): Date[] {
  const y = d.getFullYear(), m = d.getMonth()
  const count = new Date(y, m + 1, 0).getDate()
  return Array.from({ length: count }, (_, i) => new Date(y, m, i + 1))
}

// '07:00:00' → '7:00 AM'
function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  return `${h % 12 || 12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`
}

// '07:00:00' → '07:00' (fits the narrow timeline label column)
function formatTimeLabel(t: string): string {
  return t.slice(0, 5)
}

interface ScheduledWorkout {
  id: string
  user_id: string
  planned_date: string
  planned_start_time: string
  focus: string
  status: string
  exercise_ids: string[]
  planned_duration_min: number
  calendar_event_id: string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const router = useRouter()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''

  const today = new Date()
  const todayStr = toDateStr(today)

  const [currentMonth, setCurrentMonth] = useState(() =>
    new Date(today.getFullYear(), today.getMonth(), 1)
  )
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const dateStripRef = useRef<ScrollView>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)

  const queryClient = useQueryClient()

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  const handleAddToCalendar = async (workout: ScheduledWorkout) => {
    try {
      const eventId = await createWorkoutEvent(workout, userId)
      if (!eventId) {
        const status = await getCalendarPermissionStatus()
        if (status === 'denied') {
          Alert.alert('Permission Required', 'Allow calendar access in Settings to add workouts.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ])
        }
        return
      }
      queryClient.setQueryData(
        ['scheduled_workouts', userId, monthKey],
        (old: ScheduledWorkout[] | undefined) =>
          old?.map(w => w.id === workout.id ? { ...w, calendar_event_id: eventId } : w) ?? []
      )
    } catch {
      Alert.alert('Error', 'Could not add workout to calendar.')
    }
  }

  const handleRemoveFromCalendar = (workout: ScheduledWorkout) => {
    Alert.alert('Remove from Calendar?', 'This will delete the calendar event.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWorkoutEvent(workout.id, workout.calendar_event_id!, userId)
            queryClient.setQueryData(
              ['scheduled_workouts', userId, monthKey],
              (old: ScheduledWorkout[] | undefined) =>
                old?.map(w => w.id === workout.id ? { ...w, calendar_event_id: null } : w) ?? []
            )
          } catch {
            Alert.alert('Error', 'Could not remove calendar event.')
          }
        },
      },
    ])
  }

  const { first, last } = getMonthBounds(currentMonth)
  const monthKey = first // 'YYYY-MM-01' uniquely identifies the month

  const { data: workouts = [], isLoading, isError, refetch } = useQuery<ScheduledWorkout[]>({
    queryKey: ['scheduled_workouts', userId, monthKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_workouts')
        .select('*')
        .eq('user_id', userId)
        .gte('planned_date', first)
        .lte('planned_date', last)
        .order('planned_date')
        .order('planned_start_time')
      if (error) throw error
      return (data ?? []) as ScheduledWorkout[]
    },
    enabled: !!userId,
  })

  // Mark any past-due 'scheduled' workouts as 'missed' on entry, then refresh.
  useEffect(() => {
    if (!userId) return
    checkMissedWorkouts(supabase, userId).then(n => {
      if (n > 0) queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
      queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
    })
  }, [userId])

  const { data: missed = [] } = useQuery<ScheduledWorkout[]>({
    queryKey: ['missed_workouts', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('scheduled_workouts')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'missed')
        .order('planned_date', { ascending: false })
        .limit(5)
      return (data ?? []) as ScheduledWorkout[]
    },
    enabled: !!userId,
  })

  const { data: checkin } = useQuery({
    queryKey: ['recovery_today', userId],
    queryFn: () => getTodayCheckin(userId),
    enabled: !!userId,
  })

  const handleReschedule = async (workout: ScheduledWorkout) => {
    if (rescheduling) return
    setRescheduling(true)
    try {
      const slot = await suggestNextSlot(supabase, userId, workout.planned_duration_min)
      if (!slot) {
        Alert.alert('No open days', 'Your next week is full. Complete or skip a workout to free up a slot.')
        return
      }
      Alert.alert(
        'Reschedule workout',
        `Move "${workout.focus}" to ${slot.label}?${slot.fromCalendar ? '\n\nTempo found this free window in your calendar.' : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Move it',
            onPress: async () => {
              await rescheduleWorkout(supabase, userId, workout.id, slot)
              queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
              queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
            },
          },
        ],
      )
    } finally {
      setRescheduling(false)
    }
  }

  const workoutsByDate = useMemo(() => {
    const map: Record<string, ScheduledWorkout[]> = {}
    for (const w of workouts) {
      if (!map[w.planned_date]) map[w.planned_date] = []
      map[w.planned_date].push(w)
    }
    return map
  }, [workouts])

  const days = useMemo(() => getDaysInMonth(currentMonth), [currentMonth])
  const selectedWorkouts = workoutsByDate[selectedDate] ?? []
  const monthYear = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const changeMonth = (delta: number) => {
    const d = new Date(currentMonth)
    d.setMonth(d.getMonth() + delta)
    setCurrentMonth(d)
    const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
    setSelectedDate(isToday ? todayStr : toDateStr(new Date(d.getFullYear(), d.getMonth(), 1)))
  }

  // Scroll date strip so the selected day is visible after a month change
  useEffect(() => {
    const idx = days.findIndex(d => toDateStr(d) === selectedDate)
    if (idx < 0) return
    const ITEM_W = 68 // minWidth 56 + paddingHorizontal 16 + marginRight 8 ≈ 68
    setTimeout(() => {
      dateStripRef.current?.scrollTo({ x: Math.max(0, idx * ITEM_W - 100), animated: false })
    }, 50)
  }, [monthKey])

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/(tabs)/profile')}>
          <Ionicons name="menu-outline" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerLogo}>TEMPO</Text>
        <TouchableOpacity style={styles.avatar} onPress={() => router.push('/(tabs)/profile')}>
          <Ionicons name="person" size={16} color={C.onPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} />}
        >
        {/* Month row */}
        <View style={styles.monthRow}>
          <Text style={styles.monthText}>{monthYear}</Text>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => changeMonth(-1)}>
              <Ionicons name="chevron-back" size={20} color={C.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => changeMonth(1)}>
              <Ionicons name="chevron-forward" size={20} color={C.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Date strip */}
        <ScrollView
          ref={dateStripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dateStrip}
        >
          {days.map((day) => {
            const dateStr = toDateStr(day)
            const dayWorkouts = workoutsByDate[dateStr] ?? []
            const isActive = dateStr === selectedDate
            const allDone = dayWorkouts.length > 0 && dayWorkouts.every(w => w.status === 'completed')
            const hasAny = dayWorkouts.length > 0

            return (
              <TouchableOpacity
                key={dateStr}
                style={[styles.dayItem, isActive && styles.dayItemActive]}
                onPress={() => setSelectedDate(dateStr)}
              >
                <Text style={[styles.dayLabel, isActive && styles.dayLabelActive]}>
                  {DAY_LABELS[day.getDay()]}
                </Text>
                <Text style={[styles.dayNum, isActive && styles.dayNumActive]}>
                  {day.getDate()}
                </Text>
                {hasAny ? (
                  <View style={[styles.dot, allDone ? styles.dotGreen : isActive ? styles.dotWhite : styles.dotBlue]} />
                ) : (
                  <View style={styles.dotPlaceholder} />
                )}
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        {/* Daily readiness */}
        {checkin ? (
          <TouchableOpacity style={styles.readyCard} onPress={() => setShowRecovery(true)} activeOpacity={0.85}>
            <View style={{ flex: 1 }}>
              <Text style={styles.readyEyebrow}>TODAY'S READINESS</Text>
              <Text style={styles.readyValue}>
                {checkin.readiness}<Text style={styles.readyUnit}>/100</Text>
              </Text>
              <Text style={styles.readyLabel}>
                {readinessLabel(checkin.readiness)}{checkin.readiness < 50 ? ' · volume trimmed today' : ''}
              </Text>
              <View style={styles.readyBarTrack}>
                <View style={[styles.readyBarFill, { width: `${checkin.readiness}%` as `${number}%` }]} />
              </View>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.readyPrompt} onPress={() => setShowRecovery(true)} activeOpacity={0.85}>
            <View style={styles.readyPromptIcon}>
              <Ionicons name="pulse" size={18} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.readyPromptTitle}>How are you recovering?</Text>
              <Text style={styles.readyPromptSub}>10-sec check-in tunes today's session.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.outline} />
          </TouchableOpacity>
        )}

        {/* Missed-workout reschedule prompt (no shame — just a new slot) */}
        {missed.length > 0 && (
          <View style={styles.missedBanner}>
            <View style={styles.missedIcon}>
              <Ionicons name="refresh" size={18} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.missedTitle}>
                Missed {missed[0].focus}{missed.length > 1 ? ` +${missed.length - 1} more` : ''}
              </Text>
              <Text style={styles.missedSub}>No worries — let's find a new slot.</Text>
            </View>
            <TouchableOpacity
              style={[styles.missedBtn, rescheduling && { opacity: 0.6 }]}
              onPress={() => handleReschedule(missed[0])}
              disabled={rescheduling}
            >
              <Text style={styles.missedBtnText}>Reschedule</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Today summary banner */}
        {selectedWorkouts.length > 0 && (
          <View style={styles.todayBanner}>
            <Ionicons name="sparkles" size={18} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.todayBannerTitle}>
                {selectedWorkouts.length} workout{selectedWorkouts.length !== 1 ? 's' : ''} scheduled · {selectedDate === todayStr ? 'today' : 'this day'}
              </Text>
              <Text style={styles.todayBannerSub}>
                Starts at {formatTime(selectedWorkouts[0].planned_start_time)} · {selectedWorkouts[0].planned_duration_min} min
              </Text>
            </View>
          </View>
        )}

        {/* Timeline */}
        <View style={styles.timeline}>
          {isLoading ? (
            <LoadingCard />
          ) : isError ? (
            <ErrorBanner message="Failed to load your schedule." onRetry={refetch} />
          ) : workouts.length === 0 ? (
            profile?.onboarding_complete === false ? (
              <View style={styles.emptyState}>
                <TouchableOpacity style={styles.setupButton} onPress={() => router.push('/onboarding/goal')}>
                  <Text style={styles.setupButtonText}>Complete setup to get your plan →</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Your plan is loading. Pull down to refresh.</Text>
              </View>
            )
          ) : selectedWorkouts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Rest day — recovery is part of the plan.</Text>
            </View>
          ) : (
            selectedWorkouts.map((workout) => (
              <View key={workout.id} style={styles.timelineRow}>
                <Text style={[styles.timeLabel, styles.timeLabelActive]}>
                  {formatTimeLabel(workout.planned_start_time)}
                </Text>
                <View style={styles.workoutCard}>
                  <View style={styles.workoutBadgeRow}>
                    {workout.status === 'completed' ? (
                      <View style={styles.doneBadge}>
                        <Text style={styles.doneBadgeText}>DONE</Text>
                      </View>
                    ) : (
                      <View style={styles.workoutBadge}>
                        <Text style={styles.workoutBadgeText}>WORKOUT</Text>
                      </View>
                    )}
                    <Ionicons name="barbell-outline" size={18} color={C.primary} />
                  </View>
                  <Text style={styles.workoutTitle}>{workout.focus}</Text>
                  <View style={styles.workoutMeta}>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipLabel}>START TIME</Text>
                      <Text style={styles.metaChipValue}>{formatTime(workout.planned_start_time)}</Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipLabel}>DURATION</Text>
                      <Text style={styles.metaChipValue}>{workout.planned_duration_min} min</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.startButton}
                    onPress={() =>
                      router.push({ pathname: '/(tabs)/plan', params: { workoutId: workout.id } })
                    }
                  >
                    <Ionicons name="play" size={14} color={C.onPrimary} />
                    <Text style={styles.startButtonText}>Start Session</Text>
                  </TouchableOpacity>
                  {workout.calendar_event_id ? (
                    <TouchableOpacity style={styles.calendarBtn} onPress={() => handleRemoveFromCalendar(workout)}>
                      <Ionicons name="calendar" size={14} color="#16A34A" />
                      <Text style={styles.calendarBtnTextGreen}>In Calendar</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.calendarBtn} onPress={() => handleAddToCalendar(workout)}>
                      <Ionicons name="calendar-outline" size={14} color={C.textSecondary} />
                      <Text style={styles.calendarBtnText}>Add to Calendar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/(tabs)/plan')}>
        <Ionicons name="add" size={28} color={C.onPrimary} />
      </TouchableOpacity>

      <RecoveryCheckIn
        visible={showRecovery}
        userId={userId}
        onClose={() => setShowRecovery(false)}
        onSaved={() => {
          setShowRecovery(false)
          queryClient.invalidateQueries({ queryKey: ['recovery_today', userId] })
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingBottom: 120 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding,
    paddingVertical: Spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: C.outlineVariant,
  },
  headerLogo: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
    color: C.primary,
    letterSpacing: 2,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  monthText: { fontFamily: 'Inter_700Bold', fontSize: 24, color: C.text, letterSpacing: -0.24 },
  monthNav: { flexDirection: 'row', gap: Spacing.xs },

  dateStrip: { paddingHorizontal: Spacing.containerPadding, marginBottom: Spacing.lg },
  dayItem: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    marginRight: Spacing.xs,
    minWidth: 56,
  },
  dayItemActive: { backgroundColor: C.primary },
  dayLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline, marginBottom: 4 },
  dayLabelActive: { color: '#FFFFFF' },
  dayNum: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text },
  dayNumActive: { color: '#FFFFFF' },
  dot: { width: 5, height: 5, borderRadius: Radius.full, marginTop: 4 },
  dotBlue: { backgroundColor: C.primary },
  dotGreen: { backgroundColor: '#16A34A' },
  dotWhite: { backgroundColor: '#FFFFFF' },
  dotPlaceholder: { width: 5, height: 5, marginTop: 4 },

  timeline: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.sm },
  timelineRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  timeLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.outline,
    width: 44,
    paddingTop: 14,
  },
  timeLabelActive: { color: C.primary, fontFamily: 'Inter_700Bold' },
  recoveryLabel: {
    flex: 1,
    fontFamily: 'Inter_700Bold',
    ...Typography.labelCaps,
    color: C.outline,
    paddingVertical: Spacing.xs,
  },

  eventCard: {
    flex: 1,
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  eventTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  eventSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 2 },

  workoutCard: {
    flex: 1,
    backgroundColor: C.background,
    borderRadius: Radius.lg,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    ...CardShadow,
    gap: Spacing.sm,
  },
  workoutBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workoutBadge: {
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 3,
  },
  workoutBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.5 },
  workoutTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, color: C.text, lineHeight: 28, letterSpacing: -0.2 },
  workoutMeta: { flexDirection: 'row', gap: Spacing.md },
  metaChip: { gap: 2 },
  metaChipLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  metaChipValue: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },

  startButton: {
    backgroundColor: C.primary,
    borderRadius: Radius.lg,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  startButtonText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.onPrimary, letterSpacing: 0.3 },

  restCard: {
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    borderStyle: 'dashed',
  },
  restTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.textSecondary },
  restSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.outline, textAlign: 'center', lineHeight: 20 },

  fab: {
    position: 'absolute',
    bottom: 100,
    right: Spacing.containerPadding,
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0058BC',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 8,
  },
  todayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.md,
    backgroundColor: '#EFF4FF',
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  todayBannerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.text,
    letterSpacing: -0.1,
  },
  todayBannerSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  missedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.md,
    backgroundColor: '#EFF4FF',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: C.primary,
    borderStyle: 'dashed',
    padding: Spacing.md,
  },
  missedIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: C.background, alignItems: 'center', justifyContent: 'center',
  },
  missedTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, letterSpacing: -0.1 },
  missedSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2 },
  missedBtn: {
    backgroundColor: C.primary, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  missedBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.onPrimary },
  readyCard: {
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.md,
    backgroundColor: C.background,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    ...CardShadow,
    padding: Spacing.md,
    gap: 4,
  },
  readyEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  readyValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, color: C.primary, letterSpacing: -1, lineHeight: 34 },
  readyUnit: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary },
  readyLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  readyBarTrack: { height: 6, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full, marginTop: 6 },
  readyBarFill: { height: 6, backgroundColor: C.primary, borderRadius: Radius.full },
  readyPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.md,
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.xl,
    padding: Spacing.md,
  },
  readyPromptIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: '#EFF4FF', alignItems: 'center', justifyContent: 'center',
  },
  readyPromptTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  readyPromptSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2 },

  doneBadge: {
    backgroundColor: '#F0FDF4',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 3,
  },
  doneBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: '#16A34A', letterSpacing: 0.5 },

  emptyState: { paddingVertical: Spacing.xl, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary },

  skeletonTime: {
    width: 44,
    height: 14,
    borderRadius: 4,
    backgroundColor: C.surfaceContainerHigh,
    marginTop: 14,
  },
  skeletonCard: {
    flex: 1,
    height: 180,
    borderRadius: Radius.lg,
    backgroundColor: C.surfaceContainerHigh,
  },
  setupButton: {
    backgroundColor: C.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  setupButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: C.onPrimary,
    textAlign: 'center',
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  calendarBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  calendarBtnTextGreen: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#16A34A',
  },
})
