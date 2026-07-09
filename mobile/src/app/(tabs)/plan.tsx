import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Animated, Easing, LayoutAnimation, Modal,
  type StyleProp, type ViewStyle,
} from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useReducedMotion, PressableScale, PopIn, FadeInView, ScreenTransition } from '@/components/motion'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateTrainingData } from '@/lib/queryInvalidation'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { Avatar } from '@/components/Avatar'
import { TempoWordmark, PulseLoader } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { supabase } from '@/lib/supabase'
import { cancelWorkoutReminder, scheduleRestDoneNotification, cancelRestDoneNotification } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth'
import { buildPrescription, type ExercisePrescription, type SetPerformance } from '@/lib/progression'
import { getIntensityBias, refreshAdaptation, type IntensityBias } from '@/lib/adaptation'
import type { WeekProgression } from '@/lib/periodization'
import { getTodayReadiness } from '@/lib/recovery'
import { ExerciseFormSheet } from '@/components/ExerciseFormSheet'
import { ExercisePickerSheet } from '@/components/ExercisePickerSheet'
import { OptionSheet } from '@/components/OptionSheet'
import * as haptics from '@/lib/haptics'
import { getRestPref, setRestPref, SUGGESTED_REST_SEC } from '@/lib/restPrefs'
import { estimateSessionSec, estimateSessionMin, adaptiveRemainingSec, fetchPaceFactor, formatRemaining, WORK_SEC } from '@/lib/durationEstimate'
import { describeSaveError } from '@/lib/saveErrors'
import { fetchExerciseId, gifSource } from '@/lib/exerciseGif'
import { getExerciseGifSource } from '@/data/exerciseMedia'
import { getActiveTravelMode, describeTravelEquipment } from '@/lib/travelMode'
import { metricsFor } from '@/lib/customExercises'
import { expandEquipment } from '@/lib/equipmentMatch'
import { useUnitStore, unitLabel, displayWeight, toInputString, inputToLbs, type WeightUnit } from '@/lib/units'
import type { Exercise, Goal, Split, TravelMode, MetricKey, WorkoutExerciseConfig, WorkoutSource } from '@/types'
import { workoutOrigin } from '@/lib/workoutOrigin'


const RPE_OPTIONS = [6, 7, 8, 9, 10]

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkoutRow {
  id: string
  focus: string
  planned_date: string
  planned_duration_min: number
  exercise_ids: string[]
  status: string
  source: WorkoutSource | null
  split_id: string | null
  progression: WeekProgression | null
  exercise_config: WorkoutExerciseConfig[] | null
}

interface ExerciseRow {
  id: string
  name: string
  movement_pattern: string
  primary_muscles: string[]
  secondary_muscles: string[]
  required_equipment: string[]
  experience_level: string
  instructions: string[]
  video_url: string | null
  substitute_ids: string[]
  tracking_metrics?: MetricKey[]
}

interface SetState {
  lbs: string
  reps: string
  durationSec: string
  distanceM: string
  rpe: number | null
  done: boolean
}

// Logged input columns for a set, by tracked metric (RPE is captured separately).
const METRIC_COLS: { key: MetricKey; label: string; field: 'lbs' | 'reps' | 'durationSec' | 'distanceM'; kbd: 'decimal-pad' | 'number-pad' }[] = [
  { key: 'weight', label: 'LBS', field: 'lbs', kbd: 'decimal-pad' },
  { key: 'reps', label: 'REPS', field: 'reps', kbd: 'number-pad' },
  { key: 'duration', label: 'SEC', field: 'durationSec', kbd: 'number-pad' },
  { key: 'distance', label: 'DIST', field: 'distanceM', kbd: 'decimal-pad' },
]
function columnsFor(metrics: MetricKey[] | undefined): typeof METRIC_COLS {
  const cols = METRIC_COLS.filter(c => metrics?.includes(c.key))
  return cols.length ? cols : [METRIC_COLS[0], METRIC_COLS[1]]
}

