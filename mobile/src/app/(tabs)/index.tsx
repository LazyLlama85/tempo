import { useState, useRef, useMemo, useEffect } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, RefreshControl, Alert, Linking, type LayoutChangeEvent } from 'react-native'
import { LoadingCard } from '@/components/LoadingCard'
import { ErrorBanner } from '@/components/ErrorBanner'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { requestCalendarPermissions, getRangeEvents, type DayEvent } from '@/services/calendarService'
import { addWorkoutToCalendar, removeWorkoutFromCalendar } from '@/services/calendarSync'
import { EditWorkoutSheet } from '@/components/EditWorkoutSheet'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'
import { dedupeScheduledWorkouts } from '@/lib/dedupeSchedule'
import { suggestNextSlot, rescheduleWorkout } from '@/lib/reschedule'
import { getTodayCheckin } from '@/lib/recovery'
import { RecoveryCheckIn } from '@/components/RecoveryCheckIn'
import { getQuickSuggestion, type QuickSuggestion } from '@/lib/quickSuggestion'
import { parseAvatar } from '@/lib/avatar'

const C = Colors.light
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
type IconName = keyof typeof Ionicons.glyphMap
type ViewMode = 'day' | 'week' | 'month'

// ── Date helpers (local time, no UTC shift) ───────────────────────────────────

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function parseLocal(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Sunday as the first day of the week (matches US calendars + the S M T … strip).
function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}

function getWeekDays(d: Date): Date[] {
  const s = startOfWeek(d)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
}

// 6-row month grid (42 cells) starting on the Sunday on/before the 1st, so the
// grid always aligns to weekday columns and never reflows between months.
function getMonthGrid(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const s = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(s, i))
}

const minOfTime = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const minOfDate = (d: Date) => d.getHours() * 60 + d.getMinutes()

// '07:00:00' → '7:00 AM' (12-hour everywhere — never 24-hour)
function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  return `${h % 12 || 12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`
}

