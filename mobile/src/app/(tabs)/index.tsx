import { useState, useRef, useMemo, useEffect } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, RefreshControl, Alert, Linking } from 'react-native'
import { LoadingCard } from '@/components/LoadingCard'
import { ErrorBanner } from '@/components/ErrorBanner'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Colors, Spacing, Radius, CardShadow, Typography } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { createWorkoutEvent, deleteWorkoutEvent, getCalendarPermissionStatus, getDayEvents, type DayEvent } from '@/services/calendarService'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'
import { dedupeScheduledWorkouts } from '@/lib/dedupeSchedule'
import { suggestNextSlot, rescheduleWorkout } from '@/lib/reschedule'
import { getTodayCheckin, readinessLabel } from '@/lib/recovery'
import { RecoveryCheckIn } from '@/components/RecoveryCheckIn'
import { getQuickSuggestion, type QuickSuggestion } from '@/lib/quickSuggestion'
import { parseAvatar } from '@/lib/avatar'

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

// Date → 'HH:MM' / '7:00 AM' for calendar events on the timeline.
function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function time12(d: Date): string {
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
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

  // Header greeting — replaces the old menu icon (which just opened Profile, same
  // as the avatar). The avatar mirrors the user's chosen profile avatar.
  const hour = today.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = profile?.display_name?.trim().split(' ')[0] || 'Athlete'
  const avatar = parseAvatar(profile?.avatar_url)

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

  // On entry: collapse any duplicate days (repairs older "4 workouts at 7:00"
  // state), then mark past-due 'scheduled' workouts as 'missed'. Refresh after.
  useEffect(() => {
    if (!userId) return
    ;(async () => {
      const removed = await dedupeScheduledWorkouts(supabase, userId)
      const missedCount = await checkMissedWorkouts(supabase, userId)
      if (removed > 0 || missedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
      }
      queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
    })()
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

  // Calendar-aware Quick Workout nudge — the proactive "your day is messy, here's
  // a session that fits" prompt that sets Tempo apart from plain generators.
  const { data: suggestion } = useQuery({
    queryKey: ['quick_suggestion', userId],
    queryFn: () => getQuickSuggestion(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // Calendar events for the selected day — shown on the timeline alongside
  // workouts (de-emphasised). Tempo's own synced events are filtered out inside
  // getDayEvents so they never duplicate the workout cards.
  const { data: dayEvents = [] } = useQuery<DayEvent[]>({
    queryKey: ['day_events', userId, selectedDate],
    queryFn: () => getDayEvents(new Date(`${selectedDate}T00:00:00`)),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  const goQuick = (s?: QuickSuggestion | null) => {
    if (s) {
      router.push({
        pathname: '/quick-workout',
        params: {
          minutes: String(s.minutes),
          ...(s.purpose ? { purpose: s.purpose } : {}),
          ...(s.targetPattern ? { targetPattern: s.targetPattern } : {}),
          ...(s.daysSinceTrained ? { daysSinceTrained: String(s.daysSinceTrained) } : {}),
          ...(s.fromCalendarGap ? { fromCalendarGap: '1' } : {}),
        },
      })
    } else {
      router.push('/quick-workout')
    }
  }

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
              try {
                await rescheduleWorkout(supabase, userId, workout.id, slot)
                queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
                queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
              } catch {
                Alert.alert('Could not reschedule', 'Something went wrong moving that workout. Please try again.')
              }
            },
          },
        ],
      )
    } catch {
      Alert.alert('Could not reschedule', 'We had trouble finding a new slot. Please try again.')
    } finally {
      setRescheduling(false)
    }
  }

  const workoutsByDate = useMemo(() => {
    const map: Record<string, ScheduledWorkout[]> = {}
    for (const w of workouts) {
      // 'rescheduled' rows are superseded duplicates / cleared plan sessions — hidden.
      if (w.status === 'rescheduled') continue
      if (!map[w.planned_date]) map[w.planned_date] = []
      map[w.planned_date].push(w)
    }
    return map
  }, [workouts])

  const days = useMemo(() => getDaysInMonth(currentMonth), [currentMonth])
  const selectedWorkouts = workoutsByDate[selectedDate] ?? []
  const monthYear = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // One time-sorted timeline of the day's workouts (emphasised cards) and
  // calendar events (muted rows).
  type TimelineItem =
    | { kind: 'workout'; key: string; sort: number; workout: ScheduledWorkout }
    | { kind: 'event'; key: string; sort: number; event: DayEvent }

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const items: TimelineItem[] = [
      ...selectedWorkouts.map(w => ({ kind: 'workout' as const, key: `w-${w.id}`, sort: toMin(w.planned_start_time), workout: w })),
      ...dayEvents.map(e => ({ kind: 'event' as const, key: `e-${e.id}`, sort: e.start.getHours() * 60 + e.start.getMinutes(), event: e })),
    ]
    return items.sort((a, b) => a.sort - b.sort)
  }, [selectedWorkouts, dayEvents])

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
      {/* Header — greeting on the left, avatar (the single Profile entry) on the right */}
      <View style={styles.header}>
        <View style={styles.greetingWrap}>
          <Text style={styles.greetingEyebrow}>{greeting.toUpperCase()}</Text>
          <Text style={styles.greetingName} numberOfLines={1}>{firstName}</Text>
        </View>
        <TouchableOpacity
          style={[styles.avatar, { backgroundColor: avatar.color }]}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.85}
        >
          {avatar.imageUri ? (
            <Image source={{ uri: avatar.imageUri }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Ionicons name={avatar.icon as any} size={18} color="#fff" />
          )}
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

        {/* Quick Workout — hero entry. Contextual when Tempo has a reason to nudge,
            always one tap to "build a session for the minutes I actually have". */}
        <TouchableOpacity style={styles.quickCard} onPress={() => goQuick(suggestion)} activeOpacity={0.9}>
          <View style={styles.quickIconWrap}>
            <Ionicons name={(suggestion?.icon as any) ?? 'flash'} size={22} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickEyebrow}>QUICK WORKOUT</Text>
            <Text style={styles.quickTitle}>{suggestion?.headline ?? 'Short on time?'}</Text>
            <Text style={styles.quickSub}>
              {suggestion?.sub ?? 'Build a session for the minutes you actually have.'}
            </Text>
          </View>
          <View style={styles.quickGo}>
            <Ionicons name="arrow-forward" size={18} color={C.onPrimary} />
          </View>
        </TouchableOpacity>

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

        {/* Timeline — workouts (emphasised cards) + calendar events (muted rows) */}
        <View style={styles.timeline}>
          {isLoading ? (
            <LoadingCard />
          ) : isError ? (
            <ErrorBanner message="Failed to load your schedule." onRetry={refetch} />
          ) : profile?.onboarding_complete === false ? (
            <View style={styles.emptyState}>
              <TouchableOpacity style={styles.setupButton} onPress={() => router.push('/onboarding/goal')}>
                <Text style={styles.setupButtonText}>Complete setup to get your plan →</Text>
              </TouchableOpacity>
            </View>
          ) : timelineItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {workouts.length === 0
                  ? 'Your plan is loading. Pull down to refresh.'
                  : 'Rest day — recovery is part of the plan.'}
              </Text>
            </View>
          ) : (
            timelineItems.map((item) => {
              if (item.kind === 'event') {
                const e = item.event
                return (
                  <View key={item.key} style={styles.timelineRow}>
                    <Text style={styles.timeLabel}>{hm(e.start)}</Text>
                    <View style={styles.eventLite}>
                      <View style={styles.eventLiteDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.eventLiteTitle} numberOfLines={1}>{e.title}</Text>
                        <Text style={styles.eventLiteTime}>{time12(e.start)} – {time12(e.end)}</Text>
                      </View>
                    </View>
                  </View>
                )
              }
              const workout = item.workout
              return (
                <View key={item.key} style={styles.timelineRow}>
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
                    <View style={styles.cardActionsRow}>
                      {workout.calendar_event_id ? (
                        <TouchableOpacity style={styles.calendarBtn} onPress={() => handleRemoveFromCalendar(workout)}>
                          <Ionicons name="calendar" size={14} color={C.success} />
                          <Text style={styles.calendarBtnTextGreen}>In Calendar</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity style={styles.calendarBtn} onPress={() => handleAddToCalendar(workout)}>
                          <Ionicons name="calendar-outline" size={14} color={C.textSecondary} />
                          <Text style={styles.calendarBtnText}>Add to Calendar</Text>
                        </TouchableOpacity>
                      )}
                      {workout.status !== 'completed' && (
                        <TouchableOpacity
                          style={styles.calendarBtn}
                          onPress={() => handleReschedule(workout)}
                          disabled={rescheduling}
                        >
                          <Ionicons name="swap-horizontal" size={14} color={C.textSecondary} />
                          <Text style={styles.calendarBtnText}>Reschedule</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </ScrollView>

      {/* FAB — one-tap Quick Workout from anywhere on the schedule */}
      <TouchableOpacity style={styles.fab} onPress={() => goQuick(suggestion)}>
        <Ionicons name="flash" size={26} color={C.onPrimary} />
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
  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  greetingWrap: { flex: 1 },
  greetingEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  greetingName: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.text, letterSpacing: -0.3, marginTop: 1 },

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
  dotGreen: { backgroundColor: C.success },
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
    backgroundColor: C.primarySoft,
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
    backgroundColor: C.primarySoft,
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
    backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  readyPromptTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  readyPromptSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2 },

  doneBadge: {
    backgroundColor: C.successSoft,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 3,
  },
  doneBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.success, letterSpacing: 0.5 },

  quickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.md,
    backgroundColor: C.background,
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderColor: C.primary,
    padding: Spacing.md,
    ...CardShadow,
  },
  quickIconWrap: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  quickEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.6 },
  quickTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.text, letterSpacing: -0.2, marginTop: 1 },
  quickSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 16 },
  quickGo: {
    width: 36, height: 36, borderRadius: Radius.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },

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
  cardActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  calendarBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  calendarBtnTextGreen: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.success,
  },

  // Calendar events on the timeline — intentionally quiet next to workout cards.
  eventLite: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  eventLiteDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.outline },
  eventLiteTitle: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  eventLiteTime: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, marginTop: 1 },
})
