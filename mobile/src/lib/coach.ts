// Tempo — Tempo Coach client library.
//
// Three jobs, split so the expensive/fetching part and the pure part can be
// tested and reasoned about separately:
//   1. buildCoachContext() — PURE. Turns already-fetched rows into the compact
//      data pack the model reasons over. No network, no Supabase, no clock reads
//      beyond the `today` the caller passes in. This mirrors lib/fitnessInsights'
//      design rule for exactly the same reason: it stays unit-testable and cheap
//      to re-run.
//   2. fetchCoachContext() — the one place that knows which tables to read.
//   3. sendCoachMessage() / fetchCoachHistory() — the wire.
//
// The context pack is deliberately SMALL. It is the biggest input line on every
// request (see TEMPO_COACH_PLAN.md §9), so every field here has to earn its
// tokens by changing what the coach would say. Short keys, no nulls, no prose,
// and keys emitted in a fixed order — non-deterministic JSON ordering is the
// classic silent prompt-cache invalidator, and it also makes diffing two context
// packs during debugging miserable.
//
// The Coach never writes anything from here. `sendCoachMessage` returns a
// PROPOSED action; the screen renders it as a confirm card and the existing lib
// functions (weekReschedule / moveWorkout / substitutions / travelMode) do the
// real write once the user taps Apply. See TEMPO_COACH_PLAN.md §3.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScheduledWorkout, TravelMode, UserProfile } from '@/types'
import { sessionStreak, longestSessionStreak, type StreakRow } from './streak'
import { computeTempoScore, tempoScoreInputFromSessions } from './tempoScore'
import { computeWeightTrend } from './bodyMeasurements'
import type { BodyMeasurement } from '@/types'
import { toDateStr, addDays } from './dates'

// ── Types ─────────────────────────────────────────────────────────────────────

/** The five tools the Edge Function declares. Kept in sync with its COACH_TOOLS. */
export type CoachToolName =
  | 'reschedule_week'
  | 'move_workout'
  | 'swap_exercise'
  | 'start_travel_mode'
  | 'explain'

export interface CoachAction {
  name: CoachToolName | string
  input: Record<string, unknown>
}

export type CoachActionState = 'proposed' | 'applied' | 'dismissed' | 'failed'

export interface CoachMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  action: CoachAction | null
  action_state: CoachActionState | null
  created_at: string
}

/** What the Edge Function hands back. */
export interface CoachReply {
  text: string
  action: CoachAction | null
  /**
   * The `coach_messages` row id of the assistant turn, so the screen can stamp
   * `action_state` when the user applies or dismisses the proposal. Null when
   * the history insert failed (the answer still shows; only apply-rate
   * telemetry is lost) or when the reply came from the dev stub.
   */
  messageId: string | null
  /** The model hit max_tokens — show the partial text, don't render the action. */
  truncated: boolean
  /** Messages left in the current window, or null when the server didn't say. */
  remaining: number | null
  /** True when the user is on the metered free tier. */
  locked: boolean
}

/** A failed send, distinguished so the screen can react differently to each. */
export type CoachError =
  | { kind: 'quota'; remaining: number; locked: boolean }
  | { kind: 'offline' }
  | { kind: 'unavailable' } // the key isn't configured server-side
  | { kind: 'failed' }

export type CoachSendResult = { ok: true; reply: CoachReply } | { ok: false; error: CoachError }

/**
 * The compact pack the model reasons over. Every field is optional-by-omission:
 * anything we don't have is left OUT rather than sent as null, both to save
 * tokens and because a null invites the model to comment on missing data.
 */
export interface CoachContext {
  today: string
  profile?: {
    goal: string
    experience: string
    days_per_week: number
    equipment: string[]
    injuries?: string[]
    duration_min: number
  }
  /** Mesocycle state — why today might be lighter than last week. */
  plan?: { mode: string; week: number }
  /** This week + next: what the coach can actually propose moving. */
  schedule?: { id: string; date: string; time: string; focus: string; status: string }[]
  stats?: {
    completed_4w: number
    missed_4w: number
    streak: number
    best_streak: number
    tempo_score: number
  }
  weight?: { latest_lb: number; lb_per_week: number }
  prs?: { name: string; weight: number; date: string }[]
  travel?: { until: string; equipment: string[] }
  /** Most recent session-difficulty feedback, oldest first. */
  feedback?: string[]
}

