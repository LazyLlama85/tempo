// Tempo — Tempo Coach, the action layer (batch C4).
//
// The Coach never writes anything itself. The Edge Function returns a PROPOSED
// action; the screen renders a confirm card; and this module is what runs when
// the user taps Apply — routing each tool to the SAME lib function a button
// press already uses. Nothing here is a second implementation of anything: the
// scheduling engine, substitution picker and travel-mode writer all live where
// they already lived, and this file is a switch plus the safety checks around
// it. See TEMPO_COACH_PLAN.md §3 for why that split matters.
//
// Two safety layers, and they do different jobs:
//
//   1. validateAction() — PURE, runs BEFORE the card renders. Rejects arguments
//      that are malformed or reference something the model invented (a workout
//      id that isn't in the context pack, an unknown equipment value, a date in
//      the past). A rejected action renders as text only, so the user is never
//      offered a button that cannot work.
//   2. The re-read inside each executor — runs at APPLY time. Between "here's
//      what I'd change" and the tap, the target can move, complete, or vanish
//      (another device, the missed-workout sweep, an auto re-slot). Every
//      executor re-reads its target and reports 'stale' rather than blind-
//      writing over a row that changed. This is the guard the plan's edge-case
//      table calls for, and the reason Apply can't silently clobber.

// Only pure/light modules are imported at the top. The executors
// (reschedule / moveWorkout / substitutions / travelMode) reach expo-calendar
// and expo-notifications through their own dependency chains, so they are
// imported DYNAMICALLY inside each branch — same pattern lib/coach.ts already
// uses for travelMode. Two payoffs: the pure validation half stays unit-
// testable without a native-module shim, and the Coach screen doesn't drag
// calendar/notification natives into its module-eval graph just by importing
// this file.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import type { Equipment } from '@/types'
import type { CoachAction, CoachContext } from './coach'
import { invalidateTrainingData } from './queryInvalidation'
import { toDateStr } from './dates'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoachActionOutcome =
  /** Applied. `summary` is the past-tense line shown on the settled card. */
  | { ok: true; summary: string; /** Where to send the user, for `explain`. */ route?: string }
  /** The target changed under us — refresh and let the user ask again. */
  | { ok: false; kind: 'stale'; title: string; message: string }
  /** The write failed (offline, RLS, server). */
  | { ok: false; kind: 'failed'; title: string; message: string }

export interface ValidationResult {
  valid: boolean
  /** Why it was rejected — logged to Sentry, never shown to the user. */
  reason?: string
}

/** The Pro gate each tool sits behind, or null when it's free. */
export function actionGate(action: CoachAction): 'schedule_optimization' | null {
  // Only the whole-week re-plan is gated today, and it's gated in exactly the
  // same place the Plan tab gates it — the Coach must not become a side door
  // around a paywall that the rest of the app enforces.
  return action.name === 'reschedule_week' ? 'schedule_optimization' : null
}

// ── 1. Validation (pure) ──────────────────────────────────────────────────────

const EQUIPMENT_VALUES: ReadonlySet<string> = new Set<Equipment>([
  'full_gym', 'dumbbells', 'barbell', 'kettlebell', 'resistance_bands', 'pull_up_bar', 'bodyweight',
])

const DAY_KEYS: ReadonlySet<string> = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
const EXPLAIN_TOPICS: ReadonlySet<string> = new Set(['plan', 'progress', 'deload', 'session'])

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{2}:\d{2}$/

function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD.test(v)) return false
  const d = new Date(`${v}T00:00:00`)
  // Rejects 2026-02-31 and friends, which pass the regex but roll over.
  return !Number.isNaN(d.getTime()) && toDateStr(d) === v
}

/**
 * Can this proposal be rendered as a tappable card?
 *
 * Deliberately strict about ids: the model may only reference workouts that
 * were in the context pack we sent it. `strict: true` on the tool schema
 * guarantees the arguments are well-TYPED; it guarantees nothing about whether
 * they're REAL, and a card offering to move a workout that doesn't exist is
 * worse than no card.
 */
