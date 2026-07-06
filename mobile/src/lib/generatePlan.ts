import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience, TimeOfDay, UnavailableBlock, AdaptationMode } from '@/types'
import { weekProgression, BLOCK_WEEKS } from '@/lib/periodization'
import { estimateSessionMinutes, exerciseCountForDuration } from '@/lib/progression'
import { injuriesToRestrictions } from '@/lib/quickWorkout'
import { expandEquipment, canPerform } from '@/lib/equipmentMatch'
import { removeWorkoutFromCalendar } from '@/services/calendarSync'
import { cancelWorkoutReminder } from '@/lib/notifications'
import { ensureAutoSplit } from '@/lib/splits'

export interface PlanProfile {
  goal: Goal
  experience: Experience
  equipment: string[]
  days_per_week: number
  preferred_duration_min: number
  preferred_time_of_day?: TimeOfDay | null
}

// Hard scheduling constraints the plan must respect: weekdays the user can never
// train (all-day unavailable blocks + the training-days allowlist) and injuries.
interface PlanConstraints {
  blockedWeekdays: Set<number>   // ISO 1=Mon … 7=Sun
  injuries: string[]
}

async function fetchPlanConstraints(client: SupabaseClient, userId: string): Promise<PlanConstraints> {
  const blocked = new Set<number>()
  let injuries: string[] = []
  try {
    const { data } = await client
      .from('user_profiles')
      .select('unavailable_blocks, training_days, injuries')
      .eq('user_id', userId)
      .maybeSingle()
    for (const b of ((data?.unavailable_blocks ?? []) as UnavailableBlock[])) {
      if (b.scope === 'weekday' && b.allDay && b.weekday) blocked.add(b.weekday)
    }
    // A non-empty training-days allowlist blocks every other weekday.
    const allowed = (data?.training_days ?? []) as number[]
    if (allowed.length) for (let d = 1; d <= 7; d++) if (!allowed.includes(d)) blocked.add(d)
    injuries = (data?.injuries as string[] | null) ?? []
  } catch { /* optional columns may not exist yet — no constraints */ }
  // Everything blocked is a contradiction — ignore the blocks rather than emit no plan.
  if (blocked.size >= 7) blocked.clear()
  return { blockedWeekdays: blocked, injuries }
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

const MIN_DAYS = 2
const MAX_DAYS = 6
const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number.isFinite(n) ? n : 3))

// Choose which ISO weekdays (1=Mon … 7=Sun) the plan trains on: skip every blocked
// day, then spread the sessions across what's left to maximise recovery between
// them (3 days over a full week → Mon/Wed/Fri; Wed blocked → Mon/Thu/Sat; only the
// weekend free → Sat/Sun). If fewer days are available than requested, the plan
// trains on all of them rather than putting a session on a forbidden day.
function chooseDaySlots(daysPerWeek: number, blocked: Set<number>): number[] {
  const candidates = [1, 2, 3, 4, 5, 6, 7].filter(d => !blocked.has(d))
  const n = Math.min(daysPerWeek, candidates.length)
  if (n <= 0) return [1, 3, 5].slice(0, daysPerWeek) // defensive — blocked is never all-7
  const stride = candidates.length / n
  const slots: number[] = []
  for (let i = 0; i < n; i++) {
    const pick = candidates[Math.floor(i * stride)]
    if (!slots.includes(pick)) slots.push(pick)
  }
  return slots
}

const EXPERIENCE_ORDER: Experience[] = ['beginner', 'intermediate', 'advanced']

function getStartMonday(): Date {
  // Always anchor to THIS week's Monday. Past-dated sessions in the start week are
  // skipped at insert time (see the loop below), so a mid-week signup never gets
  // workouts dated before today — which the missed-workout sweep would otherwise
  // immediately flag as "missed" on day one. Late-week signups simply start their
  // first sessions on the remaining training days this week (or next Monday).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monBased = (today.getDay() + 6) % 7 // Mon=0 … Sun=6
  const monday = new Date(today)
  monday.setDate(today.getDate() - monBased)
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
  if (days === 5) return [push, pull, legs, upperA, lowerA]
  return [push, pull, legs, push, pull, legs] // 6 — classic PPL ×2
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
  if (days === 5) return [squat, bench, dead, row, upper]
  return [squat, bench, row, dead, upper, squat]
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
  if (days === 5) return [fbA, fbB, fbC, cond, upCi]
  return [fbA, fbB, fbC, cond, upCi, fbA]
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
  if (days === 5) return [power, upper, lower, cond, full]
  return [power, upper, lower, cond, full, power]
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
  if (days === 5) return [fullA, upper, lower, fullB, fullC]
  return [upper, lower, fullA, upper, lower, fullB]
}

