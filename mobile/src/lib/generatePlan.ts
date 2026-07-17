import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience, TimeOfDay, UnavailableBlock, AdaptationMode } from '@/types'
import { weekProgression, BLOCK_WEEKS } from '@/lib/periodization'
import { estimateSessionMinutes, exerciseCountForDuration } from '@/lib/progression'
import { injuriesToRestrictions } from '@/lib/quickWorkout'
import { expandEquipment, canPerform } from '@/lib/equipmentMatch'
import { sweepScheduledPlanRows } from '@/lib/retireWorkouts'
import { ensureAutoSplit } from '@/lib/splits'
import { classifyExercise, type Slot, type Role } from '@/lib/exerciseProgramming'
import { PLAN_RUNWAY_DAYS, formatLocalDate, planNeedsExtension, planExtensionWeeks } from '@/lib/planRollover'

export interface PlanProfile {
  goal: Goal
  experience: Experience
  equipment: string[]
  days_per_week: number
  preferred_duration_min: number
  preferred_time_of_day?: TimeOfDay | null
  // Optional cardio finisher (onboarding question, Phase 7c). muscle_gain/strength
  // templates carry zero cardio by design (pure hypertrophy/strength focus) —
  // this appends CARDIO as an OPTIONAL trailing slot on those two goals only, so a
  // tight time budget can still drop it first. fat_loss/athletic/general_fitness
  // already bake in a cardio finisher on some days regardless — unaffected.
  include_cardio?: boolean
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

// Delegates to the shared formatter in planRollover so the rollover kernel and the
// plan generator can never disagree on how a planned_date is spelled.
function formatDate(d: Date): string {
  return formatLocalDate(d)
}

// A session as a coach would write it: an ORDERED list of slots, each with a
// tier (its place in the hierarchy — power → primary → … → isolation → finisher)
// and one or more acceptable slots in preference order. Order in the array IS the
// session order, so exercises come out power → heavy compound → accessory →
// isolation → core/cardio without any post-sort.
type Tier = 'power' | 'primary' | 'secondary' | 'accessory' | 'isolation' | 'core' | 'cardio'
interface SlotSpec {
  slots: Slot[]           // acceptable slots, most-preferred first
  tier: Tier
  optional?: boolean      // dropped first when the time budget is tight
  preferRole?: Role       // e.g. prefer explosive movements for an athletic power slot
}
interface SessionTemplate { focus: string; slots: SlotSpec[] }

// ── Slot-spec shorthands ──────────────────────────────────────────────────────
const S = (slots: Slot[], tier: Tier, opts: { optional?: boolean; preferRole?: Role } = {}): SlotSpec =>
  ({ slots, tier, ...opts })
const CORE: SlotSpec = S(['core'], 'core', { optional: true })
const CARDIO: SlotSpec = S(['cardio'], 'cardio')

// ── Reusable session shapes ───────────────────────────────────────────────────
const PUSH_DAY: SessionTemplate = { focus: 'Push', slots: [
  S(['h_push'], 'primary'), S(['v_push'], 'secondary'), S(['h_push'], 'accessory'),
  S(['chest_iso'], 'isolation', { optional: true }), S(['lat_raise'], 'isolation'),
  S(['triceps'], 'isolation'), CORE,
] }
const PULL_DAY: SessionTemplate = { focus: 'Pull', slots: [
  S(['v_pull'], 'primary'), S(['h_pull'], 'secondary'), S(['h_pull'], 'accessory'),
  S(['rear_delt'], 'isolation'), S(['biceps'], 'isolation'),
  S(['biceps'], 'isolation', { optional: true }), CORE,
] }
const LEGS_DAY: SessionTemplate = { focus: 'Legs', slots: [
  S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
  S(['knee_flexion'], 'isolation'), S(['quad_iso'], 'isolation'),
  S(['calf'], 'isolation'), CORE,
] }
const UPPER_A: SessionTemplate = { focus: 'Upper A', slots: [
  S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
  S(['v_pull'], 'secondary'), S(['lat_raise'], 'isolation'), S(['biceps'], 'isolation'),
  S(['triceps'], 'isolation'),
] }
const UPPER_B: SessionTemplate = { focus: 'Upper B', slots: [
  S(['v_push'], 'primary'), S(['v_pull'], 'primary'), S(['h_push'], 'secondary'),
  S(['h_pull'], 'secondary'), S(['rear_delt'], 'isolation'), S(['triceps'], 'isolation'),
  S(['biceps'], 'isolation'),
] }
const LOWER_A: SessionTemplate = { focus: 'Lower A', slots: [
  S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
  S(['knee_flexion'], 'isolation'), S(['quad_iso'], 'isolation'), S(['calf'], 'isolation'),
] }
const LOWER_B: SessionTemplate = { focus: 'Lower B', slots: [
  S(['hinge'], 'primary'), S(['squat'], 'secondary'), S(['lunge'], 'accessory'),
  S(['knee_flexion'], 'isolation'), S(['glute_iso'], 'isolation'), S(['calf'], 'isolation'),
] }
const fullBody = (focus: string, order: Slot[], finisher: SlotSpec = CORE): SessionTemplate => ({
  focus,
  slots: [
    S([order[0]], 'primary'), S([order[1]], 'secondary'),
    S([order[2]], 'accessory'), S([order[3]], 'accessory', { optional: true }),
    finisher,
  ],
})

// ── Goal-specific programs ────────────────────────────────────────────────────

// Cardio is OPTIONAL and dropped first by the time-budget trimmer (S(...,
// {optional:true})) — asking for it never guarantees it survives a short session,
// same honesty as every other optional slot in this file.
const CARDIO_OPT: SlotSpec = S(['cardio'], 'cardio', { optional: true })
const withCardio = (t: SessionTemplate, on: boolean): SessionTemplate =>
  on ? { ...t, slots: [...t.slots, CARDIO_OPT] } : t

function muscleSessions(days: number, cardio = false): SessionTemplate[] {
  const list = days === 2 ? [UPPER_A, LOWER_A]
    : days === 3 ? [PUSH_DAY, PULL_DAY, LEGS_DAY]
    : days === 4 ? [UPPER_A, LOWER_A, UPPER_B, LOWER_B]
    : days === 5 ? [PUSH_DAY, PULL_DAY, LEGS_DAY, UPPER_A, LOWER_A]
    : [PUSH_DAY, PULL_DAY, LEGS_DAY, PUSH_DAY, PULL_DAY, LEGS_DAY] // 6 — PPL ×2
  return list.map(t => withCardio(t, cardio))
}

function strengthSessions(days: number, cardio = false): SessionTemplate[] {
  // Fewer movements, compound-dominant, minimal isolation.
  const squat: SessionTemplate = { focus: 'Squat Day', slots: [
    S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
    S(['knee_flexion'], 'isolation', { optional: true }), CORE,
  ] }
  const press: SessionTemplate = { focus: 'Press Day', slots: [
    S(['h_push'], 'primary'), S(['v_push'], 'secondary'), S(['h_pull'], 'accessory'),
    S(['triceps'], 'isolation', { optional: true }), CORE,
  ] }
  const dead: SessionTemplate = { focus: 'Deadlift Day', slots: [
    S(['hinge'], 'primary'), S(['squat'], 'secondary'), S(['h_pull'], 'accessory'),
    S(['knee_flexion'], 'isolation', { optional: true }), CORE,
  ] }
  const pull: SessionTemplate = { focus: 'Pull Day', slots: [
    S(['v_pull'], 'primary'), S(['h_pull'], 'secondary'), S(['rear_delt'], 'isolation'),
    S(['biceps'], 'isolation'), CORE,
  ] }
  const upper: SessionTemplate = { focus: 'Upper', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    S(['biceps'], 'isolation', { optional: true }), CORE,
  ] }
  const list = days === 2 ? [squat, press]
    : days === 3 ? [squat, press, dead]
    : days === 4 ? [squat, press, dead, pull]
    : days === 5 ? [squat, press, dead, pull, upper]
    : [squat, press, pull, dead, upper, squat]
  return list.map(t => withCardio(t, cardio))
}

