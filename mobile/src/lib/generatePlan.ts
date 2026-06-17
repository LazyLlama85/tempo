import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience } from '@/types'

export interface PlanProfile {
  goal: Goal
  experience: Experience
  equipment: string[]
  days_per_week: number
  preferred_duration_min: number
}

const DAY_OFFSETS: Record<number, number[]> = {
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
}

const EXPERIENCE_ORDER: Experience[] = ['beginner', 'intermediate', 'advanced']

function getStartMonday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayOfWeek = today.getDay() // 0=Sun … 6=Sat
  const monBased = (dayOfWeek + 6) % 7 // Mon=0 … Sun=6
  const monday = new Date(today)
  if (monBased <= 2) {
    monday.setDate(today.getDate() - monBased) // this Monday
  } else {
    monday.setDate(today.getDate() + (7 - monBased)) // next Monday
  }
  return monday
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

interface ProgramRow {
  id: string
  goals: string[]
  experience_level: string
  days_per_week: number
}

function closestByDays(pool: ProgramRow[], targetDays: number): ProgramRow {
  return pool.reduce((best, p) => {
    // Prefer fewer days over more when equidistant
    const score = (p: ProgramRow) =>
      Math.abs(p.days_per_week - targetDays) * 2 + (p.days_per_week > targetDays ? 1 : 0)
    return score(p) < score(best) ? p : best
  })
}

interface ExerciseRow {
  id: string
  movement_pattern: string
  experience_level: string
  required_equipment: string[]
}

type SessionTemplate = { focus: string; patterns: string[] }

function buildSessionTemplates(days: number): SessionTemplate[] {
  const fullA: SessionTemplate = { focus: 'Full Body', patterns: ['squat', 'hinge', 'push', 'pull', 'core'] }
  const fullB: SessionTemplate = { focus: 'Full Body', patterns: ['push', 'pull', 'squat', 'hinge', 'core'] }
  const fullC: SessionTemplate = { focus: 'Full Body', patterns: ['hinge', 'squat', 'pull', 'push', 'core'] }
  const upperA: SessionTemplate = { focus: 'Upper Body', patterns: ['push', 'push', 'pull', 'pull', 'core'] }
  const upperB: SessionTemplate = { focus: 'Upper Body', patterns: ['pull', 'pull', 'push', 'push', 'core'] }
  const lowerA: SessionTemplate = { focus: 'Lower Body', patterns: ['squat', 'squat', 'hinge', 'hinge', 'core'] }
  const lowerB: SessionTemplate = { focus: 'Lower Body', patterns: ['hinge', 'hinge', 'squat', 'squat', 'core'] }

  switch (days) {
    case 2: return [fullA, fullB]
    case 3: return [fullA, fullB, fullC]
    case 4: return [upperA, lowerA, upperB, lowerB]
    case 5: return [upperA, lowerA, upperB, lowerB, fullA]
    default: return [fullA, fullB, fullC]
  }
}

function pickExercises(
  byPattern: Record<string, string[]>,
  patterns: string[],
  sessionIdx: number
): string[] {
  const usedPerPattern: Record<string, number> = {}
  const ids: string[] = []

  for (const pattern of patterns) {
    const pool = byPattern[pattern] ?? []
    if (!pool.length) continue
    const pickCount = usedPerPattern[pattern] ?? 0
    usedPerPattern[pattern] = pickCount + 1
    const pick = pool[(sessionIdx + pickCount) % pool.length]
    if (pick && !ids.includes(pick)) ids.push(pick)
  }

  return ids
}