function buildSessionTemplates(goal: Goal, days: number): SessionTemplate[] {
  const n = clampDays(days)
  switch (goal) {
    case 'muscle_gain':  return muscleSessions(n)
    case 'strength':     return strengthSessions(n)
    case 'fat_loss':     return fatLossSessions(n)
    case 'athletic':     return athleticSessions(n)
    default:             return generalSessions(n)
  }
}

// ── Exercise selection ────────────────────────────────────────────────────────

interface ExRow {
  id: string
  name: string
  movement_pattern: string
  experience_level: string
  required_equipment: string[]
  primary_muscles?: string[] | null
  secondary_muscles?: string[] | null
  is_core?: boolean | null
  popularity?: number | null
}

// Sort so the highest-value exercise comes first: prefer more equipment options
// (barbells > dumbbells > bodyweight), then well-known staples over long-tail
// variants (popularity), and breadth of primary muscles.
function sortPool(pool: ExRow[], goal: Goal): ExRow[] {
  const eqScore = (eq: string[]): number => {
    if (eq.includes('barbell'))   return goal === 'strength' ? 10 : 5
    if (eq.includes('full_gym'))  return 4
    if (eq.includes('dumbbells')) return 3
    if (eq.includes('kettlebell')) return 3
    if (eq.includes('resistance_bands')) return 2
    return 1 // bodyweight
  }
  return [...pool].sort((a, b) =>
    eqScore(b.required_equipment) - eqScore(a.required_equipment) ||
    (b.popularity ?? 30) - (a.popularity ?? 30)
  )
}

// How many exercises a pattern pool keeps for session rotation. Big enough for
// week-to-week variety, small enough that every pick is a movement a coach would
// actually program (pools are popularity-sorted before the cap).
const PATTERN_POOL_CAP = 14

// Which patterns still SERVE a session's focus when its own pool runs dry — a
// thin Pull day borrows hinge work (rows' posterior-chain cousins), never planks.
const PATTERN_AFFINITY: Record<string, string[]> = {
  pull: ['hinge', 'core'],
  push: ['core'],
  squat: ['hinge', 'core'],
  hinge: ['squat', 'pull', 'core'],
  core: ['mobility'],
  cardio: ['core', 'mobility'],
  carry: ['core'],
  mobility: ['core'],
}

function pickExercises(
  byPattern: Record<string, ExRow[]>,
  patterns: string[],
  sessionIdx: number,
  target: number,
): string[] {
  const usedPerPattern: Record<string, number> = {}
  const ids: string[] = []

  for (const pattern of patterns) {
    const pool = byPattern[pattern] ?? []
    if (!pool.length) continue
    const pickCount = usedPerPattern[pattern] ?? 0
    usedPerPattern[pattern] = pickCount + 1
    // Rotate across sessions, but scan for the first exercise not already in the
    // session — a 2-exercise pool must yield 2 distinct pulls, not 1 duplicate.
    for (let k = 0; k < pool.length; k++) {
      const pick = pool[(sessionIdx + pickCount + k) % pool.length]
      if (pick && !ids.includes(pick.id)) { ids.push(pick.id); break }
    }
  }

  // Limited equipment/level can leave a session thin. Pad ONLY with work that
  // still serves the session's focus: leftovers from its own patterns, then
  // pattern-affine neighbours, then core — and stop there. A short honest session
  // beats a "Pull day" of planks and dead bugs (duration is derived from the final
  // exercise count, so a shorter session also reads as shorter).
  if (ids.length < target) {
    const padOrder: string[] = [...patterns]
    for (const p of patterns) for (const a of PATTERN_AFFINITY[p] ?? []) padOrder.push(a)
    padOrder.push('core')
    const visited = new Set<string>()
    for (const p of padOrder) {
      if (visited.has(p)) continue
      visited.add(p)
      for (const ex of byPattern[p] ?? []) {
        if (ids.length >= target) return ids
        if (!ids.includes(ex.id)) ids.push(ex.id)
      }
    }
  }

  return ids
}


