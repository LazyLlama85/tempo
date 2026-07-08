import { useState, useRef, useMemo, useEffect } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, RefreshControl, Alert, Linking, type LayoutChangeEvent } from 'react-native'
import { LoadingCard } from '@/components/LoadingCard'
import { ErrorBanner } from '@/components/ErrorBanner'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useRefreshOnFocus } from '@/hooks/useRefreshOnFocus'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { PressableScale, FadeInView, ScreenTransition } from '@/components/motion'
import { TempoWordmark } from '@/components/brand'
import { AnimatedRing } from '@/components/AnimatedRing'
import { EmptyState } from '@/components/EmptyState'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { requestCalendarPermissions, type DayEvent } from '@/services/calendarService'
import { addWorkoutToCalendar, removeWorkoutFromCalendar, getCalendarEventsForRange } from '@/services/calendarSync'
import { EditWorkoutSheet } from '@/components/EditWorkoutSheet'
import { AddWorkoutSheet } from '@/components/AddWorkoutSheet'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'
import { resolveCalendarConflicts, autoScheduleUpcoming } from '@/lib/autoSchedule'
import { refreshActiveSplit } from '@/lib/splitSchedule'
import { extendActivePlan } from '@/lib/generatePlan'
import { ensureAutoSplit } from '@/lib/splits'
import { syncTravelSchedule } from '@/lib/travelSchedule'
import { syncUpcomingWorkouts } from '@/lib/calendarAutoSync'
import {
  scheduleWorkoutReminders, cancelWorkoutReminder, cancelAllReminders, hasReminderPermission,
  type ScheduledWorkout as ReminderWorkout,
} from '@/lib/notifications'
import { resyncMovedWorkout } from '@/lib/moveWorkout'
import { describeSaveError } from '@/lib/saveErrors'
import { dedupeScheduledWorkouts } from '@/lib/dedupeSchedule'
import { suggestNextSlot, rescheduleWorkout } from '@/lib/reschedule'
import { getQuickSuggestion } from '@/lib/quickSuggestion'
import { getTodayCheckin } from '@/lib/recovery'
import { RecoveryCheckIn } from '@/components/RecoveryCheckIn'
import { parseAvatar } from '@/lib/avatar'
import { getActiveTravelMode, describeTravelEquipment, describeTravelUntil } from '@/lib/travelMode'
import { restDayAdvice, consecutiveTrainingDays } from '@/lib/trainingLoad'
import { eventKey, getIgnoredEventKeys, setEventIgnored } from '@/lib/ignoredEvents'
import { workoutOrigin } from '@/lib/workoutOrigin'
import type { WorkoutSource } from '@/types'
import { useProgressStats } from '@/hooks/useProgressStats'
import { fetchMeasurements, computeWeightTrend } from '@/lib/bodyMeasurements'
import { projectGoal } from '@/lib/goalProjection'
import type { WeekProgression, AdaptationMode } from '@/lib/periodization'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build Muscle',
  fat_loss: 'Lose Fat',
  strength: 'Get Stronger',
  general_fitness: 'General Fitness',
  athletic: 'Athletic Performance',
}
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