function fatLossSessions(days: number): SessionTemplate[] {
  // Full-body density work; a cardio finisher keeps the heart rate up.
  const fbA = fullBody('Full Body A', ['squat', 'h_push', 'h_pull', 'hinge'], CARDIO)
  const fbB = fullBody('Full Body B', ['hinge', 'v_push', 'v_pull', 'squat'], CARDIO)
  const fbC = fullBody('Full Body C', ['squat', 'h_push', 'h_pull', 'lunge'], CARDIO)
  const cond: SessionTemplate = { focus: 'Conditioning', slots: [
    S(['squat', 'lunge'], 'primary'), S(['h_push'], 'secondary'), S(['h_pull'], 'accessory'),
    CARDIO, CORE,
  ] }
  const upCi: SessionTemplate = { focus: 'Upper Circuit', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    CARDIO, CORE,
  ] }
  if (days === 2) return [fbA, fbB]
  if (days === 3) return [fbA, fbB, fbC]
  if (days === 4) return [fbA, fbB, fbC, cond]
  if (days === 5) return [fbA, fbB, fbC, cond, upCi]
  return [fbA, fbB, fbC, cond, upCi, fbA]
}

function athleticSessions(days: number): SessionTemplate[] {
  const power: SessionTemplate = { focus: 'Power', slots: [
    S(['hinge', 'squat'], 'power', { preferRole: 'power' }), S(['squat'], 'primary'),
    S(['h_push'], 'secondary'), S(['lunge'], 'accessory'), CARDIO,
  ] }
  const upper: SessionTemplate = { focus: 'Upper Power', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    S(['v_pull'], 'secondary'), CORE,
  ] }
  const lower: SessionTemplate = { focus: 'Lower Power', slots: [
    S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge'], 'accessory'),
    S(['knee_flexion'], 'isolation'), CARDIO,
  ] }
  const cond: SessionTemplate = { focus: 'Conditioning', slots: [
    S(['squat', 'lunge'], 'power', { preferRole: 'power' }), S(['h_push'], 'secondary'),
    CARDIO, S(['carry', 'core'], 'accessory'), CORE,
  ] }
  const full = fullBody('Full Body', ['squat', 'h_push', 'h_pull', 'hinge'], CARDIO)
  if (days === 2) return [upper, lower]
  if (days === 3) return [power, upper, lower]
  if (days === 4) return [power, upper, lower, cond]
  if (days === 5) return [power, upper, lower, cond, full]
  return [power, upper, lower, cond, full, power]
}

