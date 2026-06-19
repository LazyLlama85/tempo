import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience, TimeOfDay } from '@/types'

export interface PlanProfile {
  goal: Goal
  experience: Experience
  equipment: string[]
  days_per_week: number
  preferred_duration_min: number
  preferred_time_of_day?: TimeOfDay | null
}

// Varied default start times per time-of-day, so a fresh plan doesn't read as the
// exact same hour every day. The Smart Scheduler later refines these around the
// user's real calendar; this just keeps the base plan from feeling robotic.
const START_TIMES: Record<TimeOfDay, string[]> = {
  morning:   ['07:00:00', '08:00:00', '06:30:00', '07:30:00'],
  afternoon: ['12:30:00', '15:30:00', '13:00:00', '16:00:00'],
  evening:   ['17:30:00', '18:30:00', '19:00:00', '18:00:00'],
}
function startTimeFor(tod: TimeOfDay, idx: number): string {
  const times = START_TIMES[tod]
  return times[idx % times.length]
}

// Mon=1 … Sun=7. Spread days to maximise recovery between sessions.
const DAY_SLOTS: Record<number, number[]> = {
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
}

const EXPERIENCE_ORDER: Experience[] = ['beginner', 'intermediate', 'advanced']

function getStartMonday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monBased = (today.getDay() + 6) % 7 // Mon=0 … Sun=6
  const monday = new Date(today)
  // Start this Monday if still early in the week (Mon–Wed), else next Monday
  monday.setDate(today.getDate() - (monBased <= 2 ? monBased : -(7 - monBased)))
  return monday
}

function formatDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type SessionTemplate = { focus: string; patterns: string[] }

// ── Goal-specific session templates ──────────────────────────────────────────

function muscleSessions(days: number): SessionTemplate[] {
  const push:   SessionTemplate = { focus: 'Push',    patterns: ['push', 'push', 'push', 'core'] }
  const pull:   SessionTemplate = { focus: 'Pull',    patterns: ['pull', 'pull', 'pull', 'core'] }
  const legs:   SessionTemplate = { focus: 'Legs',    patterns: ['squat', 'squat', 'hinge', 'hinge', 'core'] }
  const upperA: SessionTemplate = { focus: 'Upper A', patterns: ['push', 'push', 'pull', 'pull', 'core'] }
  const upperB: SessionTemplate = { focus: 'Upper B', patterns: ['pull', 'pull', 'push', 'push', 'core'] }
  const lowerA: SessionTemplate = { focus: 'Lower A', patterns: ['squat', 'squat', 'hinge', 'core'] }
  const lowerB: SessionTemplate = { focus: 'Lower B', patterns: ['hinge', 'hinge', 'squat', 'core'] }

  if (days === 2) return [upperA, lowerA]
  if (days === 3) return [push, pull, legs]
  if (days === 4) return [upperA, lowerA, upperB, lowerB]
  return [push, pull, legs, upperA, lowerA]
}

function strengthSessions(days: number): SessionTemplate[] {
  const squat: SessionTemplate = { focus: 'Squat Day',    patterns: ['squat', 'squat', 'squat', 'hinge', 'core'] }
  const bench: SessionTemplate = { focus: 'Press Day',    patterns: ['push', 'push', 'push', 'pull', 'core'] }
  const dead:  SessionTemplate = { focus: 'Deadlift Day', patterns: ['hinge', 'hinge', 'hinge', 'squat', 'core'] }
  const row:   SessionTemplate = { focus: 'Pull Day',     patterns: ['pull', 'pull', 'pull', 'push', 'core'] }
  const upper: SessionTemplate = { focus: 'Upper',        patterns: ['push', 'pull', 'push', 'pull', 'core'] }

  if (days === 2) return [squat, bench]
  if (days === 3) return [squat, bench, dead]
  if (days === 4) return [squat, bench, dead, row]
  return [squat, bench, dead, row, upper]
}

function fatLossSessions(days: number): SessionTemplate[] {
  // Full-body circuits keep heart rate up; cardio pattern slots in metabolic moves.
  const fbA:  SessionTemplate = { focus: 'Full Body A',   patterns: ['squat', 'push', 'pull', 'hinge', 'cardio'] }
  const fbB:  SessionTemplate = { focus: 'Full Body B',   patterns: ['hinge', 'pull', 'push', 'squat', 'cardio'] }
  const fbC:  SessionTemplate = { focus: 'Full Body C',   patterns: ['push', 'squat', 'hinge', 'pull', 'core'] }
  const cond: SessionTemplate = { focus: 'Conditioning',  patterns: ['cardio', 'squat', 'push', 'cardio', 'core'] }
  const upCi: SessionTemplate = { focus: 'Upper Circuit', patterns: ['push', 'pull', 'push', 'cardio', 'core'] }

  if (days === 2) return [fbA, fbB]
  if (days === 3) return [fbA, fbB, fbC]
  if (days === 4) return [fbA, fbB, fbC, cond]
  return [fbA, fbB, fbC, cond, upCi]
}