// 'YYYY-MM-DD' → 'Today' / 'Tomorrow' / weekday, for the next-workout card.
function relativeDayLabel(dateStr: string): string {
  const today = new Date()
  if (dateStr === toDateStr(today)) return 'Today'
  if (dateStr === toDateStr(addDays(today, 1))) return 'Tomorrow'
  return parseLocal(dateStr).toLocaleDateString('en-US', { weekday: 'long' })
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

// A workout reads as "overdue" once an hour has passed since its start time and it's
// still unstarted today — the cue to gently say "you didn't do this — reschedule?".
const OVERDUE_AFTER_MIN = 60
function workoutStartMs(w: ScheduledWorkout): number {
  return new Date(`${w.planned_date}T${w.planned_start_time}`).getTime()
}
function isOverdueWorkout(w: ScheduledWorkout, nowMs: number, todayStr: string): boolean {
  if (w.status !== 'scheduled' || w.planned_date !== todayStr) return false
  return nowMs >= workoutStartMs(w) + OVERDUE_AFTER_MIN * 60_000
}
// A real calendar event that now overlaps this workout's time block (same day) — the
// "Soccer practice was added — move your workout?" case.
function conflictingEvent(w: ScheduledWorkout, events: DayEvent[]): DayEvent | null {
  const start = workoutStartMs(w)
  const end = start + w.planned_duration_min * 60_000
  for (const e of events) if (start < e.end.getTime() && e.start.getTime() < end) return e
  return null
}

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

function readinessColor(n: number, C: Palette): string {
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
  source: WorkoutSource | null
  exercise_ids: string[]
  planned_duration_min: number
  actual_duration_min: number | null
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
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
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
  const [addWorkoutOpen, setAddWorkoutOpen] = useState(false)
  // Ticks every minute so a workout flips to "overdue" an hour after its start
  // without needing a manual refresh.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

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
    // Paging the visible week/month keeps the previous range on screen instead
    // of flashing a skeleton while the new range loads.
    placeholderData: keepPreviousData,
  })

  // A tab switch is not a "mount", so without this the schedule (and everything
  // derived from it) could sit stale until some other screen refetched the same
  // keys — the old "doesn't load until I leave and come back" bug.
  useRefreshOnFocus(
    ['scheduled_workouts'], ['missed_workouts'], ['next_workout'], ['block_phase'],
    ['recovery_today'], ['quick_suggestion'], ['rest_advice'],
    ['progress_workouts'], ['progress_set_logs'], ['goal_projection'], ['travel_mode'],
  )

  // Calendar events for the visible feed range — shown inline with workouts but
  // de-emphasised. Pulls from EVERY connected calendar (device + in-app Google),
  // so a meeting on the user's Google Calendar shows up here even when Google was
  // connected in-app rather than mirrored into iOS. Tempo's own synced workouts
  // are filtered out (they render from scheduled_workouts).
  const { data: events = [] } = useQuery<DayEvent[]>({
    queryKey: ['range_events', userId, feedRange.start, feedRange.end],
    queryFn: () => getCalendarEventsForRange(parseLocal(feedRange.start), parseLocal(feedRange.end)),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
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

  const { data: travel } = useQuery({
    queryKey: ['travel_mode', userId],
    queryFn: () => getActiveTravelMode(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // Where the user is in their training block right now — the next plan workout's
  // progression directive plus the plan's adaptation mode. Drives the phase banner
  // so the periodization (overload / deload / recovery) is visible, not hidden.
  const { data: blockPhase } = useQuery({
    queryKey: ['block_phase', userId, todayStr],
    queryFn: async () => {
      const [{ data: plan }, { data: nextW }] = await Promise.all([
        supabase.from('user_plans').select('adaptation_mode')
          .eq('user_id', userId).eq('status', 'active')
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('scheduled_workouts').select('progression, week_index')
          .eq('user_id', userId).eq('source', 'plan').eq('status', 'scheduled')
          .gte('planned_date', todayStr)
          .order('planned_date', { ascending: true }).limit(1).maybeSingle(),
      ])
      return {
        mode: (plan?.adaptation_mode ?? 'normal') as AdaptationMode,
        progression: (nextW?.progression ?? null) as WeekProgression | null,
      }
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // Aggregate stats (streak, benchMax, totals) — powers the rich empty state and
  // the goal countdown.
  const { stats } = useProgressStats(userId)

  // The very next workout regardless of the visible range, so an empty current week
  // never reads as "nothing here" — there's always a next step to show.
  const { data: nextWorkout } = useQuery({
    queryKey: ['next_workout', userId, todayStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('scheduled_workouts')
        .select('id, focus, planned_date, planned_start_time, planned_duration_min')
        .eq('user_id', userId).eq('status', 'scheduled')
        .gte('planned_date', todayStr)
        .order('planned_date', { ascending: true }).order('planned_start_time', { ascending: true })
        .limit(1).maybeSingle()
      return (data ?? null) as { id: string; focus: string; planned_date: string; planned_start_time: string; planned_duration_min: number } | null
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  })

  // Goal countdown — projects an ETA from the weight trend (+ strength max for
  // strength goals). Cached; null when there isn't enough signal.
  const { data: projection } = useQuery({
    queryKey: ['goal_projection', userId, profile?.goal, stats.benchMax],
    queryFn: async () => {
      let weightPerWeek: number | null = null
      try { weightPerWeek = computeWeightTrend(await fetchMeasurements(supabase, userId, 90)).lbsPerWeek } catch {}
      if (!profile) return null
      return projectGoal({
        goal: profile.goal,
        experience: profile.experience,
        weightPerWeek,
        benchMax: stats.benchMax || null,
      })
    },
    enabled: !!userId && !!profile,
    staleTime: 5 * 60 * 1000,
  })

  // Events the user has crossed off ("ignore") — Tempo may schedule over these. Stored
  // as a Set of content keys; the timeline shows them struck through with an Undo.
  const { data: ignoredKeys = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ['ignored_events', userId],
    queryFn: () => getIgnoredEventKeys(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // Rest-day recommendation — looks at the recent unbroken training run and whether
  // today already has a session, then advises rest when recovery is overdue.
  const { data: restAdvice } = useQuery({
    queryKey: ['rest_advice', userId],
    queryFn: async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const since = new Date(today); since.setDate(today.getDate() - 8)
      const { data } = await supabase
        .from('scheduled_workouts')
        .select('planned_date, status')
        .eq('user_id', userId)
        .gte('planned_date', toDateStr(since))
        .lte('planned_date', toDateStr(today))
      const rows = (data ?? []) as { planned_date: string; status: string }[]
      const trained = new Set(rows.filter(r => r.status === 'completed').map(r => r.planned_date))
      const trainsToday = rows.some(r => r.planned_date === toDateStr(today) && (r.status === 'scheduled' || r.status === 'completed'))
      return restDayAdvice(consecutiveTrainingDays(trained, today), trainsToday)
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // The wedge, on Home where it belongs: a contextual Quick Workout suggestion
  // (free calendar gap / recently missed session / momentum restart). Returns null
  // whenever today already has an actionable session, so it never competes with
  // the hero workout card.
  const { data: quickSuggestion } = useQuery({
    queryKey: ['quick_suggestion', userId, todayStr],
    queryFn: () => getQuickSuggestion(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  // On entry: collapse duplicate days, then mark past-due 'scheduled' as 'missed'.
  useEffect(() => {
    if (!userId) return
    ;(async () => {
      // The plan never just ends: when the active plan's runway is short, lay the
      // next mesocycle block onto the calendar, then place its times around the
      // user's real day. Best-effort; a no-op while weeks of plan remain.
      let planAdded = 0
      try { planAdded = await extendActivePlan(supabase, userId) } catch { /* ignore */ }
      if (planAdded > 0) {
        try { await autoScheduleUpcoming(supabase, userId) } catch { /* keep template times */ }
      }
      // Keep the "My Splits" program mirror in sync with the active plan (backfills
      // it for users whose plan predates the split-mirror feature). Best-effort.
      if (profile?.goal) {
        try { await ensureAutoSplit(supabase, userId, profile.goal) } catch { /* ignore */ }
      }
      // If a custom split is active, roll its rolling horizon forward so upcoming
      // weeks are always populated. Best-effort; no-op when no split is active.
      let splitAdded = 0
      try { splitAdded = await refreshActiveSplit(supabase, userId, profile?.preferred_time_of_day ?? null) } catch { /* ignore */ }
      // Travel mode: adapt (or restore) every upcoming session to the equipment the
      // user has right now. Runs after plan/split materialization so freshly-added
      // rows get adapted too. Best-effort.
      let travelChanged = 0
      try { travelChanged = await syncTravelSchedule(supabase, userId) } catch { /* ignore */ }
      const removed = await dedupeScheduledWorkouts(supabase, userId)
      const missedCount = await checkMissedWorkouts(supabase, userId)
      // Quietly re-slot only the workouts a real calendar event now overlaps (same
      // day). Best-effort — a calendar/network hiccup never blocks the feed.
      let conflictsMoved = 0
      try { conflictsMoved = await resolveCalendarConflicts(supabase, userId) } catch { /* leave times as-is */ }
      if (removed > 0 || missedCount > 0 || conflictsMoved > 0 || splitAdded > 0 || planAdded > 0 || travelChanged > 0) {
        queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
      }
      queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })

      // Auto-add upcoming workouts to the user's calendar (when on + connected).
      // Best-effort; refresh the event layer if anything new landed.
      try {
        const added = await syncUpcomingWorkouts(supabase, userId, profile)
        if (added > 0) queryClient.invalidateQueries({ queryKey: ['range_events', userId] })
      } catch { /* never block the feed on a calendar hiccup */ }

      // Reminder reconciliation: sessions materialized after onboarding (split
      // horizon, plan rollover) and auto-moved times all get a correct 30-min
      // reminder. Only when permission already exists — this path never prompts.
      try {
        if (await hasReminderPermission()) {
          const horizon = toDateStr(addDays(new Date(), 14))
          const { data: upcoming } = await supabase
            .from('scheduled_workouts')
            .select('id, focus, planned_date, planned_start_time, planned_duration_min, status')
            .eq('user_id', userId)
            .eq('status', 'scheduled')
            .gte('planned_date', todayStr)
            .lte('planned_date', horizon)
          await cancelAllReminders()
          await scheduleWorkoutReminders((upcoming ?? []) as ReminderWorkout[])
        }
      } catch { /* reminders are best-effort */ }
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
    await Promise.all([
      refetch(),
      // Re-pull calendar events too, so a just-connected Google Calendar appears.
      queryClient.invalidateQueries({ queryKey: ['range_events', userId] }),
    ])
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

  // Serialize per-workout calendar adds — a double-tap must not create two events.
  const addingCalRef = useRef<Set<string>>(new Set())

  const addViaDevice = async (workout: ScheduledWorkout) => {
    const granted = await requestCalendarPermissions()
    if (!granted) { openSettingsAlert(); return }
    const res = await addWorkoutToCalendar(supabase, workout, userId, 'device')
    if (res.ok) markCalendar(workout.id, res.eventId, res.provider)
    else Alert.alert('Error', 'Could not add workout to your device calendar.')
  }

  const handleAddToCalendar = async (workout: ScheduledWorkout) => {
    if (addingCalRef.current.has(workout.id)) return
    addingCalRef.current.add(workout.id)
    try {
      await doAddToCalendar(workout)
    } finally {
      addingCalRef.current.delete(workout.id)
    }
  }

  const doAddToCalendar = async (workout: ScheduledWorkout) => {
    const res = await addWorkoutToCalendar(supabase, workout, userId, profile?.preferred_calendar ?? null)
    if (res.ok) { markCalendar(workout.id, res.eventId, res.provider); return }
    if (res.reason === 'permission_denied') {
      openSettingsAlert()
    } else if (res.reason === 'none_connected') {
      Alert.alert('Connect a calendar', 'Add this workout to your device calendar now, or connect Google Calendar in your profile.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Device Calendar', onPress: () => addViaDevice(workout) },
        { text: 'Calendar settings', onPress: () => router.push('/(tabs)/profile') },
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

  // Mark a workout skipped (after offering to reschedule instead — no shame, but a
  // clear "you didn't do this" outcome). Skipped workouts drop out of the feed.
  const handleSkip = (workout: ScheduledWorkout) => {
    Alert.alert(
      `Skip ${workout.focus}?`,
      "It'll be marked skipped. Rescheduling it keeps your week on track — want to do that instead?",
      [
        { text: 'Reschedule instead', onPress: () => handleReschedule(workout) },
        {
          text: 'Skip it', style: 'destructive', onPress: async () => {
            const { error } = await supabase.from('scheduled_workouts').update({ status: 'skipped' }).eq('id', workout.id).eq('user_id', userId)
            if (error) { const info = describeSaveError(error, 'skip this workout'); Alert.alert('Couldn’t skip', info.message); return }
            cancelWorkoutReminder(workout.id).catch(() => {})
            queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  const handleReschedule = async (workout: ScheduledWorkout) => {
    if (rescheduling) return
    setRescheduling(true)
    try {
      const slot = await suggestNextSlot(supabase, userId, workout.planned_duration_min, workout.id)
      if (!slot) {
        Alert.alert('No open days', 'Your next week is full. Complete or skip a workout to free up a slot.')
        return
      }
      // Lead with the recovery reasoning so the move feels coached, not random.
      const why = slot.reason
        ? `${slot.reason}.`
        : (slot.fromCalendar ? 'Tempo found this free window in your calendar.' : '')
      Alert.alert(
        'Reschedule workout',
        `Move "${workout.focus}" to ${slot.label}?${why ? `\n\n${why}` : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Move it',
            onPress: async () => {
              try {
                await rescheduleWorkout(supabase, userId, workout.id, slot)
                // Re-point the synced calendar event + pre-workout reminder at the
                // new slot, so the calendar never disagrees with the app.
                resyncMovedWorkout(supabase, userId, {
                  ...workout,
                  planned_date: slot.date,
                  planned_start_time: slot.start_time,
                }).catch(() => {})
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

  // Cross an event off (or restore it). Ignoring frees that time so Tempo MAY place a
  // workout there; the event still shows, struck through, with an Undo. Optimistic so
  // the toggle feels instant, then persisted; scheduled workouts refresh so a later
  // re-slot can use the freed window.
  const toggleIgnoreEvent = async (e: DayEvent, currentlyIgnored: boolean) => {
    const key = eventKey(e.start, e.end)
    queryClient.setQueryData<Set<string>>(['ignored_events', userId], (old) => {
      const next = new Set(old ?? [])
      if (currentlyIgnored) next.delete(key); else next.add(key)
      return next
    })
    try {
      await setEventIgnored(supabase, userId, key, !currentlyIgnored)
      queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
    } catch {
      // Roll the optimistic toggle back on failure.
      queryClient.invalidateQueries({ queryKey: ['ignored_events', userId] })
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
      <PressableScale
        key={ds}
        style={compact ? styles.gridCell : styles.weekCell}
        onPress={() => selectDay(ds)}
        scaleTo={0.88}
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
      </PressableScale>
    )
  }

  function renderEvent(e: DayEvent) {
    const ignored = ignoredKeys.has(eventKey(e.start, e.end))
    return (
      <View style={styles.row}>
        <Text style={[styles.railTime, ignored && styles.railTimeIgnored]} numberOfLines={1}>{time12(e.start)}</Text>
        <View style={[styles.eventCard, ignored && styles.eventCardIgnored]}>
          <View style={styles.eventIconWrap}>
            <Ionicons name={ignored ? 'eye-off-outline' : eventIcon(e.title)} size={15} color={C.outline} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eventTitle, ignored && styles.eventTitleIgnored]} numberOfLines={1}>{e.title}</Text>
            <Text style={styles.eventTime}>
              {ignored ? 'Ignored · Tempo may schedule here' : `${time12(e.start)} – ${time12(e.end)}`}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.ignoreBtn}
            onPress={() => toggleIgnoreEvent(e, ignored)}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Ionicons name={ignored ? 'arrow-undo-outline' : 'close-circle-outline'} size={15} color={ignored ? C.primary : C.outline} />
            <Text style={[styles.ignoreBtnText, ignored && { color: C.primary }]}>{ignored ? 'Undo' : 'Ignore'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  function renderWorkout(w: ScheduledWorkout, hero: boolean) {
    const done = w.status === 'completed'
    const overdue = isOverdueWorkout(w, nowMs, todayStr)
    const conflict = !done && !overdue ? conflictingEvent(w, eventsByDate[w.planned_date] ?? []) : null
    const attention = overdue || !!conflict
    // "Early" = the scheduled time is still more than ~45 min away (or it's a future
    // day). You can still train now, but the button says "Do it now instead" so it
    // doesn't pretend it's go-time.
    const early = !done && !attention && (workoutStartMs(w) - nowMs) / 60000 > 45
    const soft = attention || early
    const accent = done ? C.success : attention ? C.ember : C.primary

    return (
      <View style={styles.row}>
        <Text style={[styles.railTime, styles.railTimeActive, { color: accent }]} numberOfLines={1}>
          {formatTime(w.planned_start_time)}
        </Text>
        <View style={[hero ? styles.heroCard : styles.workoutCard, done && styles.workoutCardDone, attention && styles.workoutCardAttn, !hero && { borderLeftColor: accent }]}>
          {/* Faux-gradient glow: a soft accent blob behind the hero's content */}
          {hero && !done && !attention && <View pointerEvents="none" style={styles.heroBlob} />}
          {hero && !done && !attention && <View pointerEvents="none" style={styles.heroWash} />}

          <View style={styles.workoutTop}>
            <View style={[styles.badge, done ? styles.badgeDone : attention ? styles.badgeAttn : styles.badgeWorkout]}>
              <Ionicons name={done ? 'checkmark' : overdue ? 'alert-circle' : conflict ? 'warning' : 'flash'} size={11} color={accent} />
              <Text style={[styles.badgeText, { color: accent }]}>
                {done ? 'DONE' : overdue ? 'STILL ON FOR THIS?' : conflict ? 'CALENDAR CONFLICT' : hero ? "TODAY'S WORKOUT" : 'WORKOUT'}
              </Text>
            </View>
            <View style={[styles.dumbbell, { backgroundColor: done ? C.successSoft : attention ? C.emberSoft : C.primarySoft }]}>
              <Ionicons name="barbell" size={hero ? 18 : 16} color={accent} />
            </View>
          </View>

          <Text style={[hero ? styles.heroTitle : styles.workoutTitle, done && styles.workoutTitleDone]}>{w.focus}</Text>

          {overdue && (
            <Text style={styles.attnNote}>This was scheduled for {formatTime(w.planned_start_time)}. Want to do it tomorrow instead?</Text>
          )}
          {conflict && (
            <Text style={styles.attnNote}>“{conflict.title}” now overlaps this workout. Move it to a free slot?</Text>
          )}

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Ionicons name="time-outline" size={13} color={C.textSecondary} />
              <Text style={styles.metaText}>{formatTime(w.planned_start_time)}</Text>
            </View>
            <View style={styles.metaChip}>
              <Ionicons name="hourglass-outline" size={13} color={C.textSecondary} />
              {/* Completed: show how long it actually took; otherwise the estimate. */}
              <Text style={styles.metaText}>{(done && w.actual_duration_min ? w.actual_duration_min : w.planned_duration_min)} min</Text>
            </View>
            {(() => {
              const origin = workoutOrigin(w.source)
              return (
                <View style={[styles.originChip, origin.byTempo ? styles.originChipTempo : styles.originChipYours]}>
                  <Ionicons name={origin.icon as any} size={11} color={origin.byTempo ? C.primary : C.textSecondary} />
                  <Text style={[styles.originText, { color: origin.byTempo ? C.primary : C.textSecondary }]}>{origin.short}</Text>
                </View>
              )
            })()}
          </View>

          {attention && (
            <PressableScale
              style={[styles.startBtn, styles.rescheduleBtn, rescheduling && { opacity: 0.6 }]}
              onPress={() => handleReschedule(w)}
              disabled={rescheduling}
            >
              <Ionicons name="calendar" size={14} color={C.onPrimary} />
              <Text style={styles.startBtnText}>{conflict ? 'Move to a free slot' : 'Reschedule'}</Text>
            </PressableScale>
          )}

          {!done && (
            <PressableScale
              style={[soft ? styles.startBtnGhost : styles.startBtn, !soft && hero && styles.startBtnHero]}
              onPress={() => router.push({ pathname: '/(tabs)/plan', params: { workoutId: w.id } })}
            >
              <Ionicons name="play" size={14} color={soft ? C.primary : C.onPrimary} />
              <Text style={[styles.startBtnText, soft && { color: C.primary }]}>
                {overdue ? 'Start it now anyway' : early ? 'Do it now instead' : 'Start Session'}
              </Text>
            </PressableScale>
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
            {done && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => router.push({ pathname: '/session-detail', params: { scheduledId: w.id } } as any)}
              >
                <Ionicons name="receipt-outline" size={14} color={C.textSecondary} />
                <Text style={styles.actionText}>Details</Text>
              </TouchableOpacity>
            )}
            {overdue && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => handleSkip(w)}>
                <Ionicons name="close-circle-outline" size={14} color={C.ember} />
                <Text style={[styles.actionText, { color: C.ember }]}>Skip</Text>
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
      <ScreenTransition>
      {/* Header — Tempo wordmark, readiness ring, profile avatar */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <TempoWordmark size={24} />
          <Text style={styles.headerDate}>{todayDateLabel}</Text>
        </View>

        <TouchableOpacity
          style={[styles.ring, { borderColor: checkin ? readinessColor(checkin.readiness, C) : C.outlineVariant }]}
          onPress={() => setShowRecovery(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={checkin ? `Recovery readiness ${checkin.readiness} of 100. Tap to check in.` : 'Daily recovery check-in'}
        >
          {checkin ? (
            <Text style={[styles.ringValue, { color: readinessColor(checkin.readiness, C) }]}>{checkin.readiness}</Text>
          ) : (
            <Ionicons name="pulse" size={16} color={C.primary} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.avatar, { backgroundColor: avatar.color }]}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
        >
          {avatar.imageUri ? (
            <Image source={{ uri: avatar.imageUri }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Ionicons name={avatar.icon as IconName} size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Signature: a short amber tick + hairline under the masthead — the
          hand-ruled line at the top of a training journal page. */}
      <View style={styles.craftRuleRow}>
        <View style={styles.craftRuleTick} />
        <View style={styles.craftRuleLine} />
      </View>

      {/* Day / Week / Month filter */}
      <View style={styles.segment}>
        {(['day', 'week', 'month'] as ViewMode[]).map((m) => (
          <PressableScale
            key={m}
            style={[styles.segmentBtn, viewMode === m && styles.segmentBtnActive]}
            onPress={() => setViewMode(m)}
            scaleTo={0.94}
          >
            <Text style={[styles.segmentText, viewMode === m && styles.segmentTextActive]}>
              {m === 'day' ? 'Day' : m === 'week' ? 'Week' : 'Month'}
            </Text>
          </PressableScale>
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} />}
      >
        {travel && (
          <PressableScale style={styles.travelBanner} onPress={() => router.push('/travel-mode')} scaleTo={0.98}>
            <Ionicons name="airplane" size={16} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.travelBannerText}>
                Workouts adjusted for {describeTravelEquipment(travel.equipment)}
              </Text>
              <Text style={styles.travelBannerSub}>Travel mode · {describeTravelUntil(travel.until)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.outline} />
          </PressableScale>
        )}

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

        {/* Calendar — weekly strip (day/week) or month grid (month). Keyed by view
            so switching Day/Week/Month crossfades instead of snapping. */}
        <FadeInView key={viewMode} duration={240}>
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
        </FadeInView>

        {/* Block phase — tap to see the full "why this week" explanation */}
        {blockPhase?.progression && (
          <PressableScale
            style={[styles.phaseBanner, blockPhase.progression.isDeload && styles.phaseBannerDeload]}
            onPress={() => router.push('/plan-explainer' as any)} /* typed-routes regen on next run */
            scaleTo={0.98}
          >
            <View style={[styles.phaseIcon, blockPhase.progression.isDeload && { backgroundColor: C.successSoft }]}>
              <Ionicons
                name={blockPhase.progression.isDeload ? 'leaf' : blockPhase.progression.phase === 'peak' ? 'trending-up' : 'barbell'}
                size={18}
                color={blockPhase.progression.isDeload ? C.success : C.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.phaseTitle}>
                Week {blockPhase.progression.weekIndex + 1} · {blockPhase.progression.label}
                {(blockPhase.mode === 'recovery' || blockPhase.mode === 'deload') ? ' · auto-adjusted' : ''}
              </Text>
              <Text style={styles.phaseBody} numberOfLines={2}>{blockPhase.progression.note}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.outline} />
          </PressableScale>
        )}

        {/* Goal countdown — an ETA people can chase */}
        {projection && (
          <View style={styles.goalCard}>
            <View style={styles.goalIcon}>
              <Ionicons name={projection.icon as IconName} size={18} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.goalHeadline} numberOfLines={1}>{projection.headline}</Text>
              <Text style={styles.goalSub} numberOfLines={1}>{projection.sub}</Text>
              {projection.pct != null && (
                <View style={styles.goalTrack}>
                  <View style={[styles.goalFill, { width: `${Math.max(2, Math.min(100, projection.pct))}%` as `${number}%` }]} />
                </View>
              )}
            </View>
          </View>
        )}

        {/* Weekly progress report — prominent on Sun/Mon, when the recap lands best */}
        {stats.thisWeek > 0 && (today.getDay() === 0 || today.getDay() === 1) && (
          <PressableScale style={styles.reportRow} onPress={() => router.push('/weekly-report' as any)} scaleTo={0.98}>
            <View style={styles.reportIcon}>
              <Ionicons name="stats-chart" size={18} color={C.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Your weekly progress report</Text>
              <Text style={styles.reportSub} numberOfLines={1}>See how this week stacked up — and share it.</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={C.onPrimary} />
          </PressableScale>
        )}

        {/* Weekly target — the winnable loop for a 3×/week plan: rest days can't
            break it, and hitting it is a real achievement (unlike a daily streak). */}
        {!!profile?.days_per_week && (
          <View style={styles.weekTargetCard}>
            {/* The weekly ring — fills as sessions land, flips sage on target */}
            <AnimatedRing
              value={Math.min(100, Math.round((stats.thisWeek / profile.days_per_week) * 100))}
              size={46}
              stroke={5}
              color={stats.thisWeek >= profile.days_per_week ? C.success : C.primary}
              holeColor={C.background}
            >
              <Text style={styles.weekTargetRingNum}>{stats.thisWeek}</Text>
            </AnimatedRing>
            <View style={{ flex: 1 }}>
              <Text style={styles.weekTargetLabel}>THIS WEEK</Text>
              <Text style={styles.weekTargetValue}>
                {stats.thisWeek} of {profile.days_per_week} sessions
                {stats.thisWeek >= profile.days_per_week ? ' — target hit!' : ''}
              </Text>
              <View style={styles.weekTargetTrack}>
                <View
                  style={[
                    styles.weekTargetFill,
                    stats.thisWeek >= profile.days_per_week && { backgroundColor: C.success },
                    { width: `${Math.min(100, Math.round((stats.thisWeek / profile.days_per_week) * 100))}%` as `${number}%` },
                  ]}
                />
              </View>
            </View>
          </View>
        )}

        {/* Quick Workout — the wedge: a contextual "this fits your day right now" */}
        {quickSuggestion && (
          <PressableScale
            style={styles.quickRow}
            onPress={() => router.push({
              pathname: '/quick-workout',
              params: {
                minutes: String(quickSuggestion.minutes),
                ...(quickSuggestion.purpose ? { purpose: quickSuggestion.purpose } : {}),
                ...(quickSuggestion.targetPattern ? { targetPattern: quickSuggestion.targetPattern } : {}),
                ...(quickSuggestion.daysSinceTrained != null ? { daysSinceTrained: String(quickSuggestion.daysSinceTrained) } : {}),
                ...(quickSuggestion.fromCalendarGap ? { fromCalendarGap: '1' } : {}),
              },
            })}
            scaleTo={0.98}
          >
            <View style={styles.quickIcon}>
              <Ionicons name={quickSuggestion.icon as IconName} size={18} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle} numberOfLines={1}>{quickSuggestion.headline}</Text>
              <Text style={styles.quickSub} numberOfLines={1}>{quickSuggestion.sub}</Text>
            </View>
            <Ionicons name="flash" size={18} color={C.primary} />
          </PressableScale>
        )}

        {/* Add Workout — schedule a saved workout, a template, or a new one onto this day */}
        <PressableScale style={styles.quickRow} onPress={() => setAddWorkoutOpen(true)} scaleTo={0.98}>
          <View style={styles.quickIcon}>
            <Ionicons name="add-circle-outline" size={18} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle} numberOfLines={1}>Add a workout</Text>
            <Text style={styles.quickSub} numberOfLines={1}>Schedule a saved workout, template, or a new one.</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={C.primary} />
        </PressableScale>

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
            <PressableScale
              style={[styles.missedBtn, rescheduling && { opacity: 0.6 }]}
              onPress={() => handleReschedule(missed[0])}
              disabled={rescheduling}
              scaleTo={0.92}
            >
              <Text style={styles.missedBtnText}>Reschedule</Text>
            </PressableScale>
          </View>
        )}

        {/* Rest-day recommendation — clear, and only when recovery is actually due */}
        {restAdvice && (
          <View style={styles.restBanner}>
            <View style={styles.restIcon}>
              <Ionicons name="bed-outline" size={18} color={C.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.restTitle}>{restAdvice.title}</Text>
              <Text style={styles.restBody}>{restAdvice.body}</Text>
            </View>
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
          nextWorkout ? (
            // Never a dead screen: show the plan at a glance + one clear action.
            <View style={styles.planCard}>
              <View style={styles.planTopRow}>
                <Text style={styles.planEyebrow}>YOUR PLAN</Text>
                {profile?.goal ? <Text style={styles.planGoal}>{GOAL_LABELS[profile.goal] ?? 'Training'}</Text> : null}
              </View>
              <View style={styles.planChips}>
                {blockPhase?.progression && (
                  <View style={styles.planChip}>
                    <Ionicons name="podium-outline" size={13} color={C.primary} />
                    <Text style={styles.planChipText}>{blockPhase.progression.label} week</Text>
                  </View>
                )}
                {stats.streak > 0 && (
                  <View style={styles.planChip}>
                    <Ionicons name="flame" size={13} color={C.primary} />
                    <Text style={styles.planChipText}>{stats.streak}-session streak</Text>
                  </View>
                )}
              </View>
              <View style={styles.planNext}>
                <Text style={styles.planNextLabel}>NEXT WORKOUT · {relativeDayLabel(nextWorkout.planned_date).toUpperCase()}</Text>
                <Text style={styles.planNextTitle}>{nextWorkout.focus}</Text>
                <Text style={styles.planNextMeta}>{formatTime(nextWorkout.planned_start_time)} · {nextWorkout.planned_duration_min} min</Text>
              </View>
              {relativeDayLabel(nextWorkout.planned_date) === 'Today' ? (
                <PressableScale
                  style={styles.planStartBtn}
                  onPress={() => router.push({ pathname: '/(tabs)/plan', params: { workoutId: nextWorkout.id } })}
                >
                  <Ionicons name="play" size={15} color={C.onPrimary} />
                  <Text style={styles.planStartText}>Start now</Text>
                </PressableScale>
              ) : (
                // Nothing scheduled today — the next session is on another day, so show
                // it as upcoming/locked rather than a Start button that misleads.
                <View style={styles.planLockedBtn}>
                  <Ionicons name="lock-closed" size={14} color={C.textSecondary} />
                  <Text style={styles.planLockedText}>Scheduled for {relativeDayLabel(nextWorkout.planned_date)}</Text>
                </View>
              )}
              <TouchableOpacity onPress={() => setAddWorkoutOpen(true)} activeOpacity={0.7}>
                <Text style={styles.planQuickText}>Want to train today? Add a workout →</Text>
              </TouchableOpacity>
            </View>
          ) : workouts.length === 0 ? (
            <EmptyState
              kind="calendar"
              title="Your week is a blank page"
              body="Add a workout to this day, or update your plan from Profile — Tempo schedules it around your real life."
              actionLabel="Add a workout"
              onAction={() => setAddWorkoutOpen(true)}
            />
          ) : (
            <EmptyState
              kind="moon"
              title="Nothing scheduled here"
              body="Enjoy the recovery — rest days are part of the plan, not a break from it."
              compact
            />
          )
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
                    {g.items.map((item, idx) => (
                      <FadeInView
                        key={item.kind === 'workout' ? `w-${item.workout.id}` : `e-${item.event.id}`}
                        delay={Math.min(idx * 45, 270)}
                      >
                        {item.kind === 'workout'
                          ? renderWorkout(item.workout, item.hero)
                          : renderEvent(item.event)}
                      </FadeInView>
                    ))}
                  </View>
                )}
              </View>
            )
          })
        )}

      </ScrollView>

      {/* FAB — one-tap Add Workout from anywhere on the schedule */}
      <PressableScale style={styles.fab} onPress={() => setAddWorkoutOpen(true)} scaleTo={0.9} accessibilityLabel="Add a workout">
        <Ionicons name="add" size={30} color={C.onPrimary} />
      </PressableScale>

      <AddWorkoutSheet
        visible={addWorkoutOpen}
        userId={userId}
        client={supabase}
        date={selectedDate}
        onClose={() => setAddWorkoutOpen(false)}
      />

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
    </ScreenTransition>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
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
  wordmark: { fontFamily: C.fontDisplay, fontSize: 26, color: C.text, letterSpacing: -0.6 },
  craftRuleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.containerPadding, marginBottom: Spacing.xs,
  },
  craftRuleTick: { width: 26, height: 3, borderRadius: 2, backgroundColor: C.primary },
  craftRuleLine: { flex: 1, height: 1, backgroundColor: C.outlineVariant },
  headerDate: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, marginTop: 1 },
  ring: {
    width: 40, height: 40, borderRadius: Radius.full,
    borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
  },
  ringValue: { fontFamily: C.fontDisplay, fontSize: 14, letterSpacing: -0.3 },
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
  travelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginHorizontal: Spacing.containerPadding, marginTop: Spacing.md,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  travelBannerText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  travelBannerSub: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, marginTop: 1 },
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

  // ── Weekly target ───────────────────────────────────────────────────────────
  weekTargetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding,
    marginBottom: Spacing.sm,
    backgroundColor: C.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  weekTargetRingNum: { fontFamily: C.fontDisplay, fontSize: 15, color: C.text },
  weekTargetLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  weekTargetValue: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, letterSpacing: -0.1, marginTop: 1 },
  weekTargetTrack: { height: 4, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full, marginTop: 6 },
  weekTargetFill: { height: 4, backgroundColor: C.primary, borderRadius: Radius.full },

  // ── Block-phase banner ───────────────────────────────────────────────────────
  phaseBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.sm,
    backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant,
    padding: Spacing.md,
  },
  phaseBannerDeload: { borderColor: C.success, backgroundColor: C.successSoft },
  phaseIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  phaseTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, letterSpacing: -0.1 },
  phaseBody: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 17 },

  // ── Goal countdown ───────────────────────────────────────────────────────────
  goalCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.sm,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    padding: Spacing.md,
  },
  goalIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  goalHeadline: { fontFamily: C.fontDisplay, fontSize: 15, color: C.text, letterSpacing: -0.2 },
  goalSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  goalTrack: { height: 6, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full, marginTop: 6, overflow: 'hidden' },
  goalFill: { height: 6, backgroundColor: C.primary, borderRadius: Radius.full },

  // ── Weekly report entry ──────────────────────────────────────────────────────
  reportRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.sm,
    backgroundColor: C.primary, borderRadius: Radius.lg, padding: Spacing.md,
  },
  reportIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  reportTitle: { fontFamily: C.fontDisplay, fontSize: 15, color: C.onPrimary, letterSpacing: -0.2 },
  reportSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 1 },

  // ── Rich empty state (plan at a glance) ──────────────────────────────────────
  planCard: {
    marginHorizontal: Spacing.containerPadding, marginTop: Spacing.sm,
    backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant,
    padding: Spacing.lg, gap: Spacing.sm, ...CardShadow,
  },
  planTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  planGoal: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  planChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  planChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  planChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },
  planNext: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 2, marginTop: 2 },
  planNextLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.5 },
  planNextTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  planNextMeta: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  planStartBtn: { height: 50, backgroundColor: C.primary, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: 2 },
  planStartText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
  planLockedBtn: { height: 50, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: 2, borderWidth: 1, borderColor: C.outlineVariant },
  planLockedText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textSecondary },
  planQuickText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.primary, textAlign: 'center', paddingVertical: 4 },

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

  // ── Rest-day banner ─────────────────────────────────────────────────────────
  restBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.sm,
    backgroundColor: C.successSoft, borderRadius: Radius.lg, padding: Spacing.md,
  },
  restIcon: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: C.background, alignItems: 'center', justifyContent: 'center',
  },
  restTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.success, letterSpacing: -0.1 },
  restBody: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 17 },

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
  eventCardIgnored: { opacity: 0.6, borderWidth: 1, borderColor: C.outlineVariant, borderStyle: 'dashed', backgroundColor: 'transparent' },
  eventTitleIgnored: { textDecorationLine: 'line-through' },
  railTimeIgnored: { textDecorationLine: 'line-through' },
  ignoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: Spacing.xs },
  ignoreBtnText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline },

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
  workoutCardAttn: { borderColor: C.ember, borderLeftColor: C.ember },

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
    backgroundColor: 'rgba(78,139,255,0.22)',
  },

  workoutTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: Spacing.xs, paddingVertical: 4,
  },
  badgeWorkout: { backgroundColor: C.primarySoft },
  badgeDone: { backgroundColor: C.successSoft },
  badgeAttn: { backgroundColor: C.emberSoft },
  badgeText: { fontFamily: C.fontDisplay, fontSize: 10, letterSpacing: 0.6 },
  attnNote: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  dumbbell: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },

  workoutTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, lineHeight: 26, letterSpacing: -0.3 },
  heroTitle: { fontFamily: C.fontDisplay, fontSize: 27, color: C.text, lineHeight: 32, letterSpacing: -0.5 },
  workoutTitleDone: { textDecorationLine: 'line-through', color: C.textSecondary },

  metaRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  metaText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },
  originChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderWidth: 1,
  },
  originChipTempo: { backgroundColor: C.primarySoft, borderColor: 'transparent' },
  originChipYours: { backgroundColor: C.surfaceContainerLow, borderColor: C.outlineVariant },
  originText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.3 },

  startBtn: {
    backgroundColor: C.primary, borderRadius: Radius.lg, height: 46,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    marginTop: 2,
  },
  startBtnHero: { height: 52 },
  rescheduleBtn: { backgroundColor: C.ember },
  startBtnGhost: {
    backgroundColor: 'transparent', borderRadius: Radius.lg, height: 44,
    borderWidth: 1, borderColor: C.outlineVariant,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: 2,
  },
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
