import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkoutRow = { planned_date: string; status: string }

type EnrichedSetLog = {
  workout_log_id: string
  exercise_id: string
  weight_lbs: number | null
  reps_completed: number
  completed_at: string | null
  exerciseName: string
}

type SetLogsResult = {
  setLogs: EnrichedSetLog[]
  logDates: Map<string, string>   // workout_log_id → started_at ISO string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function getMondayOf(d: Date): Date {
  const result = new Date(d)
  result.setHours(0, 0, 0, 0)
  const monBased = (result.getDay() + 6) % 7
  result.setDate(result.getDate() - monBased)
  return result
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_NAMES = ['M','T','W','T','F','S','S']

export type ChartPeriod = 'W' | 'M' | '6M'

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useProgressStats(userId: string, period: ChartPeriod = 'M') {
  const workoutsQ = useQuery<WorkoutRow[]>({
    queryKey: ['progress_workouts', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('scheduled_workouts')
        .select('planned_date, status')
        .eq('user_id', userId)
      return (data ?? []) as WorkoutRow[]
    },
    enabled: !!userId,
  })

  const setLogsQ = useQuery<SetLogsResult>({
    queryKey: ['progress_set_logs', userId],
    queryFn: async () => {
      const empty: SetLogsResult = { setLogs: [], logDates: new Map() }

      const { data: logs } = await supabase
        .from('workout_logs')
        .select('id, started_at')
        .eq('user_id', userId)

      if (!logs?.length) return empty

      const logIds = logs.map(l => l.id as string)
      const logDates = new Map<string, string>(logs.map(l => [l.id as string, l.started_at as string]))

      const { data: sets } = await supabase
        .from('set_logs')
        .select('workout_log_id, exercise_id, weight_lbs, reps_completed, completed_at')
        .in('workout_log_id', logIds)

      if (!sets?.length) return { setLogs: [], logDates }

      const exIds = [...new Set((sets as any[]).map(s => s.exercise_id as string))]
      const { data: exRows } = await supabase
        .from('exercises')
        .select('id, name')
        .in('id', exIds)

      const exNameMap = new Map<string, string>(
        (exRows ?? []).map(e => [e.id as string, e.name as string])
      )

      const setLogs: EnrichedSetLog[] = (sets as any[]).map(s => ({
        workout_log_id: s.workout_log_id as string,
        exercise_id: s.exercise_id as string,
        weight_lbs: s.weight_lbs as number | null,
        reps_completed: s.reps_completed as number,
        completed_at: s.completed_at as string | null,
        exerciseName: exNameMap.get(s.exercise_id as string) ?? 'Unknown',
      }))

      return { setLogs, logDates }
    },
    enabled: !!userId,
  })

  // ── Derived metrics ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const workouts = workoutsQ.data ?? []
    const setLogs = setLogsQ.data?.setLogs ?? []
    const logDates = setLogsQ.data?.logDates ?? new Map<string, string>()

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    function daysAgo(n: number): Date {
      const d = new Date(today)
      d.setDate(today.getDate() - n)
      return d
    }

    // a) Consistency — last 30 days + delta vs prior 30.
    // 'rescheduled' rows are superseded duplicates / cleared sessions — they were
    // never real commitments, so they don't count toward the completion rate.
    const counts = (w: WorkoutRow) => w.status !== 'rescheduled'
    const thirtyAgo = toDateStr(daysAgo(30))
    const sixtyAgo = toDateStr(daysAgo(60))
    const last30 = workouts.filter(w => counts(w) && w.planned_date >= thirtyAgo)
    const prev30 = workouts.filter(w => counts(w) && w.planned_date >= sixtyAgo && w.planned_date < thirtyAgo)

    const consistency_pct = last30.length
      ? Math.round((last30.filter(w => w.status === 'completed').length / last30.length) * 100)
      : 0

    const prevConsistency = prev30.length
      ? Math.round((prev30.filter(w => w.status === 'completed').length / prev30.length) * 100)
      : null

    const delta = prevConsistency !== null ? consistency_pct - prevConsistency : null
    const deltaStr = delta !== null
      ? `${delta >= 0 ? '+' : ''}${delta}% vs last mo`
      : '— vs last mo'

    // b) Streak
    const completedDates = new Set(
      workouts.filter(w => w.status === 'completed').map(w => w.planned_date)
    )
    let streak = 0
    const cur = new Date(today)
    while (completedDates.has(toDateStr(cur))) {
      streak++
      cur.setDate(cur.getDate() - 1)
    }

    // c) This week
    const monday = getMondayOf(today)
    const thisWeek = workouts.filter(
      w => w.status === 'completed' && w.planned_date >= toDateStr(monday)
    ).length

    // d) Total volume (all-time)
    const totalVolumeNum = setLogs.reduce(
      (sum, sl) => sl.weight_lbs != null ? sum + sl.weight_lbs * sl.reps_completed : sum,
      0
    )
    const totalVolume = totalVolumeNum > 0
      ? Math.round(totalVolumeNum).toLocaleString()
      : '0'

    // Heaviest bench (for the "First 225 Bench" achievement) + heaviest single lift
    let benchMax = 0
    let heaviestLift = 0
    for (const sl of setLogs) {
      if (sl.weight_lbs == null) continue
      if (sl.weight_lbs > heaviestLift) heaviestLift = sl.weight_lbs
      if (/bench/i.test(sl.exerciseName) && sl.weight_lbs > benchMax) benchMax = sl.weight_lbs
    }

    // e) Personal records
    const prMap: Record<string, { name: string; maxWeight: number; achievedAt: string }> = {}
    for (const sl of setLogs) {
      if (sl.weight_lbs == null || sl.weight_lbs <= 0) continue
      const key = sl.exercise_id
      if (!prMap[key] || sl.weight_lbs > prMap[key].maxWeight) {
        prMap[key] = {
          name: sl.exerciseName,
          maxWeight: sl.weight_lbs,
          achievedAt: sl.completed_at ?? '',
        }
      }
    }
    const prs = Object.values(prMap)
      .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt))
      .slice(0, 5)

    // f) Weekly volume — legacy 8-week array (still used for 'M' period)
    const weekVolumes = Array<number>(8).fill(0)
    for (const sl of setLogs) {
      if (sl.weight_lbs == null) continue
      const startedAt = logDates.get(sl.workout_log_id)
      if (!startedAt) continue
      const msAgo = today.getTime() - new Date(startedAt).getTime()
      const weeksAgo = Math.floor(msAgo / (7 * 24 * 60 * 60 * 1000))
      if (weeksAgo >= 0 && weeksAgo < 8) {
        weekVolumes[7 - weeksAgo] += sl.weight_lbs * sl.reps_completed
      }
    }

    // g) Period-aware chart data
    let chartVolumes: number[]
    let chartLabels: string[]

    if (period === 'W') {
      chartVolumes = Array(7).fill(0)
      for (const sl of setLogs) {
        if (sl.weight_lbs == null) continue
        const startedAt = logDates.get(sl.workout_log_id)
        if (!startedAt) continue
        const msAgo = today.getTime() - new Date(startedAt).getTime()
        const daysAgoCount = Math.floor(msAgo / (24 * 60 * 60 * 1000))
        if (daysAgoCount >= 0 && daysAgoCount < 7) {
          chartVolumes[6 - daysAgoCount] += sl.weight_lbs * sl.reps_completed
        }
      }
      chartLabels = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today)
        d.setDate(today.getDate() - (6 - i))
        return DAY_NAMES[(d.getDay() + 6) % 7]
      })
    } else if (period === '6M') {
      chartVolumes = Array(6).fill(0)
      for (const sl of setLogs) {
        if (sl.weight_lbs == null) continue
        const startedAt = logDates.get(sl.workout_log_id)
        if (!startedAt) continue
        const d = new Date(startedAt)
        const monthsAgo =
          (today.getFullYear() - d.getFullYear()) * 12 +
          (today.getMonth() - d.getMonth())
        if (monthsAgo >= 0 && monthsAgo < 6) {
          chartVolumes[5 - monthsAgo] += sl.weight_lbs * sl.reps_completed
        }
      }
      chartLabels = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(today)
        d.setMonth(today.getMonth() - (5 - i))
        return MONTH_NAMES[d.getMonth()]
      })
    } else {
      // 'M' — 8-week bars (default)
      chartVolumes = weekVolumes
      chartLabels = Array.from({ length: 8 }, (_, i) => `W${i + 1}`)
    }

    // Period-specific volume total
    const periodVolumeNum = chartVolumes.reduce((s, v) => s + v, 0)
    const periodVolume = periodVolumeNum > 0
      ? Math.round(periodVolumeNum).toLocaleString()
      : '0'

    const totalWorkouts = workouts.filter(w => w.status === 'completed').length

    return {
      consistency_pct,
      deltaStr,
      streak,
      thisWeek,
      totalVolume,
      totalVolumeNum: Math.round(totalVolumeNum),
      benchMax,
      heaviestLift,
      periodVolume,
      prs,
      weekVolumes,
      chartVolumes,
      chartLabels,
      totalWorkouts,
    }
  }, [workoutsQ.data, setLogsQ.data, period])

  return {
    stats,
    isLoading: workoutsQ.isLoading || setLogsQ.isLoading,
    isError: workoutsQ.isError || setLogsQ.isError,
    refetch: async () => { await Promise.all([workoutsQ.refetch(), setLogsQ.refetch()]) },
  }
}