function athleticSessions(days: number): SessionTemplate[] {
  const power: SessionTemplate = { focus: 'Power',       patterns: ['hinge', 'squat', 'push', 'cardio', 'core'] }
  const upper: SessionTemplate = { focus: 'Upper Power', patterns: ['push', 'push', 'pull', 'pull', 'core'] }
  const lower: SessionTemplate = { focus: 'Lower Power', patterns: ['squat', 'squat', 'hinge', 'hinge', 'cardio'] }
  const cond:  SessionTemplate = { focus: 'Conditioning',patterns: ['cardio', 'cardio', 'squat', 'push', 'core'] }
  const full:  SessionTemplate = { focus: 'Full Body',   patterns: ['squat', 'push', 'pull', 'hinge', 'cardio'] }

  if (days === 2) return [upper, lower]
  if (days === 3) return [power, upper, lower]
  if (days === 4) return [power, upper, lower, cond]
  return [power, upper, lower, cond, full]
}

function generalSessions(days: number): SessionTemplate[] {
  const fullA:  SessionTemplate = { focus: 'Full Body A', patterns: ['squat', 'hinge', 'push', 'pull', 'core'] }
  const fullB:  SessionTemplate = { focus: 'Full Body B', patterns: ['push', 'pull', 'squat', 'hinge', 'core'] }
  const fullC:  SessionTemplate = { focus: 'Full Body C', patterns: ['hinge', 'squat', 'pull', 'push', 'core'] }
  const upper:  SessionTemplate = { focus: 'Upper Body',  patterns: ['push', 'push', 'pull', 'pull', 'core'] }
  const lower:  SessionTemplate = { focus: 'Lower Body',  patterns: ['squat', 'squat', 'hinge', 'hinge', 'core'] }

  if (days === 2) return [fullA, fullB]
  if (days === 3) return [fullA, fullB, fullC]
  if (days === 4) return [upper, lower, fullA, fullB]
  return [fullA, upper, lower, fullB, fullC]
}

function buildSessionTemplates(goal: Goal, days: number): SessionTemplate[] {
  const n = DAY_SLOTS[days] ? days : 3
  switch (goal) {
    case 'muscle_gain':  return muscleSessions(n)
    case 'strength':     return strengthSessions(n)
    case 'fat_loss':     return fatLossSessions(n)
    case 'athletic':     return athleticSessions(n)
    default:             return generalSessions(n)
  }
}

// ── Exercise selection ────────────────────────────────────────────────────────

interface ExRow { id: string; movement_pattern: string; experience_level: string; required_equipment: string[] }

// Sort so the highest-value exercise comes first: prefer more equipment options
// (barbells > dumbbells > bodyweight) and breadth of primary muscles.
function sortPool(pool: ExRow[], goal: Goal): ExRow[] {
  const eqScore = (eq: string[]): number => {
    if (eq.includes('barbell'))   return goal === 'strength' ? 10 : 5
    if (eq.includes('full_gym'))  return 4
    if (eq.includes('dumbbells')) return 3
    if (eq.includes('resistance_bands')) return 2
    return 1 // bodyweight
  }
  return [...pool].sort((a, b) => eqScore(b.required_equipment) - eqScore(a.required_equipment))
}

function pickExercises(
  byPattern: Record<string, ExRow[]>,
  patterns: string[],
  sessionIdx: number,
): string[] {
  const usedPerPattern: Record<string, number> = {}
  const ids: string[] = []

  for (const pattern of patterns) {
    const pool = byPattern[pattern] ?? []
    if (!pool.length) continue
    const pickCount = usedPerPattern[pattern] ?? 0
    usedPerPattern[pattern] = pickCount + 1
    // Rotate across sessions; always start from the best exercise in the sorted pool.
    const pick = pool[(sessionIdx + pickCount) % pool.length]
    if (pick && !ids.includes(pick.id)) ids.push(pick.id)
  }

  return ids
}

// ── Cleanup stale plan data ───────────────────────────────────────────────────