export async function generatePlan(
  client: SupabaseClient,
  userId: string,
  profile: PlanProfile
): Promise<void> {
  const days = DAY_OFFSETS[profile.days_per_week] ? profile.days_per_week : 3
  const offsets = DAY_OFFSETS[days]

  // ── Step 0: Clear any prior plan ─────────────────────────────────────────────
  // Regenerating must never stack a second 4-week block on top of the old one —
  // that's what produced "4 workouts on Friday at 7:00". We retire prior active
  // plans and their still-scheduled sessions, while leaving completed/missed
  // history and ad-hoc Quick Workouts (user_plan_id is null) untouched.

  // Retire EVERY still-scheduled *plan* workout from any prior plan by marking it
  // 'rescheduled' — NOT deleting. We intentionally do NOT filter by date: the new
  // plan starts on the current week's Monday, which may be a day or two in the
  // past, so old past-week sessions left in place would both duplicate those days
  // AND collide with the one-plan-per-day unique index, failing the insert below.
  // A 'scheduled' session is by definition not completed, so retiring it is safe.
  // Some may already be referenced by workout_logs (the session was opened), and
  // that FK has no cascade, so a delete would fail — marking frees the per-day
  // guard slot, preserves any logged history, and the UI hides 'rescheduled' rows.
  await client
    .from('scheduled_workouts')
    .update({ status: 'rescheduled' })
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .not('user_plan_id', 'is', null)

  // Retire any still-active plans so only the new one is current.
  await client
    .from('user_plans')
    .update({ status: 'abandoned' })
    .eq('user_id', userId)
    .eq('status', 'active')

  // ── Step 1: Find best matching program ──────────────────────────────────────
  const { data: programs, error: progErr } = await client
    .from('programs')
    .select('id, goals, experience_level, days_per_week')

  if (progErr) throw progErr
  if (!programs?.length) throw new Error('No programs found in the database.')

  const goalPool = (programs as ProgramRow[]).filter(p => p.goals.includes(profile.goal))
  const basePool = goalPool.length ? goalPool : (programs as ProgramRow[])

  let expPool = basePool.filter(p => p.experience_level === profile.experience)
  if (!expPool.length) expPool = basePool.filter(p => p.experience_level === 'beginner')
  if (!expPool.length) expPool = basePool

  const exactDays = expPool.find(p => p.days_per_week === days)
  const bestProgram = exactDays ?? closestByDays(expPool, days)

  // ── Step 2: Create user_plans ────────────────────────────────────────────────
  const startMonday = getStartMonday()
  const endDate = new Date(startMonday)
  endDate.setDate(startMonday.getDate() + 28)

  const { data: planRow, error: planErr } = await client
    .from('user_plans')
    .insert({
      user_id: userId,
      program_id: bestProgram.id,
      start_date: formatDate(startMonday),
      end_date: formatDate(endDate),
      status: 'active',
    })
    .select('id')
    .single()

  if (planErr) throw planErr
  if (!planRow) throw new Error('Failed to create plan row.')

  // ── Step 3: Select exercises ─────────────────────────────────────────────────
  const { data: allExercises, error: exErr } = await client
    .from('exercises')
    .select('id, movement_pattern, experience_level, required_equipment')

  if (exErr) throw exErr

  const userExpIndex = EXPERIENCE_ORDER.indexOf(profile.experience)
  const validExp = EXPERIENCE_ORDER.slice(0, userExpIndex + 1) as string[]
  const equipmentSet = new Set([...profile.equipment, 'bodyweight'])

  const filtered = (allExercises ?? [] as ExerciseRow[]).filter(
    (ex: ExerciseRow) =>
      validExp.includes(ex.experience_level) &&
      (ex.required_equipment as string[]).some(eq => equipmentSet.has(eq))
  )

  if (!filtered.length) {
    throw new Error(
      'No exercises found for your equipment and experience level. ' +
      'Make sure the exercises table is seeded in Supabase.'
    )
  }

  const byPattern: Record<string, string[]> = {}
  for (const ex of filtered as ExerciseRow[]) {
    if (!byPattern[ex.movement_pattern]) byPattern[ex.movement_pattern] = []
    byPattern[ex.movement_pattern].push(ex.id)
  }

  // ── Step 4: Generate scheduled_workouts ──────────────────────────────────────
  const templates = buildSessionTemplates(days)
  const workouts: object[] = []
  let sessionCount = 0

  for (let week = 0; week < 4; week++) {
    for (const dayOffset of offsets) {
      const template = templates[sessionCount % templates.length]
      const date = new Date(startMonday)
      date.setDate(startMonday.getDate() + week * 7 + (dayOffset - 1))

      workouts.push({
        user_id: userId,
        user_plan_id: planRow.id,
        planned_date: formatDate(date),
        planned_start_time: '07:00:00',
        planned_duration_min: profile.preferred_duration_min,
        focus: template.focus,
        status: 'scheduled',
        exercise_ids: pickExercises(byPattern, template.patterns, sessionCount),
      })

      sessionCount++
    }
  }

  const { error: insertErr } = await client.from('scheduled_workouts').insert(workouts)
  if (insertErr) throw insertErr
}