export interface CoachContextInput {
  today: string
  profile: UserProfile | null
  planMode?: string | null
  planWeek?: number | null
  /** Scheduled workouts for the next ~14 days (the movable window). */
  upcoming: ScheduledWorkout[]
  /** Settled sessions over the last ~28 days, for streak + score. */
  history: StreakRow[]
  measurements: BodyMeasurement[]
  recentPRs: { name: string; weight: number; date: string }[]
  travel: TravelMode | null
  feedback: string[]
}

// How far ahead the coach can see (and therefore propose changes to). Two weeks
// covers "this week fell apart" and "I'm away next week" without paying for a
// month of rows the model will never mention.
export const COACH_HORIZON_DAYS = 14
const MAX_PRS = 3
const MAX_FEEDBACK = 3

// ── 1. The pure builder ───────────────────────────────────────────────────────

/**
 * Compose the context pack from rows the caller already has. Pure: same input →
 * byte-identical output, which is what the C2 test asserts.
 */
export function buildCoachContext(input: CoachContextInput): CoachContext {
  const { today, profile } = input
  const ctx: CoachContext = { today }

  if (profile) {
    ctx.profile = {
      goal: profile.goal,
      experience: profile.experience,
      days_per_week: profile.days_per_week,
      equipment: [...(profile.equipment ?? [])].sort(),
      duration_min: profile.preferred_duration_min,
    }
    // Injuries change what the coach may propose, so they're worth the tokens —
    // but only when there are any.
    const injuries = (profile.injuries ?? []).filter(Boolean)
    if (injuries.length) ctx.profile.injuries = [...injuries].sort()
  }

  if (input.planMode) {
    ctx.plan = { mode: input.planMode, week: input.planWeek ?? 1 }
  }

  const horizonEnd = addDays(today, COACH_HORIZON_DAYS)
  const schedule = input.upcoming
    .filter((w) => w.planned_date >= today && w.planned_date <= horizonEnd)
    .sort((a, b) => (a.planned_date === b.planned_date
      ? a.planned_start_time.localeCompare(b.planned_start_time)
      : a.planned_date.localeCompare(b.planned_date)))
    .map((w) => ({
      id: w.id,
      date: w.planned_date,
      // HH:MM is all the coach needs; the seconds are noise in every prompt.
      time: (w.planned_start_time ?? '').slice(0, 5),
      focus: w.focus,
      status: w.status,
    }))
  if (schedule.length) ctx.schedule = schedule

  if (input.history.length) {
    const goal = profile?.days_per_week ?? 3
    const score = computeTempoScore(tempoScoreInputFromSessions(input.history, goal, today))
    ctx.stats = {
      completed_4w: input.history.filter((h) => h.status === 'completed').length,
      missed_4w: input.history.filter((h) => h.status === 'missed' || h.status === 'skipped').length,
      streak: sessionStreak(input.history, today),
      best_streak: longestSessionStreak(input.history, today),
      tempo_score: score.score,
    }
  }

  // Weight only matters to the coach as a direction + rate, never as a series.
  const latest = input.measurements.find((m) => m.weight_lbs != null)
  if (latest?.weight_lbs != null) {
    const trend = computeWeightTrend(input.measurements)
    ctx.weight = {
      latest_lb: Math.round(latest.weight_lbs * 10) / 10,
      lb_per_week: trend.lbsPerWeek != null ? Math.round(trend.lbsPerWeek * 100) / 100 : 0,
    }
  }

  if (input.recentPRs.length) ctx.prs = input.recentPRs.slice(0, MAX_PRS)

  if (input.travel?.until) {
    ctx.travel = { until: input.travel.until, equipment: [...(input.travel.equipment ?? [])].sort() }
  }

  if (input.feedback.length) ctx.feedback = input.feedback.slice(-MAX_FEEDBACK)

  return ctx
}