// A readable "today's target" line that matches what the exercise actually tracks —
// so a run reads "400 m · 60s × 3", not "0–0 reps × 3", and a fixed-rep target reads
// "10 reps" rather than "10–10 reps". Weights render in the user's unit.
function formatTarget(p: ExercisePrescription, metrics: MetricKey[] | undefined, firstSet: SetState | undefined, unit: WeightUnit): string {
  const m = metrics?.length ? metrics : ['weight', 'reps']
  const parts: string[] = []
  if (m.includes('weight') && p.suggestedWeight != null) parts.push(`${displayWeight(p.suggestedWeight, unit)} ${unitLabel(unit)}`)
  if (m.includes('reps')) parts.push(p.repLow === p.repHigh ? `${p.repHigh} reps` : `${p.repLow}–${p.repHigh} reps`)
  if (m.includes('duration') && firstSet?.durationSec) parts.push(`${firstSet.durationSec}s`)
  if (m.includes('distance') && firstSet?.distanceM) parts.push(`${firstSet.distanceM} m`)
  const main = parts.join(' · ')
  return main ? `${main} × ${p.sets}` : `${p.sets} set${p.sets === 1 ? '' : 's'}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// Travel mode: replace any planned exercise the user can't do with their current
// equipment with a same-pattern alternative they can (curated substitute first).
// Done in memory only — the saved plan is untouched, so it reverts when they're home.
async function adaptToTravelEquipment(list: ExerciseRow[], equipment: string[]): Promise<ExerciseRow[]> {
  const have = expandEquipment(equipment)
  const undoable = list.filter(e => !e.required_equipment.some(eq => have.has(eq)))
  if (!undoable.length) return list

  const patterns = [...new Set(undoable.map(e => e.movement_pattern))]
  const { data: cands } = await supabase
    .from('exercises')
    .select('id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, video_url, substitute_ids')
    .in('movement_pattern', patterns)
  const all = (cands ?? []) as ExerciseRow[]

  const used = new Set(list.map(e => e.id))
  return list.map(e => {
    if (e.required_equipment.some(eq => have.has(eq))) return e
    const doable = all
      .filter(s => !used.has(s.id) && s.movement_pattern === e.movement_pattern && s.required_equipment.some(eq => have.has(eq)))
      .sort((a, b) => {
        const ai = e.substitute_ids?.includes(a.id) ? 0 : 1
        const bi = e.substitute_ids?.includes(b.id) ? 0 : 1
        return ai - bi
      })
    const pick = doable[0]
    if (!pick) return e          // nothing fits — keep it; the user can still skip
    used.add(pick.id)
    return pick
  })
}

// A progress fill that eases to its new width whenever a set is logged — the
// session header visibly moves with every rep you bank.
function AnimatedFill({ pct, style }: { pct: number; style?: StyleProp<ViewStyle> }) {
  const width = useRef(new Animated.Value(pct)).current
  useEffect(() => {
    const anim = Animated.timing(width, {
      toValue: pct, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    })
    anim.start()
    return () => anim.stop()
  }, [pct, width])
  return (
    <Animated.View
      style={[style, { width: width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkoutsScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useLocalSearchParams<{ workoutId?: string; quick?: string }>()
  // Params are consumed (cleared) once acted on, so pushing the same workoutId
  // twice still re-triggers; '' therefore means "no param".
  const workoutIdParam = params.workoutId || undefined
  const quickParam = params.quick || undefined
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [workout, setWorkout] = useState<WorkoutRow | null>(null)
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [workoutLogId, setWorkoutLogId] = useState<string | null>(null)
  const [sets, setSets] = useState<Record<string, SetState[]>>({})
  const [exMetrics, setExMetrics] = useState<Record<string, MetricKey[]>>({})
  const reduceMotion = useReducedMotion()

  // Smoothly grow/shrink the exercise card when its accordion toggles.
  const toggleExpand = (id: string) => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
      )
    }
    setExpandedId((cur) => (cur === id ? null : id))
  }
  const [prevBySet, setPrevBySet] = useState<Record<string, string[]>>({})
  const [targets, setTargets] = useState<Record<string, ExercisePrescription>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [completing, setCompleting] = useState(false)
  // Whether the live logging session is open. Tapping the Workouts tab lands on the
  // hub (false); you enter the session deliberately and can leave it back to the hub.
  const [sessionActive, setSessionActive] = useState(false)
  // Rest timer is wall-clock: we store WHEN it ends, and derive the display from
  // that — so locking the phone between sets can't freeze the countdown.
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  const [restSecondsLeft, setRestSecondsLeft] = useState<number | null>(null)
  // Original rest length, so the pill can show time draining as a bar.
  const [restTotal, setRestTotal] = useState(SUGGESTED_REST_SEC)
  // The user's chosen rest for THIS workout (persisted per workout name);
  // overrides per-exercise prescriptions once set.
  const [restOverride, setRestOverride] = useState<number | null>(null)
  // Optional post-log RPE capture: shows under the set that JUST logged.
  // Logging never waits on it — the ✓ is instant, RPE is a bonus.
  const [rpeFollowUp, setRpeFollowUp] = useState<{ exId: string; idx: number } | null>(null)
  // Add-exercise mid-session: picker → "today only vs permanently" choice.
  const [addExOpen, setAddExOpen] = useState(false)
  const [addChoiceEx, setAddChoiceEx] = useState<ExerciseRow | null>(null)
  // Pause / leave-session sheet (replaces the ambiguous back chevron).
  const [pauseSheet, setPauseSheet] = useState(false)
  // How this user's real session lengths compare to estimates (historical).
  const [paceFactor, setPaceFactor] = useState(1)
  const [formSheetEx, setFormSheetEx] = useState<ExerciseRow | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [gifIds, setGifIds] = useState<Record<string, string | null>>({})
  const [goal, setGoal] = useState<Goal>('general_fitness')
  const [bias, setBias] = useState<IntensityBias>(0)
  const unit = useUnitStore(s => s.unit)
  const [travel, setTravel] = useState<TravelMode | null>(null)
  const restDefaults = useRef<Record<string, number>>({})
  const startedAt = useRef(new Date())
  // Wall-clock session timing: seconds banked from earlier stretches of this
  // session (pauses at the hub, app restarts) + when the current stretch resumed.
  const accumulatedSec = useRef(0)
  const resumedAtMs = useRef<number | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  // Lifecycle guards, kept in a ref so the focus effect can read the latest
  // values without re-arming itself every render (which would loop).
  const lifecycle = useRef({ sessionActive: false, hasParam: false, inFlight: false, lastLoadAt: 0 })
  useEffect(() => { lifecycle.current.sessionActive = sessionActive }, [sessionActive])
  useEffect(() => { lifecycle.current.hasParam = !!workoutIdParam }, [workoutIdParam])
  // Whether the running session came from a Quick Workout — survives param
  // consumption so the completion screen still knows.
  const isQuickSession = useRef(false)

  const runLoad = async (explicitId?: string): Promise<{ id: string | null; resumedLogId: string | null }> => {
    const l = lifecycle.current
    if (l.inFlight) return { id: null, resumedLogId: null }
    l.inFlight = true
    try {
      const res = await loadWorkout(explicitId)
      l.lastLoadAt = Date.now()
      return res
    } finally {
      l.inFlight = false
    }
  }

  // Explicit starts: Home's "Start Session" and Quick Workouts push a workoutId,
  // which drops straight into the live session (resuming an already-open log
  // rather than opening a phantom second one). The param is then consumed via
  // setParams so starting the same workout again re-triggers cleanly.
  useEffect(() => {
    if (!userId || !workoutIdParam) return
    isQuickSession.current = quickParam === '1'
    ;(async () => {
      const { id, resumedLogId } = await runLoad(workoutIdParam)
      if (id) {
        if (resumedLogId) setSessionActive(true)
        else await beginSession(id)
      }
      router.setParams({ workoutId: '', quick: '' })
    })()
  }, [userId, workoutIdParam])

  // Hub freshness. All tabs mount at app start (lazy: false), so load once on
  // mount for a warm first visit, then re-check on every tab focus — a finished
  // workout, a new plan, or a date change must never leave yesterday's session
  // on screen. A live logging session is never disturbed.
  useEffect(() => {
    if (!userId || workoutIdParam) return
    runLoad()
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      const l = lifecycle.current
      if (l.sessionActive || l.hasParam || l.inFlight) return
      if (Date.now() - l.lastLoadAt < 15_000) return // fresh enough — skip the churn
      runLoad()
    }, [userId]), // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Learn how this user's real sessions compare to estimates (best-effort).
  useEffect(() => {
    if (!userId) return
    fetchPaceFactor(supabase, userId).then(setPaceFactor).catch(() => {})
  }, [userId])

  // Prepare a workout for the hub/session: loads the row, exercises, targets and
  // pre-filled sets, but does NOT open a workout_logs row — that happens on start,
  // so merely viewing the hub never creates a phantom session. If a log row is
  // already open for this workout (app killed mid-session), it's adopted and its
  // logged sets rehydrated, so nothing is lost and no duplicate log is created.
  async function loadWorkout(explicitId?: string): Promise<{ id: string | null; resumedLogId: string | null }> {
    setNotFound(false)
    let targetId: string | undefined = explicitId

    if (!targetId) {
      // Fall back to today's first scheduled workout
      const { data: found } = await supabase
        .from('scheduled_workouts')
        .select('id')
        .eq('user_id', userId)
        .eq('planned_date', toDateStr(new Date()))
        .eq('status', 'scheduled')
        .limit(1)
        .maybeSingle()
      if (!found) { setNotFound(true); setLoading(false); return { id: null, resumedLogId: null } }
      targetId = found.id
    }

    const { data: workoutRow } = await supabase
      .from('scheduled_workouts')
      .select('id, focus, planned_date, planned_duration_min, exercise_ids, status, source, split_id, progression, exercise_config')
      .eq('id', targetId)
      .single()

    if (!workoutRow) { setNotFound(true); setLoading(false); return { id: null, resumedLogId: null } }
    setWorkout(workoutRow as WorkoutRow)
    setRestOverride(getRestPref((workoutRow as WorkoutRow).focus))
    const progression = (workoutRow.progression ?? null) as WeekProgression | null

    // An open (never-completed) log for this workout means a session was already
    // running when the app died or the user walked away. Adopt a fresh one;
    // close out a stale one so it stops haunting the data.
    let resumedLog: { id: string; started_at: string } | null = null
    try {
      const { data: openLog } = await supabase
        .from('workout_logs')
        .select('id, started_at')
        .eq('user_id', userId)
        .eq('scheduled_workout_id', workoutRow.id)
        .is('completed_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openLog) {
        const ageMs = Date.now() - new Date(openLog.started_at as string).getTime()
        if (ageMs < 12 * 60 * 60 * 1000) {
          resumedLog = openLog as { id: string; started_at: string }
        } else {
          // Too old to resume — zero-length close so it never counts as time trained.
          await supabase.from('workout_logs')
            .update({ completed_at: openLog.started_at })
            .eq('id', openLog.id)
        }
      }
    } catch { /* resume is best-effort; worst case is the old behaviour */ }

    if (resumedLog) {
      setWorkoutLogId(resumedLog.id)
      startedAt.current = new Date(resumedLog.started_at)
      accumulatedSec.current = Math.max(0, Math.floor((Date.now() - startedAt.current.getTime()) / 1000))
      setElapsed(accumulatedSec.current)
    } else {
      setWorkoutLogId(null)
      accumulatedSec.current = 0
      setElapsed(0)
    }

    const exerciseIds: string[] = workoutRow.exercise_ids ?? []

    // The user's goal drives rep/rest schemes; a rough recovery day trims volume;
    // their last "too easy / too hard" feedback biases this session's volume.
    const [{ data: profileRow }, readiness, intensityBias] = await Promise.all([
      supabase.from('user_profiles').select('goal').eq('user_id', userId).maybeSingle(),
      getTodayReadiness(userId),
      getIntensityBias(supabase, userId),
    ])
    const goal = (profileRow?.goal ?? 'general_fitness') as Goal
    setGoal(goal)
    setBias(intensityBias)
    const readinessLow = readiness != null && readiness < 50

    // Fetch full exercise rows and restore the plan's original order
    const { data: exRows } = exerciseIds.length
      ? await supabase
          .from('exercises')
          .select('id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, video_url, substitute_ids, tracking_metrics')
          .in('id', exerciseIds)
      : { data: [] }

    // A user-built ("custom") workout carries its own per-exercise prescription +
    // metrics; honor those instead of the autoregulated plan targets.
    const cfgByEx = new Map<string, WorkoutExerciseConfig>(
      ((workoutRow.exercise_config ?? []) as WorkoutExerciseConfig[]).map(c => [c.exercise_id, c]),
    )

    const orderedRaw = exerciseIds
      .map(id => (exRows ?? []).find((e: any) => e.id === id))
      .filter(Boolean) as ExerciseRow[]

    // If the user is travelling, adapt the session in memory to the gear they have.
    const tm = await getActiveTravelMode(supabase, userId)
    setTravel(tm)
    const ordered = tm ? await adaptToTravelEquipment(orderedRaw, tm.equipment) : orderedRaw
    const effectiveIds = ordered.map(e => e.id)

    setExercises(ordered)
    setExpandedId(ordered[0]?.id ?? null)
    setGifIds({})

    // Pre-fetch exercise IDs in the background; expo-image handles the actual GIF download with auth headers
    ordered.forEach(ex => {
      if (getExerciseGifSource(ex.id)) return // verified clip by id — no name lookup needed
      fetchExerciseId(ex.name).then(id => {
        if (id) setGifIds(prev => ({ ...prev, [ex.id]: id }))
      })
    })

    // Build each exercise's "last session" performance → next-session prescription
    // + the per-set PREV column. History is read before the new log exists, so the
    // current session can't contaminate it.
    const prevBySetMap: Record<string, string[]> = {}
    const targetMap: Record<string, ExercisePrescription> = {}
    const metricsMap: Record<string, MetricKey[]> = {}

    // Metrics per exercise: a custom workout's config wins; otherwise the exercise's
    // own tracking_metrics (built-ins default to weight + reps).
    for (const ex of ordered) {
      const cfg = cfgByEx.get(ex.id)
      metricsMap[ex.id] = cfg?.metrics?.length ? cfg.metrics : metricsFor(ex as any)
    }

    if (effectiveIds.length) {
      const { data: history } = await supabase
        .from('set_logs')
        .select('exercise_id, workout_log_id, set_number, weight_lbs, reps_completed, rpe, duration_sec, distance_m, completed_at')
        .in('exercise_id', effectiveIds)
        .order('completed_at', { ascending: false })

      for (const ex of ordered) {
        const rows = (history ?? []).filter(r => r.exercise_id === ex.id)
        const lastLogId = rows[0]?.workout_log_id
        const lastSets = rows
          .filter(r => r.workout_log_id === lastLogId)
          .sort((a, b) => a.set_number - b.set_number)
        const perf: SetPerformance[] = lastSets.map(r => ({
          weight_lbs: r.weight_lbs, reps: r.reps_completed, rpe: r.rpe,
        }))
        // PREV column renders in the user's display unit (storage stays lbs).
        const u = useUnitStore.getState().unit
        prevBySetMap[ex.id] = lastSets.map(r =>
          r.weight_lbs != null ? `${displayWeight(r.weight_lbs, u)}×${r.reps_completed}`
            : r.duration_sec != null ? `${r.duration_sec}s`
              : r.distance_m != null ? `${r.distance_m}m`
                : `${r.reps_completed}`)

        const cfg = cfgByEx.get(ex.id)
        targetMap[ex.id] = cfg
          ? {
              sets: Math.max(1, cfg.sets), repLow: cfg.rep_low, repHigh: cfg.rep_high,
              restSeconds: 90, suggestedWeight: cfg.weight_lbs, direction: 'new',
              reason: 'Your target for this workout.', lastSummary: null,
            }
          : buildPrescription(perf, goal, ex.movement_pattern, readinessLow, intensityBias, progression)
      }
    } else {
      for (const ex of ordered) {
        const cfg = cfgByEx.get(ex.id)
        if (cfg) targetMap[ex.id] = {
          sets: Math.max(1, cfg.sets), repLow: cfg.rep_low, repHigh: cfg.rep_high,
          restSeconds: 90, suggestedWeight: cfg.weight_lbs, direction: 'new',
          reason: 'Your target for this workout.', lastSummary: null,
        }
      }
    }

    setPrevBySet(prevBySetMap)
    setTargets(targetMap)
    setExMetrics(metricsMap)

    // Pre-fill sets from each prescription so logging is a one-tap confirm, not
    // manual entry — matching the "least manual input" principle.
    const initialSets: Record<string, SetState[]> = {}
    for (const ex of ordered) {
      const p = targetMap[ex.id]
      const cfg = cfgByEx.get(ex.id)
      const count = p?.sets ?? 3
      restDefaults.current[ex.id] = p?.restSeconds ?? 90
      initialSets[ex.id] = Array.from({ length: count }, () => ({
        // Weight inputs hold the DISPLAY unit; converted back to lbs on log.
        lbs: toInputString(p?.suggestedWeight, useUnitStore.getState().unit),
        reps: p ? String(p.repHigh) : '',
        durationSec: cfg?.duration_sec != null ? String(cfg.duration_sec) : '',
        distanceM: cfg?.distance_m != null ? String(cfg.distance_m) : '',
        rpe: null,
        done: false,
      }))
    }

    // Resuming an open session: lay the already-logged sets back over the grid so
    // the user picks up exactly where the session died — nothing re-logged twice.
    if (resumedLog) {
      try {
        const { data: loggedSets } = await supabase
          .from('set_logs')
          .select('exercise_id, set_number, weight_lbs, reps_completed, rpe, duration_sec, distance_m')
          .eq('workout_log_id', resumedLog.id)
          .order('set_number')
        for (const s of (loggedSets ?? []) as any[]) {
          const arr = initialSets[s.exercise_id as string]
          if (!arr) continue
          const idx = Math.max(0, (s.set_number as number) - 1)
          while (arr.length <= idx) {
            arr.push({ lbs: '', reps: '', durationSec: '', distanceM: '', rpe: null, done: false })
          }
          arr[idx] = {
            lbs: toInputString(s.weight_lbs as number | null, useUnitStore.getState().unit),
            reps: s.reps_completed != null ? String(s.reps_completed) : '',
            durationSec: s.duration_sec != null ? String(s.duration_sec) : '',
            distanceM: s.distance_m != null ? String(s.distance_m) : '',
            rpe: (s.rpe as number | null) ?? null,
            done: true,
          }
        }
      } catch { /* worst case: previously logged sets show as unlogged */ }
    }
    setSets(initialSets)

    setLoading(false)
    return { id: workoutRow.id, resumedLogId: resumedLog?.id ?? null }
  }

  // Open the live logging session for a prepared workout: stamp the start time, open
  // a workout_logs row, and switch into the session view. Called on an explicit start
  // or from the hub's "Start session" — never just from viewing the hub.
  async function beginSession(scheduledId: string) {
    startedAt.current = new Date()
    accumulatedSec.current = 0
    setElapsed(0)
    const { data: logRow, error } = await supabase
      .from('workout_logs')
      .insert({
        scheduled_workout_id: scheduledId,
        user_id: userId,
        started_at: startedAt.current.toISOString(),
      })
      .select('id')
      .single()
    if (error || !logRow) {
      // Without a log row nothing in the session could save (sets no-op, Complete
      // is dead) — never enter that trap silently. Classify the failure: an expired
      // session in a gym is NOT a connection problem, and saying so sends the user
      // chasing the wrong fix.
      const info = describeSaveError(error, 'start your session')
      Alert.alert('Couldn’t start session', `${info.message}\n\nTap Start again when you’re ready.`)
      return
    }
    setSaveWarned.current = false
    setWorkoutLogId(logRow.id)
    setSessionActive(true)
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Timer only runs while the session view is open — leaving to the hub pauses it.
    // Wall-clock based: locking the phone between sets must not stop the clock, so
    // each tick derives elapsed from real timestamps instead of counting intervals.
    if (!workoutLogId || !sessionActive) return
    resumedAtMs.current = Date.now()
    const tick = () => {
      const running = resumedAtMs.current != null ? (Date.now() - resumedAtMs.current) / 1000 : 0
      setElapsed(Math.floor(accumulatedSec.current + running))
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => {
      clearInterval(iv)
      // Bank the stretch that just ended so a hub pause doesn't lose (or double) time.
      if (resumedAtMs.current != null) {
        accumulatedSec.current += (Date.now() - resumedAtMs.current) / 1000
        resumedAtMs.current = null
      }
    }
  }, [workoutLogId, sessionActive])

  // Keep the screen awake during a live session — a dimming phone mid-set is how
  // people lose their place (and their rest timer).
  useEffect(() => {
    if (!sessionActive) return
    activateKeepAwakeAsync('tempo-session').catch(() => {})
    return () => { deactivateKeepAwake('tempo-session') }
  }, [sessionActive])

  // ── Set actions ────────────────────────────────────────────────────────────

  const updateSet = (exId: string, idx: number, field: 'lbs' | 'reps' | 'durationSec' | 'distanceM', value: string) => {
    setSets(prev => ({
      ...prev,
      [exId]: prev[exId].map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }))
  }

  // One "your set didn't save" alert per session — offline in a gym shouldn't
  // nag on every set, but the unchecked ✓ always shows the truth.
  const setSaveWarned = useRef(false)

  // The rest that applies right now for an exercise: the user's per-workout
  // choice wins; otherwise the prescription; otherwise the 2-minute default.
  const restFor = (exId: string): number =>
    restOverride ?? restDefaults.current[exId] ?? SUGGESTED_REST_SEC

  // Tapping ✓ logs the set IMMEDIATELY — rest starts, haptic fires, done. RPE is
  // captured after the fact via an optional follow-up bar; it must never gate
  // logging or the rest timer.
  const handleSetDone = async (exId: string, idx: number) => {
    if (!workoutLogId) return
    const set = sets[exId]?.[idx]
    if (!set || set.done) return

    haptics.tapLight()
    setSets(prev => ({
      ...prev,
      [exId]: prev[exId].map((s, i) => i === idx ? { ...s, done: true } : s),
    }))
    setRpeFollowUp({ exId, idx })

    // Auto-start the rest timer using this exercise's effective rest
    startRest(restFor(exId))

    // Exercise fully banked? A firmer tick, and the next incomplete exercise
    // opens by itself so the flow never stalls on a collapsed accordion.
    const after = sets[exId].map((s, i) => (i === idx ? { ...s, done: true } : s))
    if (after.every(s => s.done)) {
      haptics.tapMedium()
      const next = exercises.find(e => e.id !== exId && (sets[e.id] ?? []).some(s => !s.done))
      if (next) {
        if (!reduceMotion) {
          LayoutAnimation.configureNext(
            LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
          )
        }
        setExpandedId(next.id)
      }
    }

    const { error } = await supabase.from('set_logs').insert({
      workout_log_id: workoutLogId,
      exercise_id: exId,
      set_number: idx + 1,
      reps_completed: parseInt(set.reps) || 0,
      // The input holds the display unit — storage is always lbs.
      weight_lbs: set.lbs ? inputToLbs(set.lbs, useUnitStore.getState().unit) : null,
      duration_sec: set.durationSec ? parseInt(set.durationSec) : null,
      distance_m: set.distanceM ? parseFloat(set.distanceM) : null,
      rpe: null,
      completed_at: new Date().toISOString(),
    })
    if (error) {
      // Un-check it — a ✓ that never reached the server would silently drop the
      // set from PRs, volume, and next session's PREV column. The exercise may have
      // been swapped out while the insert was in flight — its row is gone then, and
      // there's nothing to un-check.
      setSets(prev => prev[exId]
        ? { ...prev, [exId]: prev[exId].map((s, i) => i === idx ? { ...s, done: false } : s) }
        : prev)
      setRpeFollowUp(cur => (cur?.exId === exId && cur?.idx === idx ? null : cur))
      if (!setSaveWarned.current) {
        setSaveWarned.current = true
        const info = describeSaveError(error, 'save this set')
        Alert.alert('Set didn’t save', `${info.message}\n\nYour numbers are still in the row — tap the ✓ to retry.`)
      }
    }
  }

  // Attach an RPE to a set that already logged (optional, after the fact).
  const attachRpe = async (exId: string, idx: number, rpe: number) => {
    haptics.tapLight()
    setRpeFollowUp(null)
    setSets(prev => prev[exId]
      ? { ...prev, [exId]: prev[exId].map((s, i) => i === idx ? { ...s, rpe } : s) }
      : prev)
    if (!workoutLogId) return
    await supabase.from('set_logs')
      .update({ rpe })
      .eq('workout_log_id', workoutLogId)
      .eq('exercise_id', exId)
      .eq('set_number', idx + 1)
  }

  const addSet = (exId: string) => {
    haptics.tapLight()
    setSets(prev => ({
      ...prev,
      [exId]: [...prev[exId], { lbs: '', reps: '', durationSec: '', distanceM: '', rpe: null, done: false }],
    }))
  }

  // Remove a set — accidental taps on "+ Add Set" or a mis-logged set shouldn't
  // pollute volume, totals or the next session's PREV column. A logged set's
  // row is deleted server-side and later sets renumbered so history stays dense.
  const removeSet = (exId: string, idx: number) => {
    const arr = sets[exId]
    if (!arr || arr.length <= 1) {
      Alert.alert('Can’t remove', 'Every exercise needs at least one set — swap or skip the exercise instead.')
      return
    }
    Alert.alert('Remove set?', `Set ${idx + 1} will be removed${arr[idx].done ? ' and its logged numbers deleted' : ''}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          haptics.tapMedium()
          const wasDone = arr[idx].done
          setRpeFollowUp(cur => (cur?.exId === exId ? null : cur))
          setSets(prev => prev[exId]
            ? { ...prev, [exId]: prev[exId].filter((_, i) => i !== idx) }
            : prev)
          if (!wasDone || !workoutLogId) return
          try {
            await supabase.from('set_logs')
              .delete()
              .eq('workout_log_id', workoutLogId)
              .eq('exercise_id', exId)
              .eq('set_number', idx + 1)
            // Close the numbering gap so resume/PREV rebuilds line up.
            const { data: later } = await supabase.from('set_logs')
              .select('id, set_number')
              .eq('workout_log_id', workoutLogId)
              .eq('exercise_id', exId)
              .gt('set_number', idx + 1)
              .order('set_number')
            for (const row of (later ?? []) as { id: string; set_number: number }[]) {
              await supabase.from('set_logs').update({ set_number: row.set_number - 1 }).eq('id', row.id)
            }
          } catch { /* worst case: a gap in set numbers — totals still correct */ }
        },
      },
    ])
  }

  // ── Add exercise mid-session ────────────────────────────────────────────────

  // Append an exercise to the RUNNING session. `permanent` also writes it into
  // the scheduled row (so an app restart keeps it) and — when the session came
  // from a split — into the split day itself, so every future week has it.
  const addExerciseToSession = async (ex: ExerciseRow, permanent: boolean) => {
    const prescription = buildPrescription([], goal, ex.movement_pattern, false, bias, workout?.progression ?? null)
    restDefaults.current[ex.id] = prescription.restSeconds
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
      )
    }
    setExercises(prev => [...prev, ex])
    setTargets(prev => ({ ...prev, [ex.id]: prescription }))
    setPrevBySet(prev => ({ ...prev, [ex.id]: [] }))
    setExMetrics(prev => ({ ...prev, [ex.id]: metricsFor(ex as any) }))
    setSets(prev => ({
      ...prev,
      [ex.id]: Array.from({ length: prescription.sets }, () => ({
        lbs: '', reps: String(prescription.repHigh), durationSec: '', distanceM: '', rpe: null, done: false,
      })),
    }))
    setExpandedId(ex.id)
    haptics.tapLight()

    if (!permanent || !workout) return
    const newIds = [...workout.exercise_ids, ex.id]
    setWorkout({ ...workout, exercise_ids: newIds })
    await supabase.from('scheduled_workouts').update({ exercise_ids: newIds }).eq('id', workout.id)

    // Persist into the owning split day so future weeks include it too.
    if (workout.source === 'split' && workout.split_id) {
      try {
        const { data: splitRow } = await supabase.from('splits').select('*').eq('id', workout.split_id).maybeSingle()
        if (splitRow) {
          const split = splitRow as Split
          const d = new Date(`${workout.planned_date}T00:00:00`)
          const weekday = ((d.getDay() + 6) % 7) + 1
          const days = split.days.map(day => {
            if (day.weekday !== weekday || day.rest) return day
            if (day.exercise_ids?.includes(ex.id)) return day
            return { ...day, exercise_ids: [...(day.exercise_ids ?? []), ex.id] }
          })
          await supabase.from('splits').update({ days }).eq('id', split.id)
        }
      } catch { /* the session + scheduled row still carry it */ }
    }
  }

  // ── Swap exercise (smart substitutions) ──────────────────────────────────────

  const handleSwap = async (ex: ExerciseRow) => {
    if (swapping) return
    setSwapping(true)
    try {
      // When travelling, swaps are offered against the equipment on hand, not home.
      const baseEquipment = travel ? travel.equipment : null
      const { data: profileRow } = baseEquipment
        ? { data: { equipment: baseEquipment } }
        : await supabase.from('user_profiles').select('equipment').eq('user_id', userId).maybeSingle()
      const equipment = expandEquipment(profileRow?.equipment ?? [])
      const inWorkout = new Set(exercises.map(e => e.id))

      // Prefer curated substitutes; fall back to same-pattern lifts the user can do.
      const { data: subs } = await supabase
        .from('exercises')
        .select('id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, video_url, substitute_ids')
        .eq('movement_pattern', ex.movement_pattern)
        .neq('id', ex.id)

      const candidates = (subs ?? []).filter((s: any) => {
        if (inWorkout.has(s.id)) return false
        const curated = ex.substitute_ids?.includes(s.id)
        const doable = (s.required_equipment as string[]).some(eq => equipment.has(eq))
        return curated || doable
      }) as ExerciseRow[]

      // Curated substitutes first
      candidates.sort((a, b) => {
        const ai = ex.substitute_ids?.includes(a.id) ? 0 : 1
        const bi = ex.substitute_ids?.includes(b.id) ? 0 : 1
        return ai - bi
      })

      if (!candidates.length) {
        Alert.alert('No substitutes', 'No alternatives match your equipment for this movement.')
        return
      }

      const buttons: any[] = candidates.slice(0, 4).map(c => ({
        text: c.name,
        onPress: () => replaceExercise(ex.id, c),
      }))
      buttons.push({ text: 'Cancel', style: 'cancel' })
      Alert.alert('Swap exercise', `Replace ${ex.name} with:`, buttons)
    } finally {
      setSwapping(false)
    }
  }

  const replaceExercise = async (oldId: string, next: ExerciseRow) => {
    const prescription = buildPrescription([], goal, next.movement_pattern, false, bias, workout?.progression)
    restDefaults.current[next.id] = prescription.restSeconds

    setExercises(prev => prev.map(e => e.id === oldId ? next : e))
    setTargets(prev => {
      const { [oldId]: _, ...rest } = prev
      return { ...rest, [next.id]: prescription }
    })
    setPrevBySet(prev => {
      const { [oldId]: _, ...rest } = prev
      return { ...rest, [next.id]: [] }
    })
    setSets(prev => {
      const { [oldId]: _, ...rest } = prev
      return {
        ...rest,
        [next.id]: Array.from({ length: prescription.sets }, () => ({
          lbs: '', reps: String(prescription.repHigh), durationSec: '', distanceM: '', rpe: null, done: false,
        })),
      }
    })
    setExMetrics(prev => {
      const { [oldId]: _, ...rest } = prev
      return { ...rest, [next.id]: metricsFor(next as any) }
    })
    setExpandedId(cur => cur === oldId ? next.id : cur)

    // Persist the swap into the plan so it sticks for this workout
    if (workout) {
      const newIds = workout.exercise_ids.map(id => id === oldId ? next.id : id)
      setWorkout({ ...workout, exercise_ids: newIds })
      await supabase.from('scheduled_workouts').update({ exercise_ids: newIds }).eq('id', workout.id)
    }
  }

  // ── Complete workout ───────────────────────────────────────────────────────

  const finishWorkout = async () => {
    if (!workout || !workoutLogId) return
    setCompleting(true)
    stopRest()
    const now = new Date().toISOString()
    // Wall-clock minutes, capped so a session resumed hours later can't log an
    // absurd duration.
    const mins = Math.min(240, Math.max(1, Math.round(elapsed / 60)))

    const [{ error: schedErr }, { error: logErr }] = await Promise.all([
      supabase.from('scheduled_workouts')
        .update({ status: 'completed', completed_at: now, actual_duration_min: mins })
        .eq('id', workout.id),
      supabase.from('workout_logs')
        .update({ completed_at: now })
        .eq('id', workoutLogId),
    ])
    if (schedErr || logErr) {
      // Never celebrate a completion that didn't save (gym wifi dies at the door).
      // The session stays live so one more tap finishes it for real.
      setCompleting(false)
      const info = describeSaveError(schedErr ?? logErr, 'save your workout')
      Alert.alert(
        'Couldn’t save your workout',
        `${info.message}\n\nYour session is still here — tap Complete Workout again.`,
      )
      return
    }

    haptics.success()
    cancelWorkoutReminder(workout.id).catch(() => {})

    // Every screen keyed on training data (Home schedule, Progress, streak,
    // next-workout) refreshes NOW — not whenever it happens to remount.
    invalidateTrainingData(queryClient)

    // Re-evaluate the block's adaptation mode now that another session is logged —
    // may shift the coming weeks into recovery/deload (best-effort, never blocks).
    refreshAdaptation(supabase, userId).catch(() => {})

    // Motivational summary — streak impact, consistency, weekly target progress.
    router.replace({
      pathname: '/workout-complete',
      params: { minutes: String(mins), quick: isQuickSession.current ? '1' : '0', logId: workoutLogId ?? '' },
    })

    // Reset the logger behind the summary so returning to this tab shows a fresh
    // hub (the focus reload repopulates it), not the completed session's grid.
    setSessionActive(false)
    setWorkoutLogId(null)
    setLoading(true)
    lifecycle.current.lastLoadAt = 0
    setCompleting(false)
  }

  // Guardrails: an accidental tap must not mint a fake completed session — that
  // would inflate the streak/consistency and feed junk into adaptation.
  const handleCompleteWorkout = () => {
    if (!workout || !workoutLogId || completing) return
    const all = Object.values(sets)
    const total = all.reduce((n, arr) => n + arr.length, 0)
    const done = all.reduce((n, arr) => n + arr.filter(s => s.done).length, 0)

    if (done === 0) {
      Alert.alert(
        'No sets logged yet',
        'Tap the ✓ on a set to log it first — an empty workout would still count toward your streak and stats.',
      )
      return
    }
    if (total > 0 && done < total / 2) {
      Alert.alert(
        'Finish early?',
        `Only ${done} of ${total} sets are logged. Complete the workout anyway?`,
        [
          { text: 'Keep training', style: 'cancel' },
          { text: 'Complete workout', onPress: () => { finishWorkout().catch(() => setCompleting(false)) } },
        ],
      )
      return
    }
    finishWorkout().catch(() => setCompleting(false))
  }

  // ── Pause / leave session ───────────────────────────────────────────────────

  // Walking away with zero sets logged shouldn't leave an open log haunting the
  // resume path — delete it and return to a clean hub.
  const discardSession = async () => {
    stopRest()
    if (workoutLogId) {
      try {
        await supabase.from('set_logs').delete().eq('workout_log_id', workoutLogId)
        await supabase.from('workout_logs').delete().eq('id', workoutLogId)
      } catch { /* an orphaned zero-set log is closed out by the stale-log sweep */ }
    }
    setSessionActive(false)
    setWorkoutLogId(null)
    accumulatedSec.current = 0
    setElapsed(0)
  }

  const onPauseChoice = (key: string) => {
    setPauseSheet(false)
    if (key === 'pause') {
      // Progress is saved (logged sets are on the server; the open log resumes
      // from the hub or after an app restart). Cancel the pending rest buzz so
      // a paused workout doesn't vibrate the pocket.
      stopRest()
      setSessionActive(false)
    } else if (key === 'end') {
      const done = Object.values(sets).reduce((n, arr) => n + arr.filter(s => s.done).length, 0)
      if (done === 0) {
        Alert.alert('End workout?', 'Nothing is logged yet — this session will be discarded (it won’t count toward your streak or stats).', [
          { text: 'Keep training', style: 'cancel' },
          { text: 'Discard session', style: 'destructive', onPress: () => { discardSession().catch(() => {}) } },
        ])
      } else {
        handleCompleteWorkout()
      }
    }
  }

  // ── Rest timer ─────────────────────────────────────────────────────────────

  // The countdown derives from the wall-clock end time, so backgrounding never
  // freezes it; the scheduled OS notification covers a locked phone. In the
  // foreground, completion is a vibration — not an Alert that steals the screen.
  useEffect(() => {
    if (restEndsAt === null) { setRestSecondsLeft(null); return }
    const tick = () => {
      const left = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000))
      if (left <= 0) {
        setRestEndsAt(null)
        setRestSecondsLeft(null)
        haptics.warning()
        cancelRestDoneNotification().catch(() => {})
      } else {
        setRestSecondsLeft(left)
      }
    }
    tick()
    const iv = setInterval(tick, 500)
    return () => clearInterval(iv)
  }, [restEndsAt])

  const startRest = (seconds: number) => {
    setRestTotal(seconds)
    setRestEndsAt(Date.now() + seconds * 1000)
    scheduleRestDoneNotification(seconds).catch(() => {})
  }
  const stopRest = () => {
    setRestEndsAt(null)
    cancelRestDoneNotification().catch(() => {})
  }

  // Rest-length choices in a sheet, not Alert.alert (Android caps alerts at 3
  // buttons, which dropped an option). Picking a length also becomes this
  // workout's rest going forward (persisted per workout name) — "customize per
  // workout" without a settings hunt.
  const [restSheet, setRestSheet] = useState(false)
  const [customRestOpen, setCustomRestOpen] = useState(false)
  const [customRestSec, setCustomRestSec] = useState(SUGGESTED_REST_SEC)
  const handleRestTimer = () => {
    if (restEndsAt !== null) {
      stopRest()
      return
    }
    setRestSheet(true)
  }
  const applyRestChoice = (secs: number) => {
    if (!Number.isFinite(secs) || secs <= 0) return
    setRestOverride(secs)
    if (workout) setRestPref(workout.focus, secs)
    startRest(secs)
  }
  const pickRest = (key: string) => {
    setRestSheet(false)
    if (key === 'custom') {
      setCustomRestSec(restOverride ?? SUGGESTED_REST_SEC)
      setCustomRestOpen(true)
      return
    }
    applyRestChoice(parseInt(key, 10))
  }

  const handleShowExerciseList = () => {
    const list = exercises.map((ex, i) => `${i + 1}. ${ex.name}`).join('\n')
    Alert.alert('Exercise List', list || 'No exercises loaded.', [{ text: 'OK' }])
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  const totalSets = Object.values(sets).reduce((n, arr) => n + arr.length, 0)
  const doneSets = Object.values(sets).reduce((n, arr) => n + arr.filter(s => s.done).length, 0)
  const progress = totalSets > 0 ? doneSets / totalSets : 0

  // Honest duration numbers: a realistic static estimate (rests, transitions,
  // equipment time — see lib/durationEstimate), scaled by the user's historical
  // pace, then sharpened live by the pace they're actually logging at.
  const sessionEstimateSec = useMemo(() => estimateSessionSec(exercises.map(ex => ({
    sets: sets[ex.id]?.length ?? targets[ex.id]?.sets ?? 3,
    restSec: restOverride ?? restDefaults.current[ex.id] ?? null,
    workSec: exMetrics[ex.id]?.includes('duration')
      ? (parseInt(sets[ex.id]?.[0]?.durationSec || '', 10) || WORK_SEC)
      : null,
  }))), [exercises, sets, targets, exMetrics, restOverride])
  const hubEstimateMin = Math.max(5, Math.round((sessionEstimateSec / 60) * paceFactor))
  const remainingSec = adaptiveRemainingSec({
    elapsedSec: elapsed,
    doneSets,
    totalSets,
    staticPerSetSec: sessionEstimateSec / Math.max(1, totalSets),
    paceFactor,
  })

  // ── Early returns ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
        <View style={styles.header}>
          <TempoWordmark size={18} pulse={false} />
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open your profile">
            <Avatar size={32} iconSize={16} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyStateContainer}>
          <PulseLoader caption="Loading today's session…" />
        </View>
      </ScreenTransition>
    </SafeAreaView>
    )
  }

  if (notFound || !workout) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
        <View style={styles.header}>
          <TempoWordmark size={18} pulse={false} />
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open your profile">
            <Avatar size={32} iconSize={16} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyStateContainer}>
          <EmptyState
            kind="flash"
            title="Nothing scheduled right now"
            body="Got a spare 10–45 minutes? Start a Quick Workout and Tempo builds the highest-impact session for the time you have."
            actionLabel="Start a Quick Workout"
            onAction={() => router.push('/quick-workout')}
          />
          <View style={styles.emptyLinksRow}>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/my-workouts' as any)} activeOpacity={0.7}>
              <Ionicons name="construct-outline" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>My Workouts</Text>
            </PressableScale>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/my-splits' as any)} activeOpacity={0.7}>
              <Ionicons name="repeat-outline" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>My Splits</Text>
            </PressableScale>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/(tabs)')} activeOpacity={0.7}>
              <Ionicons name="calendar-outline" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>Schedule</Text>
            </PressableScale>
          </View>
        </View>
      </ScreenTransition>
    </SafeAreaView>
    )
  }

  // ── Hub (pre-session) ───────────────────────────────────────────────────────
  // Landing on the Workouts tab shows the day's session ready to go. You start it
  // deliberately here, and can step back out of the live session to this hub at any
  // time — so being on a workout day never traps you in the exercise logger.
  if (!sessionActive) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
        <View style={styles.header}>
          <TempoWordmark size={18} pulse={false} />
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open your profile">
            <Avatar size={32} iconSize={16} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <FadeInView style={styles.hubHero}>
            <View style={styles.hubEyebrowRow}>
              <Text style={styles.hubEyebrow}>{workoutLogId ? 'IN PROGRESS' : "TODAY'S SESSION"}</Text>
              {(() => {
                const origin = workoutOrigin(workout.source)
                return (
                  <View style={[styles.originChip, origin.byTempo ? styles.originChipTempo : styles.originChipYours]}>
                    <Ionicons name={origin.icon as any} size={11} color={origin.byTempo ? C.primary : C.textSecondary} />
                    <Text style={[styles.originText, { color: origin.byTempo ? C.primary : C.textSecondary }]}>{origin.label}</Text>
                  </View>
                )
              })()}
            </View>
            <Text style={styles.hubTitle}>{workout.focus}</Text>
            <Text style={styles.hubMeta}>{exercises.length} exercise{exercises.length === 1 ? '' : 's'} · ~{hubEstimateMin} min</Text>
          </FadeInView>

          <FadeInView delay={70} style={styles.hubList}>
            {exercises.map((ex, i) => (
              <View key={ex.id} style={[styles.hubRow, i > 0 && styles.hubRowDivider]}>
                <Text style={styles.hubRowNum}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hubRowName} numberOfLines={1}>{ex.name}</Text>
                  <Text style={styles.hubRowMuscle} numberOfLines={1}>{ex.primary_muscles.join(' · ').toUpperCase()}</Text>
                </View>
                <Text style={styles.hubRowSets}>{sets[ex.id]?.length ?? targets[ex.id]?.sets ?? 3} sets</Text>
              </View>
            ))}
          </FadeInView>

          <FadeInView delay={140}>
            <PressableScale
              style={styles.hubStartBtn}
              onPress={() => (workoutLogId ? setSessionActive(true) : beginSession(workout.id))}
            >
              <Ionicons name={workoutLogId ? 'play' : 'barbell'} size={18} color={C.onPrimary} />
              <Text style={styles.hubStartText}>{workoutLogId ? 'Resume session' : 'Start session'}</Text>
            </PressableScale>
          </FadeInView>

          <View style={styles.emptyLinksRow}>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/quick-workout')} activeOpacity={0.7}>
              <Ionicons name="flash" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>Quick Workout</Text>
            </PressableScale>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/my-workouts' as any)} activeOpacity={0.7}>
              <Ionicons name="construct-outline" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>My Workouts</Text>
            </PressableScale>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/my-splits' as any)} activeOpacity={0.7}>
              <Ionicons name="repeat-outline" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>My Splits</Text>
            </PressableScale>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/workout-history' as any)} activeOpacity={0.7}>
              <Ionicons name="journal-outline" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>History</Text>
            </PressableScale>
            <PressableScale style={styles.emptyLink} scaleTo={0.93} onPress={() => router.push('/exercise-library' as any)} activeOpacity={0.7}>
              <Ionicons name="book-outline" size={15} color={C.textSecondary} />
              <Text style={styles.emptyLinkText}>Library</Text>
            </PressableScale>
          </View>
        </ScrollView>
      </ScreenTransition>
    </SafeAreaView>
    )
  }

  // ── Main render (live session) ──────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
      {/* Header — an explicit, labeled Pause control. The old bare chevron read
          as "exit workout" and scared people into thinking progress was lost. */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.pauseBtn}
          onPress={() => setPauseSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="Pause or end this workout"
        >
          <Ionicons name="pause" size={16} color={C.text} />
          <Text style={styles.pauseBtnText}>Pause</Text>
        </TouchableOpacity>
        <TempoWordmark size={18} pulse={false} />
        <TouchableOpacity style={styles.avatar} onPress={() => router.push('/(tabs)/profile')} accessibilityRole="button" accessibilityLabel="Open your profile">
          <Ionicons name="person" size={16} color={C.onPrimary} />
        </TouchableOpacity>
      </View>

      {/* Session title bar */}
      <View style={styles.sessionBar}>
        <View style={styles.sessionLeft}>
          <Text style={styles.sessionLabel}>ACTIVE SESSION</Text>
          <Text style={styles.sessionTitle}>{workout.focus}</Text>
        </View>
        <View style={styles.sessionRight}>
          <Text style={styles.estLabel}>
            {doneSets > 0 ? `~${formatRemaining(remainingSec).toUpperCase()} LEFT` : `EST. ${hubEstimateMin} MINS`}
          </Text>
          <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>
        </View>
      </View>

      {/* Progress bar — sweeps forward as sets are logged */}
      <View style={styles.progressTrack}>
        <AnimatedFill pct={Math.round(progress * 100)} style={styles.progressFill} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {travel && (
          <View style={styles.travelBanner}>
            <Ionicons name="airplane" size={15} color={C.primary} />
            <Text style={styles.travelBannerText}>
              Travel mode — this session is adapted to {describeTravelEquipment(travel.equipment)}.
            </Text>
          </View>
        )}
        {workout.progression?.isDeload ? (
          <View style={[styles.travelBanner, styles.deloadBanner]}>
            <Ionicons name="leaf" size={15} color={C.success} />
            <Text style={styles.travelBannerText}>
              Deload week — weights and volume are intentionally lighter so you recover and come back stronger.
            </Text>
          </View>
        ) : workout.progression?.phase === 'peak' ? (
          <View style={styles.travelBanner}>
            <Ionicons name="trending-up" size={15} color={C.primary} />
            <Text style={styles.travelBannerText}>
              Peak week — an extra set per lift to push this block's overload. Bring it.
            </Text>
          </View>
        ) : null}
        {exercises.map((ex) => {
          const exSets = sets[ex.id] ?? []
          const doneCount = exSets.filter(s => s.done).length
          const isExpanded = expandedId === ex.id
          const allDone = exSets.length > 0 && doneCount === exSets.length
          const p = targets[ex.id]
          const cols = columnsFor(exMetrics[ex.id])

          return (
            <View key={ex.id} style={styles.exerciseCard}>
              {/* Accordion header */}
              <TouchableOpacity
                style={styles.exerciseHeader}
                onPress={() => toggleExpand(ex.id)}
                activeOpacity={0.7}
              >
                {/* GIF thumbnail */}
                <View style={styles.thumbWrap}>
                  {getExerciseGifSource(ex.id) ? (
                    <Image
                      source={getExerciseGifSource(ex.id)!}
                      style={styles.thumb}
                      contentFit="contain"
                    />
                  ) : gifIds[ex.id] ? (
                    <Image
                      source={gifSource(gifIds[ex.id]!)}
                      style={styles.thumb}
                      contentFit="contain"
                    />
                  ) : (
                    <Ionicons name="barbell-outline" size={22} color={C.outlineVariant} />
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.exerciseName}>{ex.name}</Text>
                  <Text style={styles.muscleLabel}>
                    {ex.primary_muscles.join(' · ').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                  {allDone ? (
                    <PopIn style={styles.doneChip}>
                      <Ionicons name="checkmark-circle" size={14} color={C.success} />
                      <Text style={styles.doneChipText}>Done</Text>
                    </PopIn>
                  ) : (
                    <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: C.outline }}>
                      {doneCount}/{exSets.length}
                    </Text>
                  )}
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={C.outline}
                  />
                </View>
              </TouchableOpacity>

              {isExpanded && (
                <>
                  {/* Coach prescription: what to do this session */}
                  {p && (
                    <View style={styles.targetCard}>
                      <View style={styles.targetRow}>
                        <View style={styles.targetLeft}>
                          <Text style={styles.targetEyebrow}>TODAY'S TARGET</Text>
                          <Text style={styles.targetValue}>
                            {formatTarget(p, exMetrics[ex.id], exSets[0], unit)}
                          </Text>
                        </View>
                        {p.direction !== 'new' && (
                          <View style={[
                            styles.dirBadge,
                            p.direction === 'up' && { backgroundColor: C.successSoft },
                            p.direction === 'down' && { backgroundColor: C.dangerSoft },
                          ]}>
                            <Ionicons
                              name={p.direction === 'up' ? 'trending-up' : p.direction === 'down' ? 'trending-down' : 'remove'}
                              size={13}
                              color={p.direction === 'up' ? C.success : p.direction === 'down' ? C.error : C.textSecondary}
                            />
                            <Text style={[
                              styles.dirBadgeText,
                              { color: p.direction === 'up' ? C.success : p.direction === 'down' ? C.error : C.textSecondary },
                            ]}>
                              {p.direction === 'up' ? 'GO UP' : p.direction === 'down' ? 'BACK OFF' : 'HOLD'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.targetReason}>{p.reason}</Text>
                      {p.direction === 'new' && p.suggestedWeight == null && (exMetrics[ex.id]?.includes('weight') ?? true) && (
                        <Text style={styles.firstTimeHint}>
                          First time on this lift? Start light — a weight you could do ~15 times —
                          and treat your first set or two as warm-ups. Tempo calibrates from what you log.
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Form guide + smart swap */}
                  <View style={styles.exActions}>
                    <PressableScale style={styles.exActionBtn} onPress={() => setFormSheetEx(ex)} scaleTo={0.93}>
                      <Ionicons name="book-outline" size={15} color={C.primary} />
                      <Text style={styles.exActionText}>Form guide</Text>
                    </PressableScale>
                    <PressableScale style={styles.exActionBtn} onPress={() => handleSwap(ex)} disabled={swapping} scaleTo={0.93}>
                      <Ionicons name="swap-horizontal" size={15} color={C.primary} />
                      <Text style={styles.exActionText}>Swap</Text>
                    </PressableScale>
                  </View>

                  {/* Table header — columns follow this exercise's tracked metrics */}
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeadCell, { flex: 0.5 }]}>SET</Text>
                    <Text style={[styles.tableHeadCell, { flex: 1.5 }]}>PREV</Text>
                    {cols.map((c) => (
                      <Text key={c.key} style={styles.tableHeadCell}>
                        {c.key === 'weight' ? unitLabel(unit).toUpperCase() : c.label}
                      </Text>
                    ))}
                    <Text style={[styles.tableHeadCell, { flex: 0.5 }]}>✓</Text>
                    <View style={styles.setTrashSpacer} />
                  </View>

                  {/* Set rows — ✓ logs instantly (rest starts, haptic fires); RPE
                      is an optional follow-up bar, never a gate. */}
                  {exSets.map((set, idx) => {
                    const followingUp = rpeFollowUp?.exId === ex.id && rpeFollowUp?.idx === idx
                    return (
                    <View key={idx}>
                      <View style={styles.setRow}>
                        <Text style={styles.setNum}>{idx + 1}</Text>

                        {/* PREV column — what you did last session */}
                        <Text style={[styles.setCell, styles.prevCell]}>
                          {prevBySet[ex.id]?.[idx] ?? '—'}
                        </Text>

                        {set.done ? (
                          <>
                            {cols.map((c) => <Text key={c.key} style={styles.setCell}>{set[c.field] || '0'}</Text>)}
                            {/* Mounts the moment the set is logged — springs in */}
                            <PopIn style={styles.checkCircleFilled}>
                              <Ionicons name="checkmark" size={14} color={C.onPrimary} />
                            </PopIn>
                          </>
                        ) : (
                          <>
                            {cols.map((c) => (
                              <View key={c.key} style={styles.inputBox}>
                                <TextInput
                                  style={styles.inputText}
                                  value={set[c.field]}
                                  onChangeText={v => updateSet(ex.id, idx, c.field, v)}
                                  keyboardType={c.kbd}
                                  placeholder="0"
                                  placeholderTextColor={C.outline}
                                />
                              </View>
                            ))}
                            <PressableScale
                              style={styles.emptyCircle}
                              onPress={() => handleSetDone(ex.id, idx)}
                              scaleTo={0.8}
                              hitSlop={6}
                              accessibilityLabel={`Log set ${idx + 1}`}
                            >
                              <View />
                            </PressableScale>
                          </>
                        )}

                        <TouchableOpacity
                          onPress={() => removeSet(ex.id, idx)}
                          hitSlop={8}
                          style={styles.setTrash}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove set ${idx + 1}`}
                        >
                          <Ionicons name="trash-outline" size={15} color={C.outlineVariant} />
                        </TouchableOpacity>
                      </View>

                      {/* Optional RPE follow-up — shows only for the set that just logged */}
                      {followingUp && set.done && (
                        <View style={styles.rpeBar}>
                          <Text style={styles.rpeBarLabel}>How hard?</Text>
                          {RPE_OPTIONS.map(n => (
                            <PressableScale key={n} style={styles.rpeChip} onPress={() => attachRpe(ex.id, idx, n)} scaleTo={0.88}>
                              <Text style={styles.rpeChipText}>{n}</Text>
                            </PressableScale>
                          ))}
                          <TouchableOpacity style={styles.rpeSkip} onPress={() => setRpeFollowUp(null)}>
                            <Text style={styles.rpeSkipText}>skip</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {set.done && set.rpe != null && (
                        <Text style={styles.rpeLogged}>Logged · RPE {set.rpe}</Text>
                      )}
                    </View>
                    )
                  })}

                  {/* Add Set */}
                  <PressableScale style={styles.addSetBtn} onPress={() => addSet(ex.id)} scaleTo={0.95}>
                    <Text style={styles.addSetBtnText}>+ Add Set</Text>
                  </PressableScale>
                </>
              )}
            </View>
          )
        })}

        {/* Add an exercise mid-session — machine taken, extra energy, whatever.
            The "today only vs permanently" choice is explicit (see sheet below). */}
        <PressableScale style={styles.addExerciseBtn} onPress={() => setAddExOpen(true)} scaleTo={0.97}>
          <Ionicons name="add" size={18} color={C.primary} />
          <Text style={styles.addExerciseText}>Add Exercise</Text>
        </PressableScale>

        {/* Complete Workout — shifts to sage the moment every set is banked */}
        <PressableScale
          style={[
            styles.completeButton,
            progress === 1 && styles.completeButtonReady,
            completing && { opacity: 0.6 },
          ]}
          onPress={handleCompleteWorkout}
          disabled={completing}
        >
          {completing ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <>
              <Text style={styles.completeButtonText}>
                {progress === 1 ? 'ALL SETS DONE — FINISH' : 'COMPLETE WORKOUT'}
              </Text>
              <Ionicons name="checkmark" size={16} color={C.onPrimary} />
            </>
          )}
        </PressableScale>
      </ScrollView>

      {restSecondsLeft !== null && (
        <PopIn style={styles.restPill}>
          <View style={styles.restPillRow}>
            <Ionicons name="timer-outline" size={18} color="#fff" />
            <Text style={styles.restPillText}>Rest · {formatElapsed(restSecondsLeft)}</Text>
            <TouchableOpacity onPress={stopRest}>
              <Text style={styles.restPillSkip}>Skip</Text>
            </TouchableOpacity>
          </View>
          {/* Time draining out of the bar — you can feel the next set coming */}
          <View style={styles.restPillTrack}>
            <AnimatedFill
              pct={Math.max(0, Math.min(100, (restSecondsLeft / Math.max(1, restTotal)) * 100))}
              style={styles.restPillFill}
            />
          </View>
        </PopIn>
      )}
      <View style={styles.floatingTools}>
        <PressableScale
          style={[styles.floatingTool, restSecondsLeft !== null && styles.floatingToolActive]}
          onPress={handleRestTimer}
          scaleTo={0.85}
          accessibilityLabel={restSecondsLeft !== null ? 'Stop rest timer' : 'Start rest timer'}
        >
          <Ionicons name="timer-outline" size={22} color={C.primary} />
        </PressableScale>
        <PressableScale style={styles.floatingTool} onPress={handleShowExerciseList} scaleTo={0.85} accessibilityLabel="Show exercise list">
          <Ionicons name="list-outline" size={22} color={C.primary} />
        </PressableScale>
      </View>

      <ExerciseFormSheet exercise={formSheetEx} onClose={() => setFormSheetEx(null)} />
      <OptionSheet
        visible={restSheet}
        title="Rest timer"
        subtitle={`Suggested: 2 minutes. Your pick becomes this workout's rest between sets — you'll feel a buzz when it's time, even with the phone locked.${restOverride ? ` Current: ${Math.round(restOverride)}s.` : ''}`}
        options={[
          { key: '60', label: '60 seconds', sub: 'Short and sweaty — supersets, accessories', icon: 'timer-outline' },
          { key: '90', label: '90 seconds', sub: 'Hypertrophy pace', icon: 'timer-outline' },
          { key: '120', label: '2 minutes', sub: 'Suggested — solid recovery for most lifts', icon: 'star-outline' },
          { key: '180', label: '3 minutes', sub: 'Full recovery for heavy compound sets', icon: 'timer-outline' },
          { key: 'custom', label: 'Custom…', sub: 'Pick any length', icon: 'options-outline' },
        ]}
        onSelect={pickRest}
        onClose={() => setRestSheet(false)}
      />

      {/* Custom rest length — stepper in 15s increments */}
      <Modal visible={customRestOpen} animationType="fade" transparent onRequestClose={() => setCustomRestOpen(false)}>
        <View style={styles.customRestBackdrop}>
          <View style={styles.customRestCard}>
            <Text style={styles.customRestTitle}>Custom rest</Text>
            <View style={styles.customRestRow}>
              <PressableScale
                style={styles.customRestStep}
                onPress={() => setCustomRestSec(s => Math.max(15, s - 15))}
                scaleTo={0.9}
                accessibilityLabel="15 seconds less"
              >
                <Ionicons name="remove" size={22} color={C.text} />
              </PressableScale>
              <Text style={styles.customRestValue}>{formatElapsed(customRestSec)}</Text>
              <PressableScale
                style={styles.customRestStep}
                onPress={() => setCustomRestSec(s => Math.min(600, s + 15))}
                scaleTo={0.9}
                accessibilityLabel="15 seconds more"
              >
                <Ionicons name="add" size={22} color={C.text} />
              </PressableScale>
            </View>
            <PressableScale
              style={styles.customRestStart}
              onPress={() => { setCustomRestOpen(false); applyRestChoice(customRestSec) }}
            >
              <Text style={styles.customRestStartText}>Start rest</Text>
            </PressableScale>
            <TouchableOpacity onPress={() => setCustomRestOpen(false)} style={{ paddingVertical: Spacing.xs }}>
              <Text style={styles.customRestCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add exercise mid-session: pick, then decide how long it sticks around. */}
      <ExercisePickerSheet
        visible={addExOpen}
        userId={userId}
        client={supabase}
        existingIds={exercises.map(e => e.id)}
        onClose={() => setAddExOpen(false)}
        onAdd={(ex: Exercise) => { setAddExOpen(false); setAddChoiceEx(ex as unknown as ExerciseRow) }}
        onRemove={() => {}}
      />
      <OptionSheet
        visible={addChoiceEx !== null}
        title={addChoiceEx ? `Add ${addChoiceEx.name}` : ''}
        subtitle="Just for today, or part of this workout from now on?"
        options={[
          { key: 'today', label: 'Add for this session only', sub: 'One-off — tomorrow the workout is unchanged', icon: 'today-outline' },
          { key: 'permanent', label: 'Add to workout permanently', sub: 'Becomes part of this workout going forward', icon: 'bookmark-outline' },
        ]}
        onSelect={(key) => {
          const ex = addChoiceEx
          setAddChoiceEx(null)
          if (ex) addExerciseToSession(ex, key === 'permanent').catch(() => {})
        }}
        onClose={() => setAddChoiceEx(null)}
      />

      {/* Pause / end — explicit about what happens to progress. */}
      <OptionSheet
        visible={pauseSheet}
        title="Pause workout?"
        subtitle="Logged sets are saved either way."
        options={[
          { key: 'pause', label: 'Resume later', sub: 'Save progress and step out — pick it up from the Workouts tab any time', icon: 'pause-circle-outline' },
          { key: 'end', label: 'End workout', sub: doneSets > 0 ? 'Finish now — everything you logged counts' : 'Discard this session — nothing is logged yet', icon: 'flag-outline', destructive: doneSets === 0 },
        ]}
        onSelect={onPauseChoice}
        onClose={() => setPauseSheet(false)}
      />
    </ScreenTransition>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
// All original styles preserved. New styles appended at the bottom.

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.lg, paddingBottom: 150 },
  travelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.sm,
  },
  travelBannerText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  deloadBanner: { backgroundColor: C.successSoft },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  headerLogo: { fontFamily: C.fontDisplay, fontSize: 16, color: C.primary, letterSpacing: 2 },
  avatar: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sessionBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.sm,
  },
  sessionLeft: { gap: 2 },
  sessionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  sessionTitle: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.24 },
  sessionRight: { alignItems: 'flex-end', gap: 2 },
  estLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  timerText: { fontFamily: C.fontNumeric, fontSize: 24, color: C.text, letterSpacing: -0.5 },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.md },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  exerciseCard: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, ...CardShadow, borderWidth: 1, borderColor: C.outlineVariant },
  exerciseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  thumbWrap: {
    width: 58, height: 58, borderRadius: 12,
    backgroundColor: C.surfaceContainerLow,
    borderWidth: 1, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', flexShrink: 0,
  },
  thumb: { width: 58, height: 58 },
  exerciseName: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text, letterSpacing: -0.2 },
  exerciseTarget: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, marginTop: 2 },
  timerRing: { width: 52, height: 52, borderRadius: Radius.full, borderWidth: 3, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  timerRingText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  tableHeader: { flexDirection: 'row', paddingBottom: Spacing.xs, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh },
  tableHeadCell: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.5, textAlign: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, gap: Spacing.xs },
  setRowActive: { backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: C.primary, paddingHorizontal: Spacing.sm, marginHorizontal: -Spacing.sm },
  setNum: { width: 28, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.outline, textAlign: 'center' },
  setNumActive: { color: C.primary },
  setCell: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, textAlign: 'center' },
  inputBox: { flex: 1, height: 40, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.outlineVariant },
  inputText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, textAlign: 'center', width: '100%' },
  addBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  checkCircle: { width: 28, height: 28, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  emptyCircle: { width: 28, height: 28, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant, alignSelf: 'center' },
  completeButton: { height: 52, backgroundColor: C.primary, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  completeButtonText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.onPrimary, letterSpacing: 1 },
  upNextSection: { gap: Spacing.sm },
  upNextLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline, letterSpacing: 0.6 },
  upNextCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  upNextImage: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  upNextInfo: { flex: 1 },
  upNextName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  upNextMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 2 },
  floatingTools: { position: 'absolute', right: Spacing.containerPadding, bottom: 112, gap: Spacing.sm },
  floatingTool: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center', ...CardShadow, shadowOpacity: 0.08 },

  // ── New ───────────────────────────────────────────────────────────────────
  checkCircleFilled: {
    width: 28, height: 28, borderRadius: Radius.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  prevCell: { flex: 1.5, fontSize: 13, color: C.outline },
  muscleLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary, letterSpacing: 0.6, marginTop: 2 },
  addSetBtn: { paddingVertical: Spacing.sm, alignItems: 'center' },
  addSetBtnText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  emptyStateContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  emptyIconWrap: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  emptyStateText: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, textAlign: 'center', marginBottom: Spacing.xs },
  emptyStateSubtext: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 22 },
  quickCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: C.primary, borderRadius: Radius.lg, height: 52, paddingHorizontal: Spacing.xl, marginTop: Spacing.lg, alignSelf: 'stretch' },
  quickCtaText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  // Wraps: four links (Quick Workout / My Workouts / My Splits / History) must fit
  // any screen width — chips flow onto a second line instead of running off-screen.
  emptyLinksRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.lg },
  emptyLink: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  emptyLinkText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  floatingToolActive: { borderWidth: 1.5, borderColor: C.primary },
  restPill: {
    position: 'absolute',
    bottom: 112,           // floats above the tab dock
    alignSelf: 'center',
    minWidth: 230,
    gap: 8,
    backgroundColor: '#1B1C20',
    borderRadius: Radius.xl,
    paddingVertical: 12,
    paddingHorizontal: 20,
    zIndex: 40,
    shadowColor: '#101114',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 8,
  },
  restPillRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  restPillText: {
    fontFamily: C.fontNumeric,
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
  },
  restPillSkip: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#8DB4FF',
  },
  restPillTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  restPillFill: { height: 3, borderRadius: 2, backgroundColor: '#4E8BFF' },
  doneChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.successSoft, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs, paddingVertical: 3,
  },
  doneChipText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.success },
  completeButtonReady: { backgroundColor: C.success },

  // ── Adaptive coaching (Track 1) ─────────────────────────────────────────────
  targetCard: {
    backgroundColor: C.primarySoft,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 6,
  },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  targetLeft: { flex: 1, gap: 2 },
  targetEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.6 },
  targetValue: { fontFamily: C.fontDisplay, fontSize: 17, color: C.text, letterSpacing: -0.2 },
  dirBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs, paddingVertical: 4,
  },
  dirBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  targetReason: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  firstTimeHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, lineHeight: 17, fontStyle: 'italic' },
  exActions: { flexDirection: 'row', gap: Spacing.sm },
  exActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  exActionText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  emptyCircleActive: { borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  rpeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, marginBottom: Spacing.xs,
  },
  rpeBarLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary, marginRight: 2 },
  rpeChip: {
    flex: 1, height: 32, borderRadius: Radius.sm, backgroundColor: C.background,
    borderWidth: 1, borderColor: C.outlineVariant, alignItems: 'center', justifyContent: 'center',
  },
  rpeChipText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  rpeSkip: { paddingHorizontal: 4 },
  rpeSkipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline },
  rpeLogged: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline, textAlign: 'right', marginTop: -2, marginBottom: 4 },

  // ── Hub (pre-session) ───────────────────────────────────────────────────────
  hubHero: { gap: 4 },
  hubEyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  hubEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  originChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1,
  },
  originChipTempo: { backgroundColor: C.primarySoft, borderColor: 'transparent' },
  originChipYours: { backgroundColor: C.surfaceContainerLow, borderColor: C.outlineVariant },
  originText: { fontFamily: 'Inter_700Bold', fontSize: 10.5, letterSpacing: 0.3 },
  hubTitle: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.4 },
  hubMeta: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  hubList: {
    backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, ...CardShadow,
  },
  hubRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  hubRowDivider: { borderTopWidth: 1, borderTopColor: C.surfaceContainerHigh },
  hubRowNum: { fontFamily: C.fontDisplay, fontSize: 14, color: C.outline, width: 20, textAlign: 'center' },
  hubRowName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  hubRowMuscle: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, letterSpacing: 0.4, marginTop: 1 },
  hubRowSets: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },
  hubStartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 56, borderRadius: Radius.lg, backgroundColor: C.primary,
  },
  hubStartText: { fontFamily: C.fontDisplay, fontSize: 16, color: C.onPrimary, letterSpacing: 0.2 },

  // ── Session controls (pause, remove set, add exercise, custom rest) ─────────
  pauseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  pauseBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text },
  setTrash: { width: 22, alignItems: 'center', justifyContent: 'center' },
  setTrashSpacer: { width: 22 },
  addExerciseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.primary,
    backgroundColor: C.surfaceContainerLow,
  },
  addExerciseText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  customRestBackdrop: {
    flex: 1, backgroundColor: 'rgba(27,27,28,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xl,
  },
  customRestCard: {
    alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.md, alignItems: 'center', ...CardShadow,
  },
  customRestTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  customRestRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  customRestStep: {
    width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow,
    borderWidth: 1, borderColor: C.outlineVariant, alignItems: 'center', justifyContent: 'center',
  },
  customRestValue: { fontFamily: C.fontNumeric, fontSize: 32, color: C.text, minWidth: 96, textAlign: 'center' },
  customRestStart: {
    alignSelf: 'stretch', height: 50, borderRadius: Radius.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  customRestStartText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
  customRestCancel: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
})
