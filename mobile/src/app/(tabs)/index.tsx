import { useState, useRef, useMemo, useEffect, useCallback, type ReactNode } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, RefreshControl, Alert, Linking, AppState, type LayoutChangeEvent } from 'react-native'
import { LoadingCard } from '@/components/LoadingCard'
import { ErrorBanner } from '@/components/ErrorBanner'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useFocusEffect } from 'expo-router'
import { useRefreshOnFocus } from '@/hooks/useRefreshOnFocus'
import { useTutorialTarget } from '@/components/TutorialOverlay'
import { useTutorialStore } from '@/stores/tutorial'
import { T, HOME_TOUR_STEPS, TARGET, shouldShowTip } from '@/lib/tutorial'
import { Colors, Spacing, Radius, CardShadow, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { PressableScale, FadeInView, ScreenTransition } from '@/components/motion'
import { ScreenHeader, HeaderActions } from '@/components/brand'
import { AnimatedRing } from '@/components/AnimatedRing'
import { EmptyState } from '@/components/EmptyState'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { requestCalendarPermissions, type DayEvent } from '@/services/calendarService'
import { addWorkoutToCalendar, removeWorkoutFromCalendar, getCalendarEventsForRange } from '@/services/calendarSync'
import { googleCalendarNeedsReconnect } from '@/services/googleCalendar/CalendarAuthService'
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
import { suggestNextSlot, rescheduleWorkout, type SlotSuggestion } from '@/lib/reschedule'
import { getQuickSuggestion } from '@/lib/quickSuggestion'
import { getReturningState } from '@/lib/returningUser'
import { applyAdaptationMode } from '@/lib/adaptation'
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
import { OptionSheet } from '@/components/OptionSheet'
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

// A single "today's context" item. The whole Home feed used to stack up to eight of
// these as full-width cards; now only the highest-priority *eligible* one renders as
// a full banner (`primary`), and every other eligible one is demoted to a compact
// swipeable chip. The `eligible` flag mirrors each banner's ORIGINAL show condition
// exactly — this change only controls how many show at once and in what form, never
// WHEN a banner is allowed to appear. Array order = priority (first eligible wins the
// banner slot).
type ContextItem = {
  id: string
  eligible: boolean
  primary: () => ReactNode
  chip: { icon: IconName; label: string; tint: string; onPress: () => void }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
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
  const [skipSheetWorkout, setSkipSheetWorkout] = useState<ScheduledWorkout | null>(null)
  const [removeCalWorkout, setRemoveCalWorkout] = useState<ScheduledWorkout | null>(null)
  const [rescheduleConfirm, setRescheduleConfirm] = useState<{ workout: ScheduledWorkout; slot: SlotSuggestion; message: string } | null>(null)
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

  const { data: workouts = [], isLoading, isFetching, isError, refetch } = useQuery<ScheduledWorkout[]>({
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

  // First-run Home tour: spotlight targets (calendar + today's card here; the GO/
  // Progress/Profile targets live in the tab bar). Starts once, on first Home focus
  // after Welcome, only if armed — then never again.
  const calendarTarget = useTutorialTarget(TARGET.homeCalendar)
  const todayCardTarget = useTutorialTarget(TARGET.homeToday)
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => {
        const s = useTutorialStore.getState()
        const lastStep = HOME_TOUR_STEPS[HOME_TOUR_STEPS.length - 1].id
        if (!s.isStepDone('welcome_done')) return
        // Definitions (workout/split/generates-vs-schedules/etc.) come before the
        // spotlight tour — it explains WHAT things are; the tour then shows WHERE.
        // A one-off tip, not part of HOME_TOUR_STEPS, so it can't re-trigger the
        // spotlight tour for users who already completed it.
        if (shouldShowTip('how_tempo_works')) {
          router.push('/how-tempo-works' as any)
          return
        }
        if (s.isArmed(T.homeTour) && !s.isStepDone(lastStep) && !s.activeTour) {
          s.startTour(T.homeTour)
        }
      }, 650) // let the calendar + card measure first
      return () => clearTimeout(t)
    }, []),
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

  // getCalendarEventsForRange swallows Google fetch failures to an empty array
  // (so a calendar hiccup never blanks the whole feed) — which used to mean a
  // revoked/expired Google token made events silently vanish forever with no
  // hint why. Surface it here once the fetch has actually run.
  const [googleNeedsReconnect, setGoogleNeedsReconnect] = useState(false)
  useEffect(() => { setGoogleNeedsReconnect(googleCalendarNeedsReconnect()) }, [events])

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

  // Returning-user off-ramp (§5.1): after 3/7/30 days away, Home leads with a
  // "welcome back" banner instead of the guilt of a normal day. Reads existing data
  // (last completed session); null for daily users and brand-new users alike.
  const { data: returning } = useQuery({
    queryKey: ['returning', userId, todayStr],
    queryFn: () => getReturningState(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
  const [easingBack, setEasingBack] = useState(false)
  const handleEaseIntoRecovery = async () => {
    if (!userId || easingBack) return
    setEasingBack(true)
    try {
      await applyAdaptationMode(supabase, userId, 'recovery')
      // Re-stamped future weeks + the new mode → refresh everything that reads them.
      queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
      queryClient.invalidateQueries({ queryKey: ['block_phase', userId] })
      queryClient.invalidateQueries({ queryKey: ['returning', userId] })
      Alert.alert('Welcome back', "Your next few weeks are lighter now — trimmed volume so you ease back in. You can return to normal anytime from your plan.")
    } catch {
      Alert.alert('Could not adjust', 'Please try again in a moment.')
    } finally {
      setEasingBack(false)
    }
  }

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

  // The full entry sweep above only runs once per sign-in (auth.ts deliberately
  // skips it on TOKEN_REFRESHED, which fires on every foreground). That means a
  // workout that goes stale while the app just sits backgrounded across midnight
  // never gets flipped to 'missed' until the next cold start. Re-run just the
  // cheap missed-workout check (a single UPDATE) whenever the app comes back to
  // the foreground on a new calendar day — not the whole heavy sweep.
  const lastMissedCheckDate = useRef(todayStr)
  useEffect(() => {
    if (!userId) return
    const sub = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return
      const nowDateStr = toDateStr(new Date())
      if (nowDateStr === lastMissedCheckDate.current) return
      lastMissedCheckDate.current = nowDateStr
      checkMissedWorkouts(supabase, userId).then((count) => {
        if (count > 0) {
          queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
          queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
        }
      })
    })
    return () => sub.remove()
  }, [userId, queryClient])

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

  const handleRemoveFromCalendar = (workout: ScheduledWorkout) => setRemoveCalWorkout(workout)
  const doRemoveFromCalendar = async (workout: ScheduledWorkout) => {
    try {
      await removeWorkoutFromCalendar(supabase, workout, userId)
      markCalendar(workout.id, null, null)
    } catch {
      Alert.alert('Error', 'Could not remove calendar event.')
    }
  }

  // Mark a workout skipped (after offering to reschedule instead — no shame, but a
  // clear "you didn't do this" outcome). Skipped workouts drop out of the feed.
  const handleSkip = (workout: ScheduledWorkout) => setSkipSheetWorkout(workout)

  const skipWorkout = async (workout: ScheduledWorkout) => {
    const { error } = await supabase.from('scheduled_workouts').update({ status: 'skipped' }).eq('id', workout.id).eq('user_id', userId)
    if (error) { const info = describeSaveError(error, 'skip this workout'); Alert.alert('Couldn’t skip', info.message); return }
    cancelWorkoutReminder(workout.id).catch(() => {})
    queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
  }

  const onSkipSheetSelect = (key: string) => {
    const workout = skipSheetWorkout
    setSkipSheetWorkout(null)
    if (!workout) return
    if (key === 'reschedule') handleReschedule(workout)
    else if (key === 'skip') skipWorkout(workout)
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
      setRescheduleConfirm({ workout, slot, message: `Move "${workout.focus}" to ${slot.label}?${why ? `\n\n${why}` : ''}` })
    } catch {
      Alert.alert('Could not reschedule', 'We had trouble finding a new slot. Please try again.')
    } finally {
      setRescheduling(false)
    }
  }

  const confirmMoveWorkout = async () => {
    const confirm = rescheduleConfirm
    setRescheduleConfirm(null)
    if (!confirm) return
    const { workout, slot } = confirm
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
    const anyMissed = hasWorkout && !allDone && dayWorkouts.some(w => w.status === 'missed')

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
          <View style={[styles.dayDot, allDone ? styles.dotDone : anyMissed ? styles.dotMissed : styles.dotWorkout, isSelected && styles.dotOnSelected]} />
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
    const missed = w.status === 'missed'
    const overdue = isOverdueWorkout(w, nowMs, todayStr)
    const conflict = !done && !overdue ? conflictingEvent(w, eventsByDate[w.planned_date] ?? []) : null
    const attention = overdue || missed || !!conflict
    // "Early" = the scheduled time is still more than ~45 min away (or it's a future
    // day). You can still train now, but the button says "Do it now instead" so it
    // doesn't pretend it's go-time.
    const early = !done && !attention && (workoutStartMs(w) - nowMs) / 60000 > 45
    const soft = attention || early
    const accent = done ? C.success : missed ? C.error : attention ? C.ember : C.primary

    return (
      <View style={styles.row}>
        <Text style={[styles.railTime, styles.railTimeActive, { color: accent }]} numberOfLines={1}>
          {formatTime(w.planned_start_time)}
        </Text>
        <View collapsable={false} style={[hero ? styles.heroCard : styles.workoutCard, done && styles.workoutCardDone, attention && styles.workoutCardAttn, !hero && { borderLeftColor: accent }]}>
          {/* Faux-gradient glow: a soft accent blob behind the hero's content */}
          {hero && !done && !attention && <View pointerEvents="none" style={styles.heroBlob} />}
          {hero && !done && !attention && <View pointerEvents="none" style={styles.heroWash} />}

          <View style={styles.workoutTop}>
            <View style={[styles.badge, done ? styles.badgeDone : missed ? styles.badgeMissed : attention ? styles.badgeAttn : styles.badgeWorkout]}>
              <Ionicons name={done ? 'checkmark' : missed ? 'close-circle' : overdue ? 'alert-circle' : conflict ? 'warning' : 'flash'} size={11} color={accent} />
              <Text style={[styles.badgeText, { color: accent }]}>
                {done ? 'DONE' : missed ? 'MISSED' : overdue ? 'STILL ON FOR THIS?' : conflict ? 'CALENDAR CONFLICT' : hero ? "TODAY'S WORKOUT" : 'WORKOUT'}
              </Text>
            </View>
            <View style={[styles.dumbbell, { backgroundColor: done ? C.successSoft : missed ? C.dangerSoft : attention ? C.emberSoft : C.primarySoft }]}>
              <Ionicons name="barbell" size={hero ? 18 : 16} color={accent} />
            </View>
          </View>

          <Text style={[hero ? styles.heroTitle : styles.workoutTitle, (done || missed) && styles.workoutTitleDone]}>{w.focus}</Text>

          {missed && (
            <Text style={styles.attnNote}>This workout was missed. Reschedule it to get back on track, or skip it and move on.</Text>
          )}
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

  // ── Today's-context strip ─────────────────────────────────────────────────────
  // Collapses the old stack of contextual banners into ONE full banner (the top
  // eligible item) plus a swipeable chip strip for the rest. Priority is the array
  // order below; each `eligible` predicate is the banner's exact original gate.
  const goQuick = () =>
    quickSuggestion &&
    router.push({
      pathname: '/quick-workout',
      params: {
        minutes: String(quickSuggestion.minutes),
        ...(quickSuggestion.purpose ? { purpose: quickSuggestion.purpose } : {}),
        ...(quickSuggestion.targetPattern ? { targetPattern: quickSuggestion.targetPattern } : {}),
        ...(quickSuggestion.daysSinceTrained != null ? { daysSinceTrained: String(quickSuggestion.daysSinceTrained) } : {}),
        ...(quickSuggestion.fromCalendarGap ? { fromCalendarGap: '1' } : {}),
      },
    })

  const contextItems: ContextItem[] = [
    // 0 — Returning user (§5.1): the highest-leverage retention moment. After 3/7/30
    // days away, lead with a "welcome back" off-ramp ahead of every normal banner.
    // Disappears the instant they train again (last-completed becomes today).
    {
      id: 'returning',
      eligible: !!returning,
      primary: () => {
        if (!returning) return null
        const content =
          returning.tier === 'd30'
            ? { title: "It's been a while", sub: "Let's make sure your plan still fits.", cta: 'Review plan', icon: 'sparkles' as IconName, busy: false, onPress: () => router.push('/onboarding/goal') }
            : returning.tier === 'd7'
            ? { title: 'Welcome back', sub: 'Want a lighter week to ease back in?', cta: easingBack ? 'One sec…' : 'Ease me in', icon: 'leaf' as IconName, busy: easingBack, onPress: handleEaseIntoRecovery }
            : { title: 'Pick up where you left off', sub: `It's been ${returning.days} days — your next session is ready.`, cta: "Let's go", icon: 'play' as IconName, busy: false, onPress: () => router.push(returning.nextWorkoutId ? { pathname: '/(tabs)/plan', params: { workoutId: returning.nextWorkoutId } } : '/(tabs)/plan') }
        return (
          <View style={styles.missedBanner}>
            <View style={styles.missedIcon}>
              <Ionicons name={content.icon} size={18} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.missedTitle}>{content.title}</Text>
              <Text style={styles.missedSub}>{content.sub}</Text>
            </View>
            <PressableScale
              style={[styles.missedBtn, content.busy && { opacity: 0.6 }]}
              onPress={content.onPress}
              disabled={content.busy}
              scaleTo={0.92}
            >
              <Text style={styles.missedBtnText}>{content.cta}</Text>
            </PressableScale>
          </View>
        )
      },
      chip: {
        icon: 'sparkles',
        label: returning?.tier === 'd7' ? 'Welcome back' : returning?.tier === 'd30' ? 'Review plan' : 'Resume',
        tint: C.primary,
        onPress: () => {
          if (!returning) return
          if (returning.tier === 'd30') router.push('/onboarding/goal')
          else if (returning.tier === 'd7') handleEaseIntoRecovery()
          else router.push(returning.nextWorkoutId ? { pathname: '/(tabs)/plan', params: { workoutId: returning.nextWorkoutId } } : '/(tabs)/plan')
        },
      },
    },
    // 1 — Missed workout: a concrete recovery action about the user's own training.
    {
      id: 'missed',
      eligible: missed.length > 0,
      primary: () => missed.length > 0 ? (
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
      ) : null,
      chip: { icon: 'refresh', label: 'Missed workout', tint: C.primary, onPress: () => missed.length > 0 && handleReschedule(missed[0]) },
    },
    // 2 — Google reconnect: the calendar is silently showing incomplete data.
    {
      id: 'reconnect',
      eligible: googleNeedsReconnect,
      primary: () => (
        <PressableScale style={styles.missedBanner} onPress={() => router.push('/calendar-setup' as any)} scaleTo={0.98}>
          <View style={[styles.missedIcon, { backgroundColor: C.dangerSoft }]}>
            <Ionicons name="warning" size={18} color={C.error} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.missedTitle}>Google Calendar needs reconnecting</Text>
            <Text style={styles.missedSub}>Access expired, so its events stopped showing. Tap to reconnect.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.error} />
        </PressableScale>
      ),
      chip: { icon: 'warning', label: 'Reconnect calendar', tint: C.error, onPress: () => router.push('/calendar-setup' as any) },
    },
    // 3 — Travel mode: an active adaptation affecting every upcoming session.
    {
      id: 'travel',
      eligible: !!travel,
      primary: () => travel ? (
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
      ) : null,
      chip: { icon: 'airplane', label: 'Travel mode', tint: C.primary, onPress: () => router.push('/travel-mode') },
    },
    // 4 — Rest day: recovery recommendation. Outranks Quick Workout so we never push a
    // session when we're advising rest. Chip taps into the recovery check-in.
    {
      id: 'rest',
      eligible: !!restAdvice,
      primary: () => restAdvice ? (
        <View style={styles.restBanner}>
          <View style={styles.restIcon}>
            <Ionicons name="bed-outline" size={18} color={C.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.restTitle}>{restAdvice.title}</Text>
            <Text style={styles.restBody}>{restAdvice.body}</Text>
          </View>
        </View>
      ) : null,
      chip: { icon: 'bed-outline', label: 'Rest day', tint: C.success, onPress: () => setShowRecovery(true) },
    },
    // 5 — Block phase: where the user sits in the mesocycle (overload / deload).
    {
      id: 'block',
      eligible: !!blockPhase?.progression,
      primary: () => blockPhase?.progression ? (
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
      ) : null,
      chip: {
        icon: blockPhase?.progression?.isDeload ? 'leaf' : 'barbell',
        label: blockPhase?.progression ? `Week ${blockPhase.progression.weekIndex + 1} · ${blockPhase.progression.label}` : '',
        tint: blockPhase?.progression?.isDeload ? C.success : C.primary,
        onPress: () => router.push('/plan-explainer' as any),
      },
    },
    // 6 — Goal ETA: a motivational countdown. Chip taps into the Progress tab.
    {
      id: 'goal',
      eligible: !!projection,
      primary: () => projection ? (
        <View style={styles.goalCard}>
          <View style={[styles.goalIcon, { backgroundColor: C.goldSoft }]}>
            <Ionicons name={projection.icon as IconName} size={18} color={C.gold} />
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
      ) : null,
      chip: { icon: (projection?.icon as IconName) ?? 'flag', label: 'Goal ETA', tint: C.primary, onPress: () => router.push('/(tabs)/progress') },
    },
    // 7 — Weekly report: the Sun/Mon recap nudge (same gate as before).
    {
      id: 'report',
      eligible: stats.thisWeek > 0 && (today.getDay() === 0 || today.getDay() === 1),
      primary: () => (
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
      ),
      chip: { icon: 'stats-chart', label: 'Weekly report', tint: C.primary, onPress: () => router.push('/weekly-report' as any) },
    },
    // 8 — Quick Workout: opportunistic wedge (only fires when today has no actionable
    // session anyway, so it can safely sit last).
    {
      id: 'quick',
      eligible: !!quickSuggestion,
      primary: () => quickSuggestion ? (
        <PressableScale style={styles.quickRow} onPress={goQuick} scaleTo={0.98}>
          <View style={styles.quickIcon}>
            <Ionicons name={quickSuggestion.icon as IconName} size={18} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle} numberOfLines={1}>{quickSuggestion.headline}</Text>
            <Text style={styles.quickSub} numberOfLines={1}>{quickSuggestion.sub}</Text>
          </View>
          <Ionicons name="flash" size={18} color={C.primary} />
        </PressableScale>
      ) : null,
      chip: { icon: 'flash', label: 'Quick workout', tint: C.primary, onPress: goQuick },
    },
    // 9 — Connect calendar: first-time nudge for a user who never linked one, so auto
    // scheduling can place workouts around real events. Calendar connect moved out of
    // onboarding's required path, so this is where new users are invited to do it.
    // Lowest priority — it never outranks real training context, and disappears the
    // moment a calendar is set (preferred_calendar becomes non-null).
    {
      id: 'connectCalendar',
      eligible: !!profile && !profile.preferred_calendar,
      primary: () => (
        <PressableScale style={styles.missedBanner} onPress={() => router.push('/calendar-setup' as any)} scaleTo={0.98}>
          <View style={styles.missedIcon}>
            <Ionicons name="calendar-outline" size={18} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.missedTitle}>Connect your calendar</Text>
            <Text style={styles.missedSub}>Let Tempo schedule workouts around your real events.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.outline} />
        </PressableScale>
      ),
      chip: { icon: 'calendar-outline', label: 'Connect calendar', tint: C.primary, onPress: () => router.push('/calendar-setup' as any) },
    },
  ]

  const eligibleContext = contextItems.filter(i => i.eligible)
  const primaryContext = eligibleContext[0]
  const overflowContext = eligibleContext.slice(1)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
      {/* Header — Tempo wordmark + date, readiness ring, profile avatar. The
          signature amber tick + hairline rule is baked into ScreenHeader. */}
      <ScreenHeader
        subtitle={todayDateLabel}
        right={
          <HeaderActions>
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
          </HeaderActions>
        }
      />

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
        <View ref={calendarTarget} collapsable={false}>
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
        </View>

        {/* Today's-context strip — at most ONE full banner (the top-priority eligible
            item) plus a swipeable chip row for the rest. Replaces the old stack of up
            to eight independently-rendered banners. */}
        {primaryContext && (
          <View style={styles.contextStrip}>
            {primaryContext.primary()}
            {overflowContext.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipStripContent}
              >
                {overflowContext.map(i => (
                  <PressableScale key={i.id} style={styles.contextChip} onPress={i.chip.onPress} scaleTo={0.94}>
                    <Ionicons name={i.chip.icon} size={14} color={i.chip.tint} />
                    <Text style={[styles.contextChipText, { color: i.chip.tint }]} numberOfLines={1}>{i.chip.label}</Text>
                  </PressableScale>
                ))}
              </ScrollView>
            )}
          </View>
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
          isFetching ? (
            // The range LOOKS empty but a fresh fetch is in flight (e.g. right
            // after Change Plan cleared the old schedule) — say "loading", never
            // show a rest-day/empty state that's about to be wrong.
            <View style={styles.feed}><LoadingCard /></View>
          ) : nextWorkout ? (
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
                // Step 2 of the Home tour anchors here (the stable "today" group, which
                // always renders in week/day view — even on a rest day). Previously the
                // target lived only on the hero card, so a new user whose first session
                // wasn't today had no measurable target and the spotlight fell back to a
                // generic centered card.
                ref={g.isToday ? todayCardTarget : undefined}
                collapsable={false}
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

      {/* FAB — one-tap Add Workout from anywhere on the schedule. Bottom offset is
          insets-aware so it always clears the floating tab dock (which itself sits
          on insets.bottom + ~30px of GO-button headroom) — a flat value here used to
          land right under the dock's hitSlop-expanded touch zone on some devices,
          making the bottom of the FAB visually crowd (and sometimes lose taps to)
          the Profile tab behind it. */}
      <PressableScale
        style={[styles.fab, { bottom: insets.bottom + 84 }]}
        onPress={() => setAddWorkoutOpen(true)}
        scaleTo={0.9}
        accessibilityLabel="Add a workout"
      >
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

      <OptionSheet
        visible={skipSheetWorkout !== null}
        title={`Skip ${skipSheetWorkout?.focus ?? ''}?`}
        subtitle="It'll be marked skipped. Rescheduling it keeps your week on track — want to do that instead?"
        options={[
          { key: 'reschedule', label: 'Reschedule instead', icon: 'calendar-outline' },
          { key: 'skip', label: 'Skip it', icon: 'close-circle-outline', destructive: true },
        ]}
        onSelect={onSkipSheetSelect}
        onClose={() => setSkipSheetWorkout(null)}
      />

      <OptionSheet
        visible={rescheduleConfirm !== null}
        title="Reschedule workout"
        subtitle={rescheduleConfirm?.message ?? ''}
        options={[{ key: 'move', label: 'Move it', icon: 'calendar-outline' }]}
        onSelect={confirmMoveWorkout}
        onClose={() => setRescheduleConfirm(null)}
      />

      <OptionSheet
        visible={removeCalWorkout !== null}
        title="Remove from Calendar?"
        subtitle={`This will delete the event from ${removeCalWorkout?.calendar_provider === 'google' ? 'Google Calendar' : 'your calendar'}.`}
        options={[{ key: 'remove', label: 'Remove', icon: 'trash-outline', destructive: true }]}
        onSelect={() => { const w = removeCalWorkout; setRemoveCalWorkout(null); if (w) void doRemoveFromCalendar(w) }}
        onClose={() => setRemoveCalWorkout(null)}
      />
    </ScreenTransition>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingBottom: 140 },

  // ── Header ──────────────────────────────────────────────────────────────────
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

  // ── Today's-context strip ─────────────────────────────────────────────────────
  // Container for the single priority banner + the swipeable overflow chips.
  contextStrip: {},
  chipStripContent: {
    flexDirection: 'row', gap: Spacing.xs,
    paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.sm,
  },
  contextChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.background,
    borderWidth: 1, borderColor: C.outlineVariant, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm + 2, paddingVertical: 7,
  },
  contextChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: -0.1, maxWidth: 180 },

  // ── Range row ──────────────────────────────────────────────────────────────
  // Travel banner is one of the context-strip banners; no top margin (it's never the
  // first element now) and a bottom margin to separate it from the overflow chips.
  travelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.sm,
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
  dotMissed: { backgroundColor: C.error },
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
    ...Elevation.e1,
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
    ...Elevation.e1,
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
    ...Elevation.e1,
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
    ...Elevation.e1,
  },
  goalIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  goalHeadline: { fontFamily: C.fontDisplay, fontSize: 15, color: C.text, letterSpacing: -0.2 },
  goalSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  goalTrack: { height: 6, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full, marginTop: 6, overflow: 'hidden' },
  goalFill: { height: 6, backgroundColor: C.gold, borderRadius: Radius.full },

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
    ...Elevation.e1,
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
    backgroundColor: C.primaryGlow,
  },

  workoutTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: Spacing.xs, paddingVertical: 4,
  },
  badgeWorkout: { backgroundColor: C.primarySoft },
  badgeDone: { backgroundColor: C.successSoft },
  badgeAttn: { backgroundColor: C.emberSoft },
  badgeMissed: { backgroundColor: C.dangerSoft },
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
  // `bottom` is set inline (insets-aware, clears the floating dock) — see caller.
  fab: {
    position: 'absolute',
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