// ── 2. Fetching ───────────────────────────────────────────────────────────────

/**
 * Read everything `buildCoachContext` needs. Every query is independently
 * best-effort: a failed sub-query degrades the context rather than the whole
 * Coach, because a coach that can't see your weight is still useful and a coach
 * that won't open is not.
 */
export async function fetchCoachContext(
  client: SupabaseClient,
  userId: string,
  today = toDateStr(new Date()),
): Promise<CoachContext> {
  const windowStart = addDays(today, -27)
  const horizonEnd = addDays(today, COACH_HORIZON_DAYS)

  const safe = async <T>(p: PromiseLike<{ data: T | null }>, fallback: T): Promise<T> => {
    try {
      const { data } = await p
      return data ?? fallback
    } catch {
      return fallback
    }
  }

  const [profile, upcoming, history, measurements, plan] = await Promise.all([
    safe<UserProfile | null>(
      client.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
      null,
    ),
    safe<ScheduledWorkout[]>(
      client.from('scheduled_workouts')
        .select('id, planned_date, planned_start_time, focus, status')
        .eq('user_id', userId)
        .gte('planned_date', today)
        .lte('planned_date', horizonEnd)
        .order('planned_date', { ascending: true }) as never,
      [],
    ),
    safe<StreakRow[]>(
      client.from('scheduled_workouts')
        .select('planned_date, status, source')
        .eq('user_id', userId)
        .gte('planned_date', windowStart)
        .lte('planned_date', today) as never,
      [],
    ),
    safe<BodyMeasurement[]>(
      client.from('body_measurements')
        .select('*')
        .eq('user_id', userId)
        .order('measured_at', { ascending: false })
        .limit(30) as never,
      [],
    ),
    safe<{ adaptation_mode: string; current_week: number } | null>(
      client.from('user_plans')
        .select('adaptation_mode, current_week')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle() as never,
      null,
    ),
  ])

  // Travel mode already degrades to null when its column is missing.
  const { getActiveTravelMode } = await import('./travelMode')
  const travel = await getActiveTravelMode(client, userId).catch(() => null)

  return buildCoachContext({
    today,
    profile,
    planMode: plan?.adaptation_mode ?? null,
    planWeek: plan?.current_week ?? null,
    upcoming,
    history,
    measurements,
    // PRs and per-session feedback need a heavier join than the first cut of the
    // Coach earns; they're wired in with the C4 action work.
    recentPRs: [],
    travel,
    feedback: [],
  })
}

// ── 3. The wire ───────────────────────────────────────────────────────────────

/** How many prior turns we replay. The server caps this again at 10. */
const HISTORY_TURNS = 10

export async function sendCoachMessage(
  client: SupabaseClient,
  args: { message: string; context: CoachContext; history: CoachMessage[] },
): Promise<CoachSendResult> {
  // Dev-only offline stub. Double-gated (`__DEV__` AND an env flag that is
  // absent from every EAS profile), dynamically imported so the module is never
  // even reached in a release build, and it returns messageId: null so nothing
  // it produces can be mistaken for a persisted turn. It exists so the C4 apply
  // flow — confirm card, executors, re-validation, failure copy — can be driven
  // on a real device before an ANTHROPIC_API_KEY exists. DELETE IT once the
  // Edge Function is deployed; a canned-reply path that survives to the App
  // Store is a Coach that answers with fiction.
  if (coachStubEnabled()) {
    const { stubReply } = await import('./coachStub')
    return { ok: true, reply: stubReply(args.message, args.context) }
  }

  const { data, error } = await client.functions.invoke('tempo-coach', {
    body: {
      message: args.message,
      context: args.context,
      history: args.history
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content })),
    },
  })

  if (error) {
    // supabase-js surfaces a non-2xx as a FunctionsHttpError whose response body
    // carries our own error shape. Reading it is what lets the screen tell a
    // quota wall (→ paywall) apart from a network blip (→ retry).
    const res = (error as { context?: Response }).context
    if (res && typeof res.status === 'number') {
      if (res.status === 402) {
        const body = await res.json().catch(() => ({})) as { remaining?: number; locked?: boolean }
        return { ok: false, error: { kind: 'quota', remaining: body.remaining ?? 0, locked: body.locked ?? true } }
      }
      if (res.status === 503) return { ok: false, error: { kind: 'unavailable' } }
      return { ok: false, error: { kind: 'failed' } }
    }
    return { ok: false, error: { kind: 'offline' } }
  }

  const d = (data ?? {}) as Partial<CoachReply> & { error?: string }
  if (d.error || typeof d.text !== 'string') return { ok: false, error: { kind: 'failed' } }

  return {
    ok: true,
    reply: {
      text: d.text,
      action: d.action ?? null,
      messageId: (d as { message_id?: string | null }).message_id ?? null,
      truncated: d.truncated ?? false,
      remaining: d.remaining ?? null,
      locked: d.locked ?? false,
    },
  }
}