// ── Cleanup stale plan data ───────────────────────────────────────────────────

// Rows about to be deleted may have a synced calendar event and a pending local
// reminder. Clean both up first (best-effort) — otherwise replacing a plan strands
// "Tempo · Push" events in the user's calendar and stale 30-min alerts on-device.
async function releaseScheduledRows(
  client: SupabaseClient,
  userId: string,
  rows: Array<{
    id: string; focus: string; planned_date: string; planned_start_time: string
    planned_duration_min: number; calendar_event_id: string | null
    calendar_provider: 'google' | 'device' | null
  }>,
): Promise<void> {
  for (const w of rows) {
    if (w.calendar_event_id) {
      try { await removeWorkoutFromCalendar(client, w, userId) } catch { /* best-effort */ }
    }
    cancelWorkoutReminder(w.id).catch(() => {})
  }
}

const RELEASE_COLS =
  'id, focus, planned_date, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider'

async function clearActivePlans(client: SupabaseClient, userId: string): Promise<void> {
  // Generating a plan switches the user back to the auto-generated program, so any
  // active custom split is retired too — otherwise it would keep materializing
  // workouts on top of the new plan on every app open.
  await client.from('splits').update({ is_active: false }).eq('user_id', userId).eq('is_active', true)
  const { data: splitRows } = await client
    .from('scheduled_workouts')
    .select(RELEASE_COLS)
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .eq('source', 'split')
  await releaseScheduledRows(client, userId, (splitRows ?? []) as any)
  await client
    .from('scheduled_workouts')
    .delete()
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .eq('source', 'split')

  const { data: active } = await client
    .from('user_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (!active?.length) return

  const planIds = active.map((p: any) => p.id)

  // Only delete future scheduled workouts — keep completed/missed history.
  const { data: planRows } = await client
    .from('scheduled_workouts')
    .select(RELEASE_COLS)
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .in('user_plan_id', planIds)
  await releaseScheduledRows(client, userId, (planRows ?? []) as any)
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

  // Hard constraints captured in onboarding/settings: never-train weekdays and
  // injuries. The plan itself must respect them — auto-scheduling only ever moves
  // TIMES on a day, so a workout born on a forbidden day could never be saved.
  const constraints = await fetchPlanConstraints(client, userId)
  const days = clampDays(profile.days_per_week)

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

  // A fresh plan starts a normal mesocycle (overload weeks 1–3, deload week 4).
  // The adaptation engine re-stamps these later if signals call for recovery/deload.
  const ctx = await buildBlockContext(client, { ...profile, days_per_week: days }, constraints)
  const workouts = buildBlockRows(ctx, userId, planRow.id, startMonday, 0, BLOCK_WEEKS, 'normal', 0)

  const { error: insertErr } = await client.from('scheduled_workouts').insert(workouts)
  if (insertErr) throw insertErr

  // Surface the new program in My Splits as an activatable mirror (best-effort).
  await ensureAutoSplit(client, userId, profile.goal)
}

// ── Shared block machinery (initial plan + rollover use the same path) ────────

interface BlockBuildCtx {
  slots: number[]
  templates: SessionTemplate[]
  byPattern: Record<string, ExRow[]>
  targetCount: number
  timeOfDay: TimeOfDay
  experience: Experience
  goal: Goal
}

async function buildBlockContext(
  client: SupabaseClient,
  profile: PlanProfile,
  constraints: PlanConstraints,
): Promise<BlockBuildCtx> {
  // ── Filter exercises by equipment + experience ──────────────────────────────
  // Only the curated CORE pool is programmable — the full library (1300+ rows)
  // exists for search/swaps/manual building, but a generated plan must read like
  // a coach wrote it, not a random walk through cable-machine variants.
  const { data: allEx, error: exErr } = await client
    .from('exercises')
    .select('id, name, movement_pattern, experience_level, required_equipment, primary_muscles, secondary_muscles, is_core, popularity')
    .is('user_id', null)

  if (exErr) throw exErr

  const userExpIdx = EXPERIENCE_ORDER.indexOf(profile.experience)
  const equipment = expandEquipment(profile.equipment)

  // Equipment-match first; experience is applied per-pattern below as a PREFERENCE
  // (one tier above the user's level is kept as backup) instead of a hard cut — a
  // thin library must never leave a movement pattern empty when a slightly
  // harder-labelled machine exercise would do.
  const expIdxOf = (ex: ExRow) => EXPERIENCE_ORDER.indexOf(ex.experience_level as Experience)
  const filtered = ((allEx ?? []) as ExRow[]).filter(ex =>
    expIdxOf(ex) <= userExpIdx + 1 &&
    canPerform(ex, equipment)
  )

  if (!filtered.length) {
    throw new Error(
      'No exercises found for your equipment and experience level. ' +
      'Make sure the exercises table is seeded in Supabase.'
    )
  }

  // Respect injuries with the same mapping Quick Workouts use — the plan must not
  // program squats onto bad knees. If the filter would empty the pool entirely,
  // fall back to the unfiltered set rather than generate nothing.
  const { avoidMuscles, avoidPatterns } = injuriesToRestrictions(constraints.injuries)
  const avoidM = new Set(avoidMuscles)
  const avoidP = new Set<string>(avoidPatterns as string[])
  const safe = filtered.filter(ex =>
    !avoidP.has(ex.movement_pattern) &&
    ![...(ex.primary_muscles ?? []), ...(ex.secondary_muscles ?? [])].some(m => avoidM.has(m))
  )
  const pool = safe.length ? safe : filtered

  // Group by pattern, preferring the core pool: a pattern only falls back to the
  // full library when equipment/injury filters left it with no core movements at
  // all (better an off-pool exercise than an empty Pull day). Within each pool:
  // the user's own level first (sorted by goal-relevance + popularity), then the
  // one-tier-above backups — so a Lat Pulldown labelled "intermediate" can still
  // complete a beginner's Pull day, but never displaces an in-level pick.
  const byPattern: Record<string, ExRow[]> = {}
  for (const ex of pool) {
    const p = ex.movement_pattern
    if (!byPattern[p]) byPattern[p] = []
    byPattern[p].push(ex)
  }
  for (const p of Object.keys(byPattern)) {
    const core = byPattern[p].filter(ex => ex.is_core === true)
    const source = core.length ? core : byPattern[p]
    const inLevel = source.filter(ex => expIdxOf(ex) <= userExpIdx)
    const backup = source.filter(ex => expIdxOf(ex) > userExpIdx)
    byPattern[p] = [...sortPool(inLevel, profile.goal), ...sortPool(backup, profile.goal)].slice(0, PATTERN_POOL_CAP)
  }

  const days = clampDays(profile.days_per_week)
  return {
    slots: chooseDaySlots(days, constraints.blockedWeekdays),
    templates: buildSessionTemplates(profile.goal, days),
    byPattern,
    // How many exercises fit the user's preferred session length FOR THIS GOAL —
    // a strength day (full 3-min rests) fits fewer lifts than a fat-loss circuit
    // in the same wall-clock window. Duration is then derived from the count we
    // actually place, so the time shown always matches the real work + rest.
    targetCount: exerciseCountForDuration(profile.preferred_duration_min, profile.goal),
    timeOfDay: profile.preferred_time_of_day ?? 'morning',
    experience: profile.experience,
    goal: profile.goal,
  }
}

function buildBlockRows(
  ctx: BlockBuildCtx,
  userId: string,
  planId: string,
  startMonday: Date,
  weekFrom: number,
  weekCount: number,
  mode: AdaptationMode,
  sessionCountStart: number,
): object[] {
  const todayStr = formatDate(new Date())
  const rows: object[] = []
  let sessionCount = sessionCountStart

  for (let week = weekFrom; week < weekFrom + weekCount; week++) {
    // weekProgression cycles the wave modulo the block length, so week 5 starts a
    // fresh Base week — the plan repeats its mesocycle instead of ending.
    const progression = weekProgression(week, ctx.experience, mode)
    for (const slot of ctx.slots) {
      const date = new Date(startMonday)
      date.setDate(startMonday.getDate() + week * 7 + (slot - 1))

      // Never create a past-dated session (mid-week signups): it would be marked
      // "missed" instantly. Skip without consuming a template so rotation stays intact.
      if (formatDate(date) < todayStr) continue

      const template = ctx.templates[sessionCount % ctx.templates.length]
      const exerciseIds = pickExercises(ctx.byPattern, template.patterns, sessionCount, ctx.targetCount)

      rows.push({
        user_id: userId,
        user_plan_id: planId,
        planned_date: formatDate(date),
        planned_start_time: startTimeFor(ctx.timeOfDay, sessionCount),
        planned_duration_min: estimateSessionMinutes(exerciseIds.length, ctx.goal, progression.isDeload),
        focus: progression.isDeload ? `${template.focus} (Deload)` : template.focus,
        status: 'scheduled',
        source: 'plan',
        exercise_ids: exerciseIds,
        week_index: week,
        progression,
      })

      sessionCount++
    }
  }
  return rows
}

// ── Plan rollover — the plan never just ends ──────────────────────────────────

const PLAN_RUNWAY_DAYS = 7

// When the active plan's last scheduled session is within PLAN_RUNWAY_DAYS (or
// already past), materialize the next 4-week block: week_index keeps counting up,
// the mesocycle wave cycles (weekProgression is modulo the block), and the new
// block reflects the user's CURRENT profile — days, equipment, injuries, blocked
// weekdays, and the plan's adaptation_mode. Runs on app open; cheap no-op while
// there's runway; returns how many sessions were added. Best-effort by design.
export async function extendActivePlan(client: SupabaseClient, userId: string): Promise<number> {
  try {
    const { data: plan } = await client
      .from('user_plans')
      .select('id, start_date, adaptation_mode')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return 0

    const { data: lastRow } = await client
      .from('scheduled_workouts')
      .select('planned_date')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .order('planned_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!lastRow) return 0 // a plan with no sessions at all isn't ours to revive

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const runwayEnd = new Date(today)
    runwayEnd.setDate(today.getDate() + PLAN_RUNWAY_DAYS)
    if ((lastRow.planned_date as string) > formatDate(runwayEnd)) return 0

    const { data: lastWeekRow } = await client
      .from('scheduled_workouts')
      .select('week_index')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .order('week_index', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastWeek = (lastWeekRow?.week_index as number | null) ?? (BLOCK_WEEKS - 1)

    const { data: p } = await client
      .from('user_profiles')
      .select('goal, experience, equipment, days_per_week, preferred_duration_min, preferred_time_of_day')
      .eq('user_id', userId)
      .maybeSingle()
    if (!p) return 0

    const profile: PlanProfile = {
      goal: (p.goal ?? 'general_fitness') as Goal,
      experience: (p.experience ?? 'beginner') as Experience,
      equipment: (p.equipment ?? []) as string[],
      days_per_week: clampDays(p.days_per_week ?? 3),
      preferred_duration_min: p.preferred_duration_min ?? 45,
      preferred_time_of_day: (p.preferred_time_of_day ?? null) as TimeOfDay | null,
    }
    const constraints = await fetchPlanConstraints(client, userId)
    const ctx = await buildBlockContext(client, profile, constraints)

    // Continue the exercise/start-time rotation where the plan left off.
    const { count } = await client
      .from('scheduled_workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
    const sessionCountStart = count ?? 0

    // If the plan went stale (user away for weeks), generate enough weeks to reach
    // today + a full block; past-dated rows are skipped, so only the future lands.
    const startMonday = new Date(`${plan.start_date}T00:00:00`)
    const weeksSinceStart = Math.max(0, Math.floor((today.getTime() - startMonday.getTime()) / (7 * 86_400_000)))
    const weekFrom = lastWeek + 1
    const weekCount = Math.max(BLOCK_WEEKS, weeksSinceStart + BLOCK_WEEKS - weekFrom + 1)

    const rows = buildBlockRows(
      ctx, userId, plan.id as string, startMonday,
      weekFrom, weekCount,
      ((plan.adaptation_mode ?? 'normal') as AdaptationMode), sessionCountStart,
    )
    if (!rows.length) return 0

    const { error } = await client.from('scheduled_workouts').insert(rows)
    if (error) return 0

    // Push the plan's bookkeeping end-date out to cover the new block (best-effort).
    const endDate = new Date(startMonday)
    endDate.setDate(startMonday.getDate() + (weekFrom + weekCount) * 7)
    await client.from('user_plans').update({ end_date: formatDate(endDate) }).eq('id', plan.id)

    return rows.length
  } catch {
    return 0 // rollover must never break app open
  }
}

// ── Re-stamp the live plan for a profile change (experience level-up) ──────────

function stripDeloadFocus(focus: string): string {
  return focus.replace(/\s*\(Deload\)\s*$/i, '')
}

// When the user's experience level changes mid-block (the auto-progression engine
// promotes beginner → intermediate → advanced as they succeed), the coming weeks
// should reflect it *now*, not only at the next 4-week rollover — otherwise a
// celebrated "level up" wouldn't visibly change tomorrow's session. This re-selects
// level-appropriate exercises for every FUTURE plan session and re-computes its
// periodization directive (a beginner's gentle wave vs. an intermediate's overload
// peak), preserving each session's date/time/focus/week position. Idempotent and
// best-effort; returns how many sessions were updated.
export async function restampFuturePlanForExperience(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  try {
    const { data: plan } = await client
      .from('user_plans')
      .select('id, adaptation_mode')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return 0 // a split-driven user has no active plan to re-stamp

    const { data: p } = await client
      .from('user_profiles')
      .select('goal, experience, equipment, days_per_week, preferred_duration_min, preferred_time_of_day')
      .eq('user_id', userId)
      .maybeSingle()
    if (!p) return 0

    const profile: PlanProfile = {
      goal: (p.goal ?? 'general_fitness') as Goal,
      experience: (p.experience ?? 'beginner') as Experience,
      equipment: (p.equipment ?? []) as string[],
      days_per_week: clampDays(p.days_per_week ?? 3),
      preferred_duration_min: p.preferred_duration_min ?? 45,
      preferred_time_of_day: (p.preferred_time_of_day ?? null) as TimeOfDay | null,
    }
    const constraints = await fetchPlanConstraints(client, userId)
    const ctx = await buildBlockContext(client, profile, constraints)
    const mode = (plan.adaptation_mode ?? 'normal') as AdaptationMode

    // Map each session's focus back to its movement patterns so re-selection stays
    // true to the day (a "Push" day re-picks pushes at the new level, never pulls).
    const focusToPatterns = new Map<string, string[]>()
    for (const t of buildSessionTemplates(profile.goal, profile.days_per_week)) {
      focusToPatterns.set(t.focus, t.patterns)
    }

    const todayStr = formatDate(new Date())
    const { data: future } = await client
      .from('scheduled_workouts')
      .select('id, focus, week_index')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .eq('status', 'scheduled')
      .gte('planned_date', todayStr)
      .order('planned_date', { ascending: true })
      .order('planned_start_time', { ascending: true })
    if (!future?.length) return 0

    // Continue the exercise rotation from where the completed/past sessions left off
    // so re-picked days don't all collapse onto the same top-of-pool exercises.
    const { count: prior } = await client
      .from('scheduled_workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .lt('planned_date', todayStr)

    let idx = prior ?? 0
    let changed = 0
    for (const w of future) {
      idx++
      const baseFocus = stripDeloadFocus(w.focus as string)
      const patterns = focusToPatterns.get(baseFocus)
      if (!patterns) continue // custom-renamed / unknown focus — leave it untouched
      const exerciseIds = pickExercises(ctx.byPattern, patterns, idx, ctx.targetCount)
      if (!exerciseIds.length) continue
      const weekIndex = (w.week_index as number | null) ?? 0
      const progression = weekProgression(weekIndex, profile.experience, mode)
      await client
        .from('scheduled_workouts')
        .update({
          exercise_ids: exerciseIds,
          progression,
          focus: progression.isDeload ? `${baseFocus} (Deload)` : baseFocus,
          planned_duration_min: estimateSessionMinutes(exerciseIds.length, profile.goal, progression.isDeload),
        })
        .eq('id', w.id)
      changed++
    }
    return changed
  } catch {
    return 0 // never break the celebration / app open on a re-stamp hiccup
  }
}