async function clearActivePlans(client: SupabaseClient, userId: string): Promise<void> {
  const { data: active } = await client
    .from('user_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (!active?.length) return

  const planIds = active.map((p: any) => p.id)

  // Only delete future scheduled workouts — keep completed/missed history.
  await client
    .from('scheduled_workouts')
    .delete()
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .in('user_plan_id', planIds)

  await client
    .from('user_plans')
    .update({ status: 'abandoned' })
    .in('id', planIds)
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function generatePlan(
  client: SupabaseClient,
  userId: string,
  profile: PlanProfile,
): Promise<void> {
  await clearActivePlans(client, userId)

  const days = DAY_SLOTS[profile.days_per_week] ? profile.days_per_week : 3
  const slots = DAY_SLOTS[days]

  // ── Find best matching program ──────────────────────────────────────────────
  const { data: programs, error: progErr } = await client
    .from('programs')
    .select('id, goals, experience_level, days_per_week')

  if (progErr) throw progErr
  if (!programs?.length) throw new Error('No programs found in the database.')

  const goalPool = programs.filter((p: any) => p.goals.includes(profile.goal))
  const basePool = goalPool.length ? goalPool : programs

  let expPool = basePool.filter((p: any) => p.experience_level === profile.experience)
  if (!expPool.length) expPool = basePool.filter((p: any) => p.experience_level === 'beginner')
  if (!expPool.length) expPool = basePool

  const best = expPool.find((p: any) => p.days_per_week === days)
    ?? expPool.reduce((acc: any, p: any) =>
      Math.abs(p.days_per_week - days) < Math.abs(acc.days_per_week - days) ? p : acc
    )

  // ── Create user_plan ────────────────────────────────────────────────────────
  const startMonday = getStartMonday()
  const endDate = new Date(startMonday)
  endDate.setDate(startMonday.getDate() + 28)

  const { data: planRow, error: planErr } = await client
    .from('user_plans')
    .insert({
      user_id: userId,
      program_id: best.id,
      start_date: formatDate(startMonday),
      end_date: formatDate(endDate),
      status: 'active',
    })
    .select('id')
    .single()

  if (planErr) throw planErr
  if (!planRow) throw new Error('Failed to create plan.')

  // ── Filter exercises by equipment + experience ──────────────────────────────
  const { data: allEx, error: exErr } = await client
    .from('exercises')
    .select('id, movement_pattern, experience_level, required_equipment')

  if (exErr) throw exErr

  const userExpIdx = EXPERIENCE_ORDER.indexOf(profile.experience)
  const validExp = new Set(EXPERIENCE_ORDER.slice(0, userExpIdx + 1) as string[])
  const equipment = new Set([...profile.equipment, 'bodyweight'])

  const filtered = ((allEx ?? []) as ExRow[]).filter(ex =>
    validExp.has(ex.experience_level) &&
    ex.required_equipment.some(eq => equipment.has(eq))
  )

  if (!filtered.length) {
    throw new Error(
      'No exercises found for your equipment and experience level. ' +
      'Make sure the exercises table is seeded in Supabase.'
    )
  }

  // Group by pattern, sorted by goal-relevance so the best pick is always index 0.
  const byPattern: Record<string, ExRow[]> = {}
  for (const ex of filtered) {
    const p = ex.movement_pattern
    if (!byPattern[p]) byPattern[p] = []
    byPattern[p].push(ex)
  }
  for (const p of Object.keys(byPattern)) {
    byPattern[p] = sortPool(byPattern[p], profile.goal)
  }

  // ── Build 4-week schedule ──────────────────────────────────────────────────
  const templates = buildSessionTemplates(profile.goal, days)
  const workouts: object[] = []
  let sessionCount = 0

  for (let week = 0; week < 4; week++) {
    for (const slot of slots) {
      const template = templates[sessionCount % templates.length]
      const date = new Date(startMonday)
      date.setDate(startMonday.getDate() + week * 7 + (slot - 1))

      workouts.push({
        user_id: userId,
        user_plan_id: planRow.id,
        planned_date: formatDate(date),
        planned_start_time: startTimeFor(profile.preferred_time_of_day ?? 'morning', sessionCount),
        planned_duration_min: profile.preferred_duration_min,
        focus: template.focus,
        status: 'scheduled',
        source: 'plan',
        exercise_ids: pickExercises(byPattern, template.patterns, sessionCount),
      })

      sessionCount++
    }
  }

  const { error: insertErr } = await client.from('scheduled_workouts').insert(workouts)
  if (insertErr) throw insertErr
}