/**
 * Is the offline dev stub active? Requires BOTH a dev build and an explicit
 * env flag, which is deliberately absent from `eas.json`'s preview/production
 * profiles — so there is no configuration of a shipped binary where this is on.
 */
export function coachStubEnabled(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_COACH_STUB === '1'
}

export async function fetchCoachHistory(
  client: SupabaseClient,
  userId: string,
  limit = 40,
): Promise<CoachMessage[]> {
  try {
    const { data } = await client
      .from('coach_messages')
      .select('id, role, content, action, action_state, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    // Fetched newest-first (so LIMIT takes the most recent), rendered oldest-first.
    return ((data ?? []) as CoachMessage[]).slice().reverse()
  } catch {
    return []
  }
}

/** Record what the user did with a proposal. Best-effort: never blocks the UI. */
export async function setActionState(
  client: SupabaseClient,
  messageId: string,
  state: CoachActionState,
): Promise<void> {
  try {
    await client.from('coach_messages').update({ action_state: state }).eq('id', messageId)
  } catch {
    /* apply-rate telemetry is not worth failing a successful action over */
  }
}

// ── Presentation helpers ──────────────────────────────────────────────────────

const DAY_NAMES: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

function prettyDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

/**
 * A one-line summary of a proposed action, for the confirm card.
 *
 * This doubles as the FALLBACK when the model returns a tool call with no text
 * block (the system prompt asks it to always explain first, but an empty bubble
 * on a purchase-driving surface is not something to leave to a prompt).
 */
export function describeAction(action: CoachAction): string {
  const i = action.input ?? {}
  switch (action.name) {
    case 'reschedule_week': {
      const days = Array.isArray(i.busy_days) ? (i.busy_days as string[]) : []
      const named = days.map((d) => DAY_NAMES[d] ?? d)
      return named.length
        ? `Re-plan your week around ${listOf(named)}`
        : 'Re-plan your upcoming week'
    }
    case 'move_workout': {
      const date = typeof i.to_date === 'string' ? prettyDate(i.to_date) : 'a new day'
      const time = typeof i.to_time === 'string' && i.to_time ? ` at ${i.to_time}` : ''
      return `Move this session to ${date}${time}`
    }
    case 'swap_exercise': {
      const name = typeof i.exercise_name === 'string' && i.exercise_name ? i.exercise_name : 'this exercise'
      return `Swap ${name} for an alternative`
    }
    case 'start_travel_mode': {
      const until = typeof i.until === 'string' ? prettyDate(i.until) : 'your return'
      return `Switch to travel mode until ${until}`
    }
    case 'explain':
      return 'See the details'
    default:
      return 'Apply this change'
  }
}

/** The label on the confirm card's primary button. */
export function actionCta(action: CoachAction): string {
  switch (action.name) {
    case 'reschedule_week': return 'Re-plan my week'
    case 'move_workout': return 'Move it'
    case 'swap_exercise': return 'Swap it'
    case 'start_travel_mode': return 'Turn on travel mode'
    case 'explain': return 'Show me'
    default: return 'Apply'
  }
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