function generalSessions(days: number): SessionTemplate[] {
  const fbA = fullBody('Full Body A', ['squat', 'hinge', 'h_push', 'h_pull'])
  const fbB = fullBody('Full Body B', ['h_push', 'h_pull', 'squat', 'hinge'])
  const fbC = fullBody('Full Body C', ['hinge', 'squat', 'v_pull', 'v_push'])
  const upper: SessionTemplate = { focus: 'Upper Body', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    S(['v_pull'], 'secondary'), S(['lat_raise'], 'isolation', { optional: true }), CORE,
  ] }
  const lower: SessionTemplate = { focus: 'Lower Body', slots: [
    S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
    S(['knee_flexion'], 'isolation'), S(['calf'], 'isolation', { optional: true }), CORE,
  ] }
  if (days === 2) return [fbA, fbB]
  if (days === 3) return [fbA, fbB, fbC]
  if (days === 4) return [upper, lower, fbA, fbB]
  if (days === 5) return [fbA, upper, lower, fbB, fbC]
  return [upper, lower, fbA, upper, lower, fbB]
}

function buildSessionTemplates(goal: Goal, days: number, includeCardio = false): SessionTemplate[] {
  const n = clampDays(days)
  switch (goal) {
    case 'muscle_gain':  return muscleSessions(n, includeCardio)
    case 'strength':     return strengthSessions(n, includeCardio)
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

// How many exercises a slot pool keeps for session rotation. Big enough for
// week-to-week variety, small enough that every pick is a movement a coach would
// actually program (pools are popularity-sorted before the cap).
const SLOT_POOL_CAP = 10

// When a slot's own pool runs dry, which OTHER slots still serve the same job — a
// thin knee_flexion borrows another hamstring movement, never a plank. Keeps the
// coaching intent intact rather than padding with whatever's left.
const SLOT_AFFINITY: Record<Slot, Slot[]> = {
  squat: ['lunge', 'hinge'],
  hinge: ['glute_iso', 'squat'],
  lunge: ['squat', 'quad_iso'],
  knee_flexion: ['hinge', 'glute_iso'],
  quad_iso: ['lunge', 'squat'],
  glute_iso: ['hinge', 'lunge'],
  calf: ['quad_iso'],
  h_push: ['v_push', 'chest_iso'],
  v_push: ['h_push', 'lat_raise'],
  chest_iso: ['h_push'],
  triceps: ['h_push'],
  h_pull: ['v_pull', 'rear_delt'],
  v_pull: ['h_pull'],
  rear_delt: ['h_pull', 'lat_raise'],
  lat_raise: ['v_push', 'rear_delt'],
  biceps: ['h_pull'],
  core: [],
  cardio: ['core'],
  carry: ['core'],
}

// Tiers that demand a multi-joint movement — an isolation (curl, shrug, calf)
// must never fill a primary/secondary/accessory compound slot.
const COMPOUND_TIERS = new Set<Tier>(['power', 'primary', 'secondary', 'accessory'])

// Fill a template's ordered slots with the best available exercise for each,
// enforcing role fit (compound slots reject isolation work), anti-redundancy (no
// two picks share a lift family — never two deadlift variants), rotation for
// week-to-week variety, and a time budget (optional/tail slots drop first).
// `rotation` is a per-focus occurrence index so the FIRST time a session appears
// it opens with the canonical lift (back squat), then varies. Returns ids in
// session order.
function selectForSlots(
  bySlot: Partial<Record<Slot, ExRow[]>>,
  template: SessionTemplate,
  rotation: number,
  target: number,
): string[] {
  const required = template.slots.filter(s => !s.optional)
  const optional = template.slots.filter(s => s.optional)
  const chosen = [...required, ...optional].slice(0, Math.max(1, target))

  const usedIds = new Set<string>()
  const usedFamilies = new Set<string>()
  const ids: string[] = []

  // Pick the first eligible exercise from a slot pool. `gated` enforces the
  // compound-tier role rule; a second ungated pass is the safety net so a
  // thin-equipment slot is never left empty on a technicality.
  const tryPick = (pool: ExRow[] | undefined, spec: SlotSpec, offset: number, gated: boolean): boolean => {
    if (!pool?.length) return false
    const ordered = spec.preferRole
      ? [...pool].sort((a, b) =>
          (classifyExercise(b).role === spec.preferRole ? 1 : 0) -
          (classifyExercise(a).role === spec.preferRole ? 1 : 0))
      : pool
    for (let k = 0; k < ordered.length; k++) {
      const ex = ordered[(rotation + offset + k) % ordered.length]
      if (!ex || usedIds.has(ex.id)) continue
      const cls = classifyExercise(ex)
      if (usedFamilies.has(cls.family)) continue
      if (gated && COMPOUND_TIERS.has(spec.tier) && cls.role !== 'compound' && cls.role !== 'power') continue
      usedIds.add(ex.id); usedFamilies.add(cls.family); ids.push(ex.id)
      return true
    }
    return false
  }

  chosen.forEach((spec, i) => {
    // Preferred slots first, then affinity neighbours — each in preference order.
    const order: Slot[] = [...spec.slots]
    for (const s of spec.slots) for (const a of SLOT_AFFINITY[s] ?? []) if (!order.includes(a)) order.push(a)
    for (const slot of order) if (tryPick(bySlot[slot], spec, i, true)) return
    for (const slot of order) if (tryPick(bySlot[slot], spec, i, false)) return
    // Nothing fit (thin equipment/injury) — leave it out; a short honest session
    // beats padding a Push day with planks.
  })

  return ids
}


// ── Cleanup stale plan data ───────────────────────────────────────────────────

async function clearActivePlans(client: SupabaseClient, userId: string): Promise<void> {
  // Generating a plan switches the user back to the auto-generated program, so any
  // active custom split is retired too — otherwise it would keep materializing
  // workouts on top of the new plan on every app open.
  const { error: splitErr } = await client
    .from('splits')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true)
  if (splitErr) throw splitErr

  // Retire EVERY still-scheduled plan-linked or split-sourced session from today
  // forward, not just the active plan's. Rows stranded under an abandoned plan
  // (e.g. an older failed change) still occupy the one-plan-per-day unique slot,
  // so leaving them behind made every future plan insert fail. Sweeping them all
  // both prevents and heals that state. Completed/missed history, past rows the
  // missed-workout sweep still owes a verdict, and ad-hoc quick/custom sessions
  // are kept.
  await sweepScheduledPlanRows(client, userId)

  const { data: active, error: activeErr } = await client
    .from('user_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (activeErr) throw activeErr
  if (!active?.length) return

  const { error: abandonErr } = await client
    .from('user_plans')
    .update({ status: 'abandoned' })
    .in('id', active.map((p: any) => p.id))
  if (abandonErr) throw abandonErr
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
  bySlot: Partial<Record<Slot, ExRow[]>>
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

  // Group by coaching SLOT (via the classifier), not the coarse movement_pattern —
  // this is what lets a Legs day distinguish a squat from a leg extension from a
  // calf raise. Mobility rows are warm-up/cooldown work, never a training slot.
  // Within each slot, prefer the curated core pool (fall back to the full library
  // only when equipment/injury filters left it empty), the user's own level first
  // (sorted by goal-relevance + popularity), then one-tier-above backups.
  const bySlot: Partial<Record<Slot, ExRow[]>> = {}
  for (const ex of pool) {
    if (ex.movement_pattern === 'mobility') continue
    const slot = classifyExercise(ex).slot
    ;(bySlot[slot] ??= []).push(ex)
  }
  for (const slot of Object.keys(bySlot) as Slot[]) {
    const all = bySlot[slot]!
    const core = all.filter(ex => ex.is_core === true)
    const source = core.length ? core : all
    const inLevel = source.filter(ex => expIdxOf(ex) <= userExpIdx)
    const backup = source.filter(ex => expIdxOf(ex) > userExpIdx)
    bySlot[slot] = [...sortPool(inLevel, profile.goal), ...sortPool(backup, profile.goal)].slice(0, SLOT_POOL_CAP)
  }

  const days = clampDays(profile.days_per_week)
  return {
    slots: chooseDaySlots(days, constraints.blockedWeekdays),
    templates: buildSessionTemplates(profile.goal, days, profile.include_cardio),
    bySlot,
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
  // Per-focus occurrence index drives exercise rotation, so the FIRST Push/Pull/
  // Legs each open with the canonical top lift and later ones vary. Seeded from
  // the rotation offset so a rollover block keeps varying rather than resetting.
  const focusRotation = new Map<string, number>()

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
      const rot = (focusRotation.get(template.focus) ?? Math.floor(sessionCountStart / ctx.templates.length))
      focusRotation.set(template.focus, rot + 1)
      const exerciseIds = selectForSlots(ctx.bySlot, template, rot, ctx.targetCount)

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
// The runway/week-count decision lives in the pure, unit-tested `planRollover`
// kernel (PLAN_RUNWAY_DAYS / planNeedsExtension / planExtensionWeeks) — this
// orchestrates the DB reads/writes around it.

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
    if (!planNeedsExtension(lastRow.planned_date as string, today, PLAN_RUNWAY_DAYS)) return 0

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
    const { weekFrom, weekCount } = planExtensionWeeks({ lastWeek, weeksSinceStart })

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
      .select('goal, experience, equipment, days_per_week, preferred_duration_min, preferred_time_of_day, include_cardio')
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
      include_cardio: !!p.include_cardio,
    }
    const constraints = await fetchPlanConstraints(client, userId)
    const ctx = await buildBlockContext(client, profile, constraints)
    const mode = (plan.adaptation_mode ?? 'normal') as AdaptationMode

    // Map each session's focus back to its template so re-selection stays true to
    // the day (a "Push" day re-picks pushes at the new level, never pulls).
    const focusToTemplate = new Map<string, SessionTemplate>()
    for (const t of buildSessionTemplates(profile.goal, profile.days_per_week, profile.include_cardio)) {
      focusToTemplate.set(t.focus, t)
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

    // Per-focus rotation, seeded from how many of each focus already ran, so a
    // re-stamp keeps varying from where the plan was rather than resetting.
    const templatesLen = Math.max(1, buildSessionTemplates(profile.goal, profile.days_per_week, profile.include_cardio).length)
    const focusRotation = new Map<string, number>()
    const priorRot = Math.floor((prior ?? 0) / templatesLen)
    let changed = 0
    for (const w of future) {
      const baseFocus = stripDeloadFocus(w.focus as string)
      const template = focusToTemplate.get(baseFocus)
      if (!template) continue // custom-renamed / unknown focus — leave it untouched
      const rot = focusRotation.get(baseFocus) ?? priorRot
      focusRotation.set(baseFocus, rot + 1)
      const exerciseIds = selectForSlots(ctx.bySlot, template, rot, ctx.targetCount)
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