export function validateAction(action: CoachAction, ctx: CoachContext | null): ValidationResult {
  const i = action.input ?? {}
  const today = ctx?.today ?? toDateStr(new Date())

  switch (action.name) {
    case 'reschedule_week': {
      // `busy_days` is advisory — the engine re-plans the whole week either way
      // — so unknown day keys are dropped rather than failing the card.
      if (typeof i.reason !== 'string') return { valid: false, reason: 'reason missing' }
      return { valid: true }
    }

    case 'move_workout': {
      const id = i.workout_id
      if (typeof id !== 'string' || !id) return { valid: false, reason: 'workout_id missing' }
      // The id has to be one we actually showed it.
      const known = ctx?.schedule?.some((w) => w.id === id) ?? false
      if (!known) return { valid: false, reason: 'workout_id not in context' }
      if (!isYmd(i.to_date)) return { valid: false, reason: 'to_date not YYYY-MM-DD' }
      if (i.to_date < today) return { valid: false, reason: 'to_date in the past' }
      // Empty string = "keep the current time", per the tool schema.
      if (typeof i.to_time !== 'string') return { valid: false, reason: 'to_time missing' }
      if (i.to_time && !HHMM.test(i.to_time)) return { valid: false, reason: 'to_time not HH:MM' }
      return { valid: true }
    }

    case 'swap_exercise': {
      // NOTE: the context pack does not carry exercise ids yet (see
      // lib/coach.fetchCoachContext — PRs and per-session exercises are a
      // later batch), so there is nothing to check the id against here. The
      // executor re-reads the exercise before writing and reports 'stale' if
      // it doesn't exist, which is what keeps a hallucinated id from becoming
      // a bad swap. Tighten this to a context check once exercises ship in
      // the pack.
      if (typeof i.exercise_id !== 'string' || !i.exercise_id) {
        return { valid: false, reason: 'exercise_id missing' }
      }
      return { valid: true }
    }

    case 'start_travel_mode': {
      if (!isYmd(i.until)) return { valid: false, reason: 'until not YYYY-MM-DD' }
      if (i.until < today) return { valid: false, reason: 'until in the past' }
      const eq = i.equipment
      if (!Array.isArray(eq) || eq.length === 0) return { valid: false, reason: 'equipment empty' }
      if (!eq.every((e) => typeof e === 'string' && EQUIPMENT_VALUES.has(e))) {
        return { valid: false, reason: 'unknown equipment value' }
      }
      return { valid: true }
    }

    case 'explain': {
      if (typeof i.topic !== 'string' || !EXPLAIN_TOPICS.has(i.topic)) {
        return { valid: false, reason: 'unknown topic' }
      }
      return { valid: true }
    }

    default:
      return { valid: false, reason: `unknown tool: ${action.name}` }
  }
}

/** Day keys the model supplied, filtered to the ones we understand. */
export function busyDays(action: CoachAction): string[] {
  const raw = action.input?.busy_days
  return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === 'string' && DAY_KEYS.has(d)) : []
}

/** Where `explain` should send the user. */
export function explainRoute(action: CoachAction): string {
  switch (action.input?.topic) {
    case 'progress': return '/(tabs)/progress'
    case 'deload':
    case 'plan': return '/plan-explainer'
    case 'session':
    default: return '/(tabs)/plan'
  }
}

// ── 2. Execution ──────────────────────────────────────────────────────────────

const STALE_TITLE = 'That already changed'

// Dynamically imported for the same reason as the executors: saveErrors pulls
// in the Supabase client, which is not something the pure validation half of
// this module should require.
async function failed(err: unknown, what: string): Promise<CoachActionOutcome> {
  const { describeSaveError } = await import('./saveErrors')
  const info = describeSaveError(err, what)
  return { ok: false, kind: 'failed', title: info.title, message: info.message }
}

/**
 * Run a proposed action. Assumes `validateAction` already passed and any Pro
 * gate has already been cleared by the caller.
 *
 * Every branch re-reads its target first. That extra round-trip is the whole
 * point: the proposal was generated against a snapshot, and the user may have
 * been reading it for a while.
 */