// Date → '7:00 AM' for calendar events on the timeline.
function time12(d: Date): string {
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

// A muted, recognisable icon for a non-workout event, inferred from its title so
// school/work/reminders read at a glance without a category field.
function eventIcon(title: string): IconName {
  const t = title.toLowerCase()
  if (/(class|lecture|lab|school|exam|study|seminar|cs\b|math|bio|chem|hist)/.test(t)) return 'school-outline'
  if (/(work|meeting|standup|stand-up|sync|1:1|interview|shift|call|review|deadline)/.test(t)) return 'briefcase-outline'
  if (/(reminder|todo|task|pay|appt|appointment|doctor|dentist|pick up|renew)/.test(t)) return 'alarm-outline'
  if (/(lunch|dinner|breakfast|coffee|brunch|eat|meal)/.test(t)) return 'restaurant-outline'
  if (/(flight|train|drive|commute|travel|trip)/.test(t)) return 'airplane-outline'
  return 'ellipse-outline'
}

function readinessColor(n: number): string {
  if (n >= 67) return C.success
  if (n >= 34) return C.primary
  return C.error
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
  calendar_provider: 'google' | 'device' | null
}

type FeedItem =
  | { kind: 'workout'; sort: number; workout: ScheduledWorkout; hero: boolean }
  | { kind: 'event'; sort: number; event: DayEvent }

interface DayGroup {
  dateStr: string
  date: Date
  isToday: boolean
  items: FeedItem[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const router = useRouter()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''

  const today = new Date()
  const todayStr = toDateStr(today)
  const avatar = parseAvatar(profile?.avatar_url)

  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [refreshing, setRefreshing] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [editingWorkout, setEditingWorkout] = useState<ScheduledWorkout | null>(null)

  const scrollRef = useRef<ScrollView>(null)
  const sectionY = useRef<Record<string, number>>({})
  const queryClient = useQueryClient()

  const selDate = useMemo(() => parseLocal(selectedDate), [selectedDate])

  // ── Visible ranges ──────────────────────────────────────────────────────────
  // Calendar range = what the strip/grid shows (and therefore which days need
  // workout dots). Feed range = which days the list below renders.
  const weekDays = useMemo(() => getWeekDays(selDate), [selDate])
  const monthGrid = useMemo(() => getMonthGrid(selDate), [selDate])

  const calRange = useMemo(() => {
    const cells = viewMode === 'month' ? monthGrid : weekDays
    return { start: toDateStr(cells[0]), end: toDateStr(cells[cells.length - 1]) }
  }, [viewMode, weekDays, monthGrid])

  const feedRange = useMemo(() => {
    if (viewMode === 'week') return { start: toDateStr(weekDays[0]), end: toDateStr(weekDays[6]) }
    return { start: selectedDate, end: selectedDate }
  }, [viewMode, weekDays, selectedDate])

  // ── Data ──────────────────────────────────────────────────────────────────--
  const workoutsKey = ['scheduled_workouts', userId, calRange.start, calRange.end]

  const { data: workouts = [], isLoading, isError, refetch } = useQuery<ScheduledWorkout[]>({
    queryKey: workoutsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_workouts')
        .select('*')
        .eq('user_id', userId)
        .gte('planned_date', calRange.start)
        .lte('planned_date', calRange.end)
        .order('planned_date')
        .order('planned_start_time')
      if (error) throw error
      return (data ?? []) as ScheduledWorkout[]
    },
    enabled: !!userId,
  })

  // Calendar events for the visible feed range — shown inline with workouts but
  // de-emphasised. Tempo's own synced events are filtered out in getRangeEvents.
  const { data: events = [] } = useQuery<DayEvent[]>({
    queryKey: ['range_events', userId, feedRange.start, feedRange.end],
    queryFn: () => getRangeEvents(parseLocal(feedRange.start), parseLocal(feedRange.end)),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

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

  const { data: suggestion } = useQuery({
    queryKey: ['quick_suggestion', userId],
    queryFn: () => getQuickSuggestion(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // On entry: collapse duplicate days, then mark past-due 'scheduled' as 'missed'.
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

  // ── Derived feed ──────────────────────────────────────────────────────────--
  const workoutsByDate = useMemo(() => {
    const map: Record<string, ScheduledWorkout[]> = {}
    for (const w of workouts) {
      if (w.status === 'rescheduled' || w.status === 'skipped') continue
      ;(map[w.planned_date] ||= []).push(w)
    }
    return map
  }, [workouts])

  const eventsByDate = useMemo(() => {
    const map: Record<string, DayEvent[]> = {}
    for (const e of events) (map[toDateStr(e.start)] ||= []).push(e)
    return map
  }, [events])

  const feedDays = useMemo(
    () => (viewMode === 'week' ? weekDays.map(toDateStr) : [selectedDate]),
    [viewMode, weekDays, selectedDate],
  )

  const dayGroups = useMemo<DayGroup[]>(() => {
    return feedDays.map((ds) => {
      const isToday = ds === todayStr
      const ws = workoutsByDate[ds] ?? []
      const es = eventsByDate[ds] ?? []
      // The single most prominent item is TODAY's next workout (or today's first
      // if all are done). Only one hero on the whole screen.
      let heroId: string | null = null
      if (isToday && ws.length) heroId = (ws.find(w => w.status !== 'completed') ?? ws[0]).id
      const items: FeedItem[] = [
        ...ws.map(w => ({ kind: 'workout' as const, sort: minOfTime(w.planned_start_time), workout: w, hero: w.id === heroId })),
        ...es.map(e => ({ kind: 'event' as const, sort: minOfDate(e.start), event: e })),
      ].sort((a, b) => a.sort - b.sort)
      return { dateStr: ds, date: parseLocal(ds), isToday, items }
    })
  }, [feedDays, workoutsByDate, eventsByDate, todayStr])

  const feedHasItems = dayGroups.some(g => g.items.length > 0)

  // ── Actions ──────────────────────────────────────────────────────────────--
  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  const markCalendar = (id: string, eventId: string | null, provider: 'google' | 'device' | null) =>
    queryClient.setQueryData(workoutsKey, (old: ScheduledWorkout[] | undefined) =>
      old?.map(w => w.id === id ? { ...w, calendar_event_id: eventId, calendar_provider: provider } : w) ?? [])

  const openSettingsAlert = () =>
    Alert.alert('Permission Required', 'Allow calendar access in Settings to add workouts.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ])

  const addViaDevice = async (workout: ScheduledWorkout) => {
    const granted = await requestCalendarPermissions()
    if (!granted) { openSettingsAlert(); return }
    const res = await addWorkoutToCalendar(supabase, workout, userId, 'device')
    if (res.ok) markCalendar(workout.id, res.eventId, res.provider)
    else Alert.alert('Error', 'Could not add workout to your device calendar.')
  }

  const handleAddToCalendar = async (workout: ScheduledWorkout) => {
    const res = await addWorkoutToCalendar(supabase, workout, userId, profile?.preferred_calendar ?? null)
    if (res.ok) { markCalendar(workout.id, res.eventId, res.provider); return }
    if (res.reason === 'permission_denied') {
      openSettingsAlert()
    } else if (res.reason === 'none_connected') {
      Alert.alert('Connect a calendar', 'Choose where Tempo should add this workout.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Google Calendar', onPress: () => router.push('/smart-scheduler') },
        { text: 'Device Calendar', onPress: () => addViaDevice(workout) },
      ])
    } else {
      Alert.alert('Error', 'Could not add workout to calendar.')
    }
  }

  const handleRemoveFromCalendar = (workout: ScheduledWorkout) => {
    const where = workout.calendar_provider === 'google' ? 'Google Calendar' : 'your calendar'
    Alert.alert('Remove from Calendar?', `This will delete the event from ${where}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeWorkoutFromCalendar(supabase, workout, userId)
            markCalendar(workout.id, null, null)
          } catch {
            Alert.alert('Error', 'Could not remove calendar event.')
          }
        },
      },
    ])
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

  // Tapping a day: in Week mode the whole week is on screen, so scroll to that
  // day's section; in Day/Month mode it filters the feed to that day.
  const selectDay = (ds: string) => {
    setSelectedDate(ds)
    if (viewMode === 'week') {
      const y = sectionY.current[ds]
      if (y != null) setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }), 0)
    }
  }

  const shiftRange = (delta: number) => {
    if (viewMode === 'month') {
      const d = new Date(selDate.getFullYear(), selDate.getMonth() + delta, 1)
      const sameMonth = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
      setSelectedDate(sameMonth ? todayStr : toDateStr(d))
    } else {
      setSelectedDate(toDateStr(addDays(selDate, delta * (viewMode === 'week' ? 7 : 1))))
    }
  }

  const rangeLabel = useMemo(() => {
    if (viewMode === 'month') return selDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (viewMode === 'day') return selDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    const a = weekDays[0], b = weekDays[6]
    const sameMonth = a.getMonth() === b.getMonth()
    const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const right = b.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })
    return `${left} – ${right}`
  }, [viewMode, selDate, weekDays])

  const isThisRange = useMemo(() => {
    if (viewMode === 'month') return selDate.getFullYear() === today.getFullYear() && selDate.getMonth() === today.getMonth()
    if (viewMode === 'day') return selectedDate === todayStr
    return weekDays.some(d => toDateStr(d) === todayStr)
  }, [viewMode, selDate, selectedDate, weekDays, todayStr])

  const todayDateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Auto-scroll to today's section when the week feed first shows the current week.
  useEffect(() => {
    if (viewMode !== 'week' || !isThisRange) return
    const t = setTimeout(() => {
      const y = sectionY.current[todayStr]
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: false })
    }, 80)
    return () => clearTimeout(t)
  }, [viewMode, feedRange.start])

  // ── Render helpers ──────────────────────────────────────────────────────────
  const onboardingIncomplete = profile?.onboarding_complete === false

  function renderDayCell(day: Date, compact: boolean) {
    const ds = toDateStr(day)
    const dayWorkouts = workoutsByDate[ds] ?? []
    const isSelected = ds === selectedDate
    const isToday = ds === todayStr
    const inMonth = day.getMonth() === selDate.getMonth()
    const hasWorkout = dayWorkouts.length > 0
    const allDone = hasWorkout && dayWorkouts.every(w => w.status === 'completed')

    return (
      <TouchableOpacity
        key={ds}
        style={compact ? styles.gridCell : styles.weekCell}
        onPress={() => selectDay(ds)}
        activeOpacity={0.7}
      >
        {!compact && <Text style={[styles.weekDow, isSelected && styles.weekDowActive]}>{DOW[day.getDay()]}</Text>}
        <View
          style={[
            styles.dayPill,
            compact && styles.dayPillGrid,
            isToday && !isSelected && styles.dayPillToday,
            isSelected && styles.dayPillSelected,
          ]}
        >
          <Text
            style={[
              styles.dayNum,
              compact && !inMonth && styles.dayNumMuted,
              isToday && !isSelected && styles.dayNumToday,
              isSelected && styles.dayNumSelected,
            ]}
          >
            {day.getDate()}
          </Text>
        </View>
        {hasWorkout ? (
          <View style={[styles.dayDot, allDone ? styles.dotDone : styles.dotWorkout, isSelected && styles.dotOnSelected]} />
        ) : (
          <View style={styles.dayDotPlaceholder} />
        )}
      </TouchableOpacity>
    )
  }

  function renderEvent(e: DayEvent) {
    return (
      <View style={styles.row}>
        <Text style={styles.railTime} numberOfLines={1}>{time12(e.start)}</Text>
        <View style={styles.eventCard}>
          <View style={styles.eventIconWrap}>
            <Ionicons name={eventIcon(e.title)} size={15} color={C.outline} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eventTitle} numberOfLines={1}>{e.title}</Text>
            <Text style={styles.eventTime}>{time12(e.start)} – {time12(e.end)}</Text>
          </View>
        </View>
      </View>
    )
  }

  function renderWorkout(w: ScheduledWorkout, hero: boolean) {
    const done = w.status === 'completed'
    const accent = done ? C.success : C.primary

    return (
      <View style={styles.row}>
        <Text style={[styles.railTime, styles.railTimeActive, { color: accent }]} numberOfLines={1}>
          {formatTime(w.planned_start_time)}
        </Text>
        <View style={[hero ? styles.heroCard : styles.workoutCard, done && styles.workoutCardDone, !hero && { borderLeftColor: accent }]}>
          {/* Faux-gradient glow: a soft accent blob behind the hero's content */}
          {hero && !done && <View pointerEvents="none" style={styles.heroBlob} />}
          {hero && !done && <View pointerEvents="none" style={styles.heroWash} />}

          <View style={styles.workoutTop}>
            <View style={[styles.badge, done ? styles.badgeDone : styles.badgeWorkout]}>
              <Ionicons name={done ? 'checkmark' : 'flash'} size={11} color={done ? C.success : C.primary} />
              <Text style={[styles.badgeText, { color: accent }]}>{done ? 'DONE' : hero ? "TODAY'S WORKOUT" : 'WORKOUT'}</Text>
            </View>
            <View style={[styles.dumbbell, { backgroundColor: done ? C.successSoft : C.primarySoft }]}>
              <Ionicons name="barbell" size={hero ? 18 : 16} color={accent} />
            </View>
          </View>

          <Text style={[hero ? styles.heroTitle : styles.workoutTitle, done && styles.workoutTitleDone]}>{w.focus}</Text>

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Ionicons name="time-outline" size={13} color={C.textSecondary} />
              <Text style={styles.metaText}>{formatTime(w.planned_start_time)}</Text>
            </View>
            <View style={styles.metaChip}>
              <Ionicons name="hourglass-outline" size={13} color={C.textSecondary} />
              <Text style={styles.metaText}>{w.planned_duration_min} min</Text>
            </View>
          </View>

          {!done && (
            <TouchableOpacity
              style={[styles.startBtn, hero && styles.startBtnHero]}
              onPress={() => router.push({ pathname: '/(tabs)/plan', params: { workoutId: w.id } })}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={14} color={C.onPrimary} />
              <Text style={styles.startBtnText}>Start Session</Text>
            </TouchableOpacity>
          )}

          <View style={styles.cardActions}>
            {w.calendar_event_id ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleRemoveFromCalendar(w)}>
                <Ionicons name="calendar" size={14} color={C.success} />
                <Text style={[styles.actionText, { color: C.success }]}>In Calendar</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleAddToCalendar(w)}>
                <Ionicons name="calendar-outline" size={14} color={C.textSecondary} />
                <Text style={styles.actionText}>Add to Calendar</Text>
              </TouchableOpacity>
            )}
            {!done && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => setEditingWorkout(w)}>
                <Ionicons name="create-outline" size={14} color={C.textSecondary} />
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    )
  }

  function groupHeaderLabel(g: DayGroup): string {
    if (g.isToday) return 'Today'
    if (g.dateStr === toDateStr(addDays(today, 1))) return 'Tomorrow'
    return g.date.toLocaleDateString('en-US', { weekday: 'long' })
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header — Tempo wordmark, readiness ring, profile avatar */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.wordmark}>Tempo</Text>
          <Text style={styles.headerDate}>{todayDateLabel}</Text>
        </View>

        <TouchableOpacity
          style={[styles.ring, { borderColor: checkin ? readinessColor(checkin.readiness) : C.outlineVariant }]}
          onPress={() => setShowRecovery(true)}
          activeOpacity={0.85}
        >
          {checkin ? (
            <Text style={[styles.ringValue, { color: readinessColor(checkin.readiness) }]}>{checkin.readiness}</Text>
          ) : (
            <Ionicons name="pulse" size={16} color={C.primary} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.avatar, { backgroundColor: avatar.color }]}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.85}
        >
          {avatar.imageUri ? (
            <Image source={{ uri: avatar.imageUri }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Ionicons name={avatar.icon as IconName} size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Day / Week / Month filter */}
      <View style={styles.segment}>
        {(['day', 'week', 'month'] as ViewMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segmentBtn, viewMode === m && styles.segmentBtnActive]}
            onPress={() => setViewMode(m)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, viewMode === m && styles.segmentTextActive]}>
              {m === 'day' ? 'Day' : m === 'week' ? 'Week' : 'Month'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} />}
      >
        {/* Range header + navigation */}
        <View style={styles.rangeRow}>
          <Text style={styles.rangeText}>{rangeLabel}</Text>
          <View style={styles.rangeNav}>
            {!isThisRange && (
              <TouchableOpacity style={styles.todayChip} onPress={() => setSelectedDate(todayStr)}>
                <Text style={styles.todayChipText}>Today</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => shiftRange(-1)} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={C.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => shiftRange(1)} hitSlop={8}>
              <Ionicons name="chevron-forward" size={22} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Calendar — weekly strip (day/week) or month grid (month) */}
        {viewMode === 'month' ? (
          <View style={styles.grid}>
            <View style={styles.gridDowRow}>
              {DOW.map((d, i) => <Text key={i} style={styles.gridDowLabel}>{d}</Text>)}
            </View>
            <View style={styles.gridBody}>
              {monthGrid.map(day => renderDayCell(day, true))}
            </View>
          </View>
        ) : (
          <View style={styles.weekStrip}>
            {weekDays.map(day => renderDayCell(day, false))}
          </View>
        )}

        {/* Quick Workout — the wedge: build a session for the time you have */}
        <TouchableOpacity style={styles.quickRow} onPress={() => goQuick(suggestion)} activeOpacity={0.9}>
          <View style={styles.quickIcon}>
            <Ionicons name={(suggestion?.icon as IconName) ?? 'flash'} size={18} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle} numberOfLines={1}>{suggestion?.headline ?? 'Quick Workout'}</Text>
            <Text style={styles.quickSub} numberOfLines={1}>{suggestion?.sub ?? 'Build a session for the minutes you have.'}</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={C.primary} />
        </TouchableOpacity>

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

        {/* Unified feed — workouts (emphasised) + events (muted), one timeline */}
        {isLoading ? (
          <View style={styles.feed}><LoadingCard /></View>
        ) : isError ? (
          <View style={styles.feed}><ErrorBanner message="Failed to load your schedule." onRetry={refetch} /></View>
        ) : onboardingIncomplete ? (
          <View style={styles.emptyState}>
            <TouchableOpacity style={styles.setupBtn} onPress={() => router.push('/onboarding/goal')}>
              <Text style={styles.setupBtnText}>Complete setup to get your plan →</Text>
            </TouchableOpacity>
          </View>
        ) : !feedHasItems ? (
          <View style={styles.emptyState}>
            <Ionicons name="moon-outline" size={26} color={C.outline} />
            <Text style={[styles.emptyText, { marginTop: Spacing.xs }]}>
              {workouts.length === 0
                ? 'Your plan is loading. Pull down to refresh.'
                : 'Nothing scheduled here — enjoy the recovery.'}
            </Text>
          </View>
        ) : (
          dayGroups.map((g) => {
            // Day mode already names the day in the range row; week/month show a per-day header.
            const single = viewMode === 'day'
            return (
              <View
                key={g.dateStr}
                style={styles.dayGroup}
                onLayout={(e: LayoutChangeEvent) => { sectionY.current[g.dateStr] = e.nativeEvent.layout.y }}
              >
                {/* Day header — omitted in single-day modes (the range row already says the day) */}
                {!single && (
                  <View style={styles.groupHeader}>
                    <Text style={[styles.groupTitle, g.isToday && styles.groupTitleToday]}>{groupHeaderLabel(g)}</Text>
                    <Text style={styles.groupDate}>{g.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    {g.isToday && <View style={styles.liveDot} />}
                  </View>
                )}

                {g.items.length === 0 ? (
                  <View style={styles.restRow}>
                    <Ionicons name="moon-outline" size={15} color={C.outline} />
                    <Text style={styles.restText}>Rest day — recovery is part of the plan.</Text>
                  </View>
                ) : (
                  <View style={styles.groupItems}>
                    {g.items.map((item) => (
                      <View key={item.kind === 'workout' ? `w-${item.workout.id}` : `e-${item.event.id}`}>
                        {item.kind === 'workout'
                          ? renderWorkout(item.workout, item.hero)
                          : renderEvent(item.event)}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )
          })
        )}

      </ScrollView>

      {/* FAB — one-tap Quick Workout from anywhere on the schedule */}
      <TouchableOpacity style={styles.fab} onPress={() => goQuick(suggestion)} activeOpacity={0.9}>
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

      <EditWorkoutSheet
        visible={editingWorkout !== null}
        workout={editingWorkout}
        userId={userId}
        client={supabase}
        preferredCalendar={profile?.preferred_calendar ?? null}
        onClose={() => setEditingWorkout(null)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
          queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingBottom: 140 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  wordmark: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, color: C.text, letterSpacing: -0.6 },
  headerDate: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, marginTop: 1 },
  ring: {
    width: 40, height: 40, borderRadius: Radius.full,
    borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
  },
  ringValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, letterSpacing: -0.3 },
  avatar: {
    width: 40, height: 40, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },

  // ── Segmented filter ──────────────────────────────────────────────────────--
  segment: {
    flexDirection: 'row',
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.xs,
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: Radius.sm + 4 },
  segmentBtnActive: { backgroundColor: C.primary },
  segmentText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  segmentTextActive: { color: C.onPrimary },

  // ── Range row ──────────────────────────────────────────────────────────────
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  rangeText: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text, letterSpacing: -0.3 },
  rangeNav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  todayChip: {
    backgroundColor: C.primarySoft,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  todayChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },

  // ── Weekly strip ──────────────────────────────────────────────────────────--
  weekStrip: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.md,
  },
  weekCell: { flex: 1, alignItems: 'center', gap: 5 },
  weekDow: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline, letterSpacing: 0.4 },
  weekDowActive: { color: C.primary },
  dayPill: {
    width: 38, height: 38, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'transparent',
  },
  dayPillToday: { borderColor: C.primary },
  dayPillSelected: { backgroundColor: C.primary, borderColor: C.primary },
  dayNum: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  dayNumToday: { color: C.primary },
  dayNumSelected: { color: C.onPrimary },
  dayNumMuted: { color: C.outline },
  dayDot: { width: 5, height: 5, borderRadius: Radius.full },
  dotWorkout: { backgroundColor: C.primary },
  dotDone: { backgroundColor: C.success },
  dotOnSelected: { backgroundColor: '#FFFFFF' },
  dayDotPlaceholder: { width: 5, height: 5 },

  // ── Month grid ──────────────────────────────────────────────────────────────
  grid: { paddingHorizontal: Spacing.containerPadding, marginBottom: Spacing.md },
  gridDowRow: { flexDirection: 'row', marginBottom: Spacing.xs },
  gridDowLabel: { flex: 1, textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline },
  gridBody: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, gap: 3 },
  dayPillGrid: { width: 34, height: 34 },

  // ── Quick Workout ──────────────────────────────────────────────────────────
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.sm,
    backgroundColor: C.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: C.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  quickIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  quickTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, letterSpacing: -0.1 },
  quickSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },

  // ── Missed banner ──────────────────────────────────────────────────────────
  missedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.sm,
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

  // ── Feed / day groups ──────────────────────────────────────────────────────
  feed: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm },
  dayGroup: { paddingHorizontal: Spacing.containerPadding, marginTop: Spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm, marginTop: Spacing.xs },
  groupTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.textSecondary, letterSpacing: 0.2 },
  groupTitleToday: { color: C.text },
  groupDate: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.outline },
  liveDot: { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: C.success },
  groupItems: { gap: Spacing.sm },

  restRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
  },
  restText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.outline },

  // ── Timeline rows (shared rail) ──────────────────────────────────────────────
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  railTime: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, width: 52, paddingTop: 13 },
  railTimeActive: { fontFamily: 'Inter_700Bold' },

  // ── Muted event card ──────────────────────────────────────────────────────--
  eventCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  eventIconWrap: {
    width: 30, height: 30, borderRadius: Radius.sm + 4,
    backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
  },
  eventTitle: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  eventTime: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, marginTop: 1 },

  // ── Emphasised workout card ──────────────────────────────────────────────────
  workoutCard: {
    flex: 1,
    backgroundColor: C.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    borderLeftWidth: 5,
    borderLeftColor: C.primary,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...CardShadow,
  },
  workoutCardDone: { opacity: 0.72 },

  // Hero — today's workout, the single most prominent item on the screen.
  heroCard: {
    flex: 1,
    backgroundColor: C.background,
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderColor: C.primary,
    padding: Spacing.lg,
    gap: Spacing.sm,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 10,
  },
  heroWash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.primarySoft },
  heroBlob: {
    position: 'absolute', top: -60, right: -50,
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(61,130,247,0.22)',
  },

  workoutTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: Spacing.xs, paddingVertical: 4,
  },
  badgeWorkout: { backgroundColor: C.primarySoft },
  badgeDone: { backgroundColor: C.successSoft },
  badgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, letterSpacing: 0.6 },
  dumbbell: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },

  workoutTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.text, lineHeight: 26, letterSpacing: -0.3 },
  heroTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 27, color: C.text, lineHeight: 32, letterSpacing: -0.5 },
  workoutTitleDone: { textDecorationLine: 'line-through', color: C.textSecondary },

  metaRow: { flexDirection: 'row', gap: Spacing.sm },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  metaText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },

  startBtn: {
    backgroundColor: C.primary, borderRadius: Radius.lg, height: 46,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    marginTop: 2,
  },
  startBtnHero: { height: 52 },
  startBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.onPrimary, letterSpacing: 0.3 },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },

  // ── States ────────────────────────────────────────────────────────────────--
  emptyState: { paddingVertical: Spacing.xl, paddingHorizontal: Spacing.containerPadding, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center' },
  setupBtn: { backgroundColor: C.primary, borderRadius: Radius.lg, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  setupBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary, textAlign: 'center' },

  // ── FAB ──────────────────────────────────────────────────────────────────--
  fab: {
    position: 'absolute',
    bottom: 100,
    right: Spacing.containerPadding,
    width: 56, height: 56, borderRadius: Radius.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
})
