import { useEffect, useRef, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Animated,
} from 'react-native'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { cancelWorkoutReminder } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth'
import { buildPrescription, type ExercisePrescription, type SetPerformance } from '@/lib/progression'
import { getTodayReadiness } from '@/lib/recovery'
import { ExerciseFormSheet } from '@/components/ExerciseFormSheet'
import { fetchExerciseId, gifSource } from '@/lib/exerciseGif'
import { getActiveTravelMode, describeTravelEquipment } from '@/lib/travelMode'
import type { Goal, TravelMode } from '@/types'

const C = Colors.light

const RPE_OPTIONS = [6, 7, 8, 9, 10]

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkoutRow {
  id: string
  focus: string
  planned_duration_min: number
  exercise_ids: string[]
  status: string
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
}

interface SetState {
  lbs: string
  reps: string
  rpe: number | null
  done: boolean
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
  const have = new Set<string>([...equipment, 'bodyweight'])
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkoutsScreen() {
  const router = useRouter()
  const { workoutId: workoutIdParam, quick: quickParam } = useLocalSearchParams<{ workoutId?: string; quick?: string }>()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [workout, setWorkout] = useState<WorkoutRow | null>(null)
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [workoutLogId, setWorkoutLogId] = useState<string | null>(null)
  const [sets, setSets] = useState<Record<string, SetState[]>>({})
  const [prevBySet, setPrevBySet] = useState<Record<string, string[]>>({})
  const [targets, setTargets] = useState<Record<string, ExercisePrescription>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [restSecondsLeft, setRestSecondsLeft] = useState<number | null>(null)
  const [rpePrompt, setRpePrompt] = useState<{ exId: string; idx: number } | null>(null)
  const [formSheetEx, setFormSheetEx] = useState<ExerciseRow | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [gifIds, setGifIds] = useState<Record<string, string | null>>({})
  const [goal, setGoal] = useState<Goal>('general_fitness')
  const [travel, setTravel] = useState<TravelMode | null>(null)
  const restDefaults = useRef<Record<string, number>>({})
  const startedAt = useRef(new Date())

  // ── Load ──────────────────────────────────────────────────────────────────

  // Reload when the target workout changes too — otherwise navigating into an
  // already-mounted Workouts tab with a new workoutId (e.g. starting a Quick
  // Workout, or a second "Start Session") would keep showing the stale session.
  useEffect(() => {
    if (!userId) return
    loadWorkout()
  }, [userId, workoutIdParam])

  async function loadWorkout() {
    let targetId: string | undefined = workoutIdParam

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
      if (!found) { setNotFound(true); setLoading(false); return }
      targetId = found.id
    }

    const { data: workoutRow } = await supabase
      .from('scheduled_workouts')
      .select('id, focus, planned_duration_min, exercise_ids, status')
      .eq('id', targetId)
      .single()

    if (!workoutRow) { setNotFound(true); setLoading(false); return }
    setWorkout(workoutRow as WorkoutRow)

    const exerciseIds: string[] = workoutRow.exercise_ids ?? []

    // The user's goal drives rep/rest schemes; a rough recovery day trims volume.
    const [{ data: profileRow }, readiness] = await Promise.all([
      supabase.from('user_profiles').select('goal').eq('user_id', userId).maybeSingle(),
      getTodayReadiness(userId),
    ])
    const goal = (profileRow?.goal ?? 'general_fitness') as Goal
    setGoal(goal)
    const readinessLow = readiness != null && readiness < 50

    // Fetch full exercise rows and restore the plan's original order
    const { data: exRows } = exerciseIds.length
      ? await supabase
          .from('exercises')
          .select('id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, video_url, substitute_ids')
          .in('id', exerciseIds)
      : { data: [] }

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
      fetchExerciseId(ex.name).then(id => {
        if (id) setGifIds(prev => ({ ...prev, [ex.id]: id }))
      })
    })

    // Build each exercise's "last session" performance → next-session prescription
    // + the per-set PREV column. History is read before the new log exists, so the
    // current session can't contaminate it.
    const prevBySetMap: Record<string, string[]> = {}
    const targetMap: Record<string, ExercisePrescription> = {}

    if (effectiveIds.length) {
      const { data: history } = await supabase
        .from('set_logs')
        .select('exercise_id, workout_log_id, set_number, weight_lbs, reps_completed, rpe, completed_at')
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
        prevBySetMap[ex.id] = lastSets.map(r =>
          r.weight_lbs != null ? `${r.weight_lbs}×${r.reps_completed}` : `${r.reps_completed}`)
        targetMap[ex.id] = buildPrescription(perf, goal, ex.movement_pattern, readinessLow)
      }
    }

    setPrevBySet(prevBySetMap)
    setTargets(targetMap)

    // Pre-fill sets from each prescription so logging is a one-tap confirm, not
    // manual entry — matching the "least manual input" principle.
    const initialSets: Record<string, SetState[]> = {}
    for (const ex of ordered) {
      const p = targetMap[ex.id]
      const count = p?.sets ?? 3
      restDefaults.current[ex.id] = p?.restSeconds ?? 90
      initialSets[ex.id] = Array.from({ length: count }, () => ({
        lbs: p?.suggestedWeight != null ? String(p.suggestedWeight) : '',
        reps: p ? String(p.repHigh) : '',
        rpe: null,
        done: false,
      }))
    }
    setSets(initialSets)

    // Create the workout log for this session
    startedAt.current = new Date()
    const { data: logRow } = await supabase
      .from('workout_logs')
      .insert({
        scheduled_workout_id: workoutRow.id,
        user_id: userId,
        started_at: startedAt.current.toISOString(),
      })
      .select('id')
      .single()
    if (logRow) setWorkoutLogId(logRow.id)

    setLoading(false)
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!workoutLogId) return
    const iv = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(iv)
  }, [workoutLogId])

  // ── Set actions ────────────────────────────────────────────────────────────

  const updateSet = (exId: string, idx: number, field: 'lbs' | 'reps', value: string) => {
    setSets(prev => ({
      ...prev,
      [exId]: prev[exId].map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }))
  }

  const handleSetDone = async (exId: string, idx: number, rpe: number | null) => {
    if (!workoutLogId) return
    const set = sets[exId]?.[idx]
    if (!set || set.done) return

    // Optimistically mark done in UI + record how hard it felt
    setRpePrompt(null)
    setSets(prev => ({
      ...prev,
      [exId]: prev[exId].map((s, i) => i === idx ? { ...s, rpe, done: true } : s),
    }))

    // Auto-start the rest timer using this exercise's prescribed rest
    setRestSecondsLeft(restDefaults.current[exId] ?? 90)

    await supabase.from('set_logs').insert({
      workout_log_id: workoutLogId,
      exercise_id: exId,
      set_number: idx + 1,
      reps_completed: parseInt(set.reps) || 0,
      weight_lbs: set.lbs ? parseFloat(set.lbs) : null,
      rpe,
      completed_at: new Date().toISOString(),
    })
  }

  const addSet = (exId: string) => {
    setSets(prev => ({
      ...prev,
      [exId]: [...prev[exId], { lbs: '', reps: '', rpe: null, done: false }],
    }))
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
      const equipment = new Set<string>([...(profileRow?.equipment ?? []), 'bodyweight'])
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
    const prescription = buildPrescription([], goal, next.movement_pattern, false)
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
          lbs: '', reps: String(prescription.repHigh), rpe: null, done: false,
        })),
      }
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

  const handleCompleteWorkout = async () => {
    if (!workout || !workoutLogId || completing) return
    setCompleting(true)
    const now = new Date().toISOString()
    const mins = Math.round(elapsed / 60)

    await Promise.all([
      supabase.from('scheduled_workouts')
        .update({ status: 'completed', completed_at: now })
        .eq('id', workout.id),
      supabase.from('workout_logs')
        .update({ completed_at: now })
        .eq('id', workoutLogId),
    ])

    cancelWorkoutReminder(workout.id).catch(() => {})

    // Motivational summary — streak impact, consistency, weekly target progress.
    router.replace({
      pathname: '/workout-complete',
      params: { minutes: String(mins), quick: quickParam === '1' ? '1' : '0' },
    })
  }

  // ── Rest timer ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (restSecondsLeft === null) return
    if (restSecondsLeft === 0) {
      setRestSecondsLeft(null)
      Alert.alert('Rest Complete!', 'Time for your next set.')
      return
    }
    const timer = setTimeout(() => setRestSecondsLeft(s => (s ?? 1) - 1), 1000)
    return () => clearTimeout(timer)
  }, [restSecondsLeft])

  const handleRestTimer = () => {
    if (restSecondsLeft !== null) {
      setRestSecondsLeft(null)
      return
    }
    Alert.alert('Rest Timer', 'How long to rest?', [
      { text: '60s', onPress: () => setRestSecondsLeft(60) },
      { text: '90s', onPress: () => setRestSecondsLeft(90) },
      { text: '120s', onPress: () => setRestSecondsLeft(120) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const handleShowExerciseList = () => {
    const list = exercises.map((ex, i) => `${i + 1}. ${ex.name}`).join('\n')
    Alert.alert('Exercise List', list || 'No exercises loaded.', [{ text: 'OK' }])
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  const totalSets = Object.values(sets).reduce((n, arr) => n + arr.length, 0)
  const doneSets = Object.values(sets).reduce((n, arr) => n + arr.filter(s => s.done).length, 0)
  const progress = totalSets > 0 ? doneSets / totalSets : 0

  // ── Early returns ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerLogo}>TEMPO</Text>
          <View style={styles.avatar}><Ionicons name="person" size={16} color={C.onPrimary} /></View>
        </View>
        <View style={styles.emptyStateContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </SafeAreaView>
    )
  }

  if (notFound || !workout) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerLogo}>TEMPO</Text>
          <View style={styles.avatar}><Ionicons name="person" size={16} color={C.onPrimary} /></View>
        </View>
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateText}>No workout scheduled today.</Text>
          <Text style={styles.emptyStateSubtext}>
            Check the Schedule tab to see upcoming workouts.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerLogo}>TEMPO</Text>
        <TouchableOpacity style={styles.avatar} onPress={() => router.push('/(tabs)/profile')}>
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
          <Text style={styles.estLabel}>EST. {workout.planned_duration_min} MINS</Text>
          <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as `${number}%` }]} />
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
        {exercises.map((ex) => {
          const exSets = sets[ex.id] ?? []
          const doneCount = exSets.filter(s => s.done).length
          const isExpanded = expandedId === ex.id
          const allDone = exSets.length > 0 && doneCount === exSets.length
          const p = targets[ex.id]

          return (
            <View key={ex.id} style={styles.exerciseCard}>
              {/* Accordion header */}
              <TouchableOpacity
                style={styles.exerciseHeader}
                onPress={() => setExpandedId(isExpanded ? null : ex.id)}
                activeOpacity={0.7}
              >
                {/* GIF thumbnail */}
                <View style={styles.thumbWrap}>
                  {gifIds[ex.id] ? (
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
                  <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: allDone ? C.success : C.outline }}>
                    {doneCount}/{exSets.length}
                  </Text>
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
                            {p.suggestedWeight != null ? `${p.suggestedWeight} lbs · ` : ''}{p.repLow}–{p.repHigh} reps × {p.sets}
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
                    </View>
                  )}

                  {/* Form guide + smart swap */}
                  <View style={styles.exActions}>
                    <TouchableOpacity style={styles.exActionBtn} onPress={() => setFormSheetEx(ex)}>
                      <Ionicons name="book-outline" size={15} color={C.primary} />
                      <Text style={styles.exActionText}>Form guide</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.exActionBtn} onPress={() => handleSwap(ex)} disabled={swapping}>
                      <Ionicons name="swap-horizontal" size={15} color={C.primary} />
                      <Text style={styles.exActionText}>Swap</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Table header */}
                  <View style={styles.tableHeader}>
                    {(['SET', 'PREV', 'LBS', 'REPS', '✓'] as const).map((h) => (
                      <Text
                        key={h}
                        style={[
                          styles.tableHeadCell,
                          (h === 'SET' || h === '✓') && { flex: 0.5 },
                          h === 'PREV' && { flex: 1.5 },
                        ]}
                      >
                        {h}
                      </Text>
                    ))}
                  </View>

                  {/* Set rows */}
                  {exSets.map((set, idx) => {
                    const prompting = rpePrompt?.exId === ex.id && rpePrompt?.idx === idx
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
                            <Text style={styles.setCell}>{set.lbs || '0'}</Text>
                            <Text style={styles.setCell}>{set.reps || '0'}</Text>
                            <View style={styles.checkCircleFilled}>
                              <Ionicons name="checkmark" size={14} color={C.onPrimary} />
                            </View>
                          </>
                        ) : (
                          <>
                            <View style={styles.inputBox}>
                              <TextInput
                                style={styles.inputText}
                                value={set.lbs}
                                onChangeText={v => updateSet(ex.id, idx, 'lbs', v)}
                                keyboardType="decimal-pad"
                                placeholder="0"
                                placeholderTextColor={C.outline}
                              />
                            </View>
                            <View style={styles.inputBox}>
                              <TextInput
                                style={styles.inputText}
                                value={set.reps}
                                onChangeText={v => updateSet(ex.id, idx, 'reps', v)}
                                keyboardType="number-pad"
                                placeholder="0"
                                placeholderTextColor={C.outline}
                              />
                            </View>
                            <TouchableOpacity
                              style={[styles.emptyCircle, prompting && styles.emptyCircleActive]}
                              onPress={() => setRpePrompt(prompting ? null : { exId: ex.id, idx })}
                            >
                              {prompting && <Ionicons name="chevron-up" size={14} color={C.primary} />}
                            </TouchableOpacity>
                          </>
                        )}
                      </View>

                      {/* RPE capture — appears when you tap the check */}
                      {prompting && !set.done && (
                        <View style={styles.rpeBar}>
                          <Text style={styles.rpeBarLabel}>How hard?</Text>
                          {RPE_OPTIONS.map(n => (
                            <TouchableOpacity key={n} style={styles.rpeChip} onPress={() => handleSetDone(ex.id, idx, n)}>
                              <Text style={styles.rpeChipText}>{n}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity style={styles.rpeSkip} onPress={() => handleSetDone(ex.id, idx, null)}>
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
                  <TouchableOpacity style={styles.addSetBtn} onPress={() => addSet(ex.id)}>
                    <Text style={styles.addSetBtnText}>+ Add Set</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )
        })}

        {/* Complete Workout */}
        <TouchableOpacity
          style={[styles.completeButton, completing && { opacity: 0.6 }]}
          onPress={handleCompleteWorkout}
          disabled={completing}
          activeOpacity={0.8}
        >
          {completing ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <>
              <Text style={styles.completeButtonText}>COMPLETE WORKOUT</Text>
              <Ionicons name="checkmark" size={16} color={C.onPrimary} />
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {restSecondsLeft !== null && (
        <View style={styles.restPill} pointerEvents="box-none">
          <Ionicons name="timer-outline" size={18} color="#fff" />
          <Text style={styles.restPillText}>Rest · {formatElapsed(restSecondsLeft)}</Text>
          <TouchableOpacity onPress={() => setRestSecondsLeft(null)}>
            <Text style={styles.restPillSkip}>Skip</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.floatingTools}>
        <TouchableOpacity
          style={[styles.floatingTool, restSecondsLeft !== null && styles.floatingToolActive]}
          onPress={handleRestTimer}
        >
          <Ionicons name="timer-outline" size={22} color={C.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.floatingTool} onPress={handleShowExerciseList}>
          <Ionicons name="list-outline" size={22} color={C.primary} />
        </TouchableOpacity>
      </View>

      <ExerciseFormSheet exercise={formSheetEx} onClose={() => setFormSheetEx(null)} />
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
// All original styles preserved. New styles appended at the bottom.

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.lg, paddingBottom: 120 },
  travelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.sm,
  },
  travelBannerText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  headerLogo: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.primary, letterSpacing: 2 },
  avatar: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sessionBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.sm,
  },
  sessionLeft: { gap: 2 },
  sessionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  sessionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: C.text, letterSpacing: -0.24 },
  sessionRight: { alignItems: 'flex-end', gap: 2 },
  estLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  timerText: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: C.text, letterSpacing: -0.5 },
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
  floatingTools: { position: 'absolute', right: Spacing.containerPadding, bottom: 100, gap: Spacing.sm },
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
  emptyStateText: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, textAlign: 'center', marginBottom: Spacing.xs },
  emptyStateSubtext: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 22 },
  floatingToolActive: { borderWidth: 1.5, borderColor: C.primary },
  restPill: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1B1B1C',
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: 20,
    zIndex: 40,
    shadowColor: '#1A1A1B',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 40,
    elevation: 8,
  },
  restPillText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
  },
  restPillSkip: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#8DB4FF',
  },

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
  targetValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.text, letterSpacing: -0.2 },
  dirBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs, paddingVertical: 4,
  },
  dirBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  targetReason: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18 },
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
})