export async function executeCoachAction(
  client: SupabaseClient,
  userId: string,
  action: CoachAction,
  queryClient: QueryClient,
): Promise<CoachActionOutcome> {
  const i = action.input ?? {}

  switch (action.name) {
    // ── Re-plan the week ────────────────────────────────────────────────────
    case 'reschedule_week': {
      try {
        const { rescheduleWholeWeek } = await import('./reschedule')
        const { moved, total } = await rescheduleWholeWeek(client, userId)
        invalidateTrainingData(queryClient)
        if (total === 0) return { ok: true, summary: 'Nothing upcoming to move — your week is already clear.' }
        if (moved === 0) return { ok: true, summary: 'Every session already had its best slot, so nothing needed to move.' }
        return {
          ok: true,
          summary: `Moved ${moved} of ${total} session${total === 1 ? '' : 's'} and re-synced your calendar.`,
        }
      } catch (err) {
        return failed(err, 'reschedule your week')
      }
    }

    // ── Move one session ────────────────────────────────────────────────────
    case 'move_workout': {
      const workoutId = String(i.workout_id)
      try {
        const [{ rescheduleWorkout }, { resyncMovedWorkout }] = await Promise.all([
          import('./reschedule'),
          import('./moveWorkout'),
        ])
        const { data: row, error } = await client
          .from('scheduled_workouts')
          .select('id, focus, planned_date, planned_start_time, planned_duration_min, status, calendar_event_id, calendar_provider')
          .eq('id', workoutId)
          .eq('user_id', userId)
          .maybeSingle()
        if (error) throw error

        // Gone, or no longer movable — a completed/skipped session must not be
        // dragged back onto the calendar.
        if (!row) {
          return { ok: false, kind: 'stale', title: STALE_TITLE, message: 'That session is no longer on your plan. Ask me again and I’ll look at what’s there now.' }
        }
        if (row.status !== 'scheduled') {
          return { ok: false, kind: 'stale', title: STALE_TITLE, message: `That session is already marked ${row.status}. Ask me again and I’ll work from your current week.` }
        }

        const toDate = String(i.to_date)
        // Empty to_time means "same time, different day".
        const toTime = typeof i.to_time === 'string' && i.to_time
          ? `${i.to_time}:00`
          : row.planned_start_time

        if (row.planned_date === toDate && row.planned_start_time === toTime) {
          return { ok: true, summary: 'That session was already where I wanted to put it.' }
        }

        await rescheduleWorkout(client, userId, workoutId, {
          date: toDate,
          start_time: toTime,
          label: toDate,
          fromCalendar: false,
          reason: 'Moved from Coach',
        })

        // Best-effort, exactly as the Home-tab move does — a calendar hiccup
        // must never undo a move that already persisted.
        resyncMovedWorkout(client, userId, {
          id: row.id,
          focus: row.focus,
          planned_date: toDate,
          planned_start_time: toTime,
          planned_duration_min: row.planned_duration_min,
          calendar_event_id: row.calendar_event_id,
          calendar_provider: row.calendar_provider,
        }).catch(() => {})

        invalidateTrainingData(queryClient)
        return { ok: true, summary: `Moved ${row.focus} to ${prettyDay(toDate)}.` }
      } catch (err) {
        return failed(err, 'move that session')
      }
    }

    // ── Swap an exercise ────────────────────────────────────────────────────
    case 'swap_exercise': {
      const exerciseId = String(i.exercise_id)
      try {
        const { getAlternatives, saveSubstitution } = await import('./substitutions')
        const alts = await getAlternatives(client, userId, exerciseId)
        if (!alts.length) {
          // Either the id was invented, or nothing in the library matches the
          // user's equipment. Both are "can't do it", and neither is a crash.
          return {
            ok: false,
            kind: 'stale',
            title: 'No alternative found',
            message: 'I couldn’t find a swap for that one with your equipment. Try telling me what you do have access to.',
          }
        }
        // getAlternatives ranks curated substitutes first, so the head of the
        // list is the pick a human would make.
        const pick = alts[0]
        await saveSubstitution(client, userId, exerciseId, pick.id)
        invalidateTrainingData(queryClient)
        return { ok: true, summary: `Swapped it for ${pick.name} from now on.` }
      } catch (err) {
        return failed(err, 'swap that exercise')
      }
    }

    // ── Travel mode ─────────────────────────────────────────────────────────
    case 'start_travel_mode': {
      try {
        const { saveTravelMode } = await import('./travelMode')
        const equipment = (i.equipment as string[]).filter((e) => EQUIPMENT_VALUES.has(e)) as Equipment[]
        const ok = await saveTravelMode(client, userId, {
          equipment,
          until: String(i.until),
          label: 'Set up by Coach',
        })
        // saveTravelMode swallows its own errors and reports a boolean — most
        // often the travel_mode column simply isn't migrated on this project.
        if (!ok) {
          return {
            ok: false,
            kind: 'failed',
            title: 'Couldn’t turn on travel mode',
            message: 'That didn’t save. Check your connection and try again.',
          }
        }
        invalidateTrainingData(queryClient)
        return { ok: true, summary: `Travel mode is on until ${prettyDay(String(i.until))}.` }
      } catch (err) {
        return failed(err, 'turn on travel mode')
      }
    }

    // ── Explain (read-only) ─────────────────────────────────────────────────
    case 'explain':
      return { ok: true, summary: '', route: explainRoute(action) }

    default:
      return {
        ok: false,
        kind: 'failed',
        title: 'Not supported',
        message: 'I can’t make that change from here yet.',
      }
  }
}

function prettyDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
