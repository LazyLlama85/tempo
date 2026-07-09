// Tempo — the Program / Split layer.
//
// A split is the user's overall weekly training schedule: a named weekday→workout
// pattern (Push Pull Legs, Upper Lower, a custom split, …). Each non-rest day
// carries a self-contained workout (exercise_ids + per-exercise config), snapshotted
// from a saved template or assembled inline, so a split keeps working even if the
// source template is later edited or deleted.
//
// One split is active at a time. Activating one materializes ordinary
// `scheduled_workouts` rows (see lib/splitSchedule.ts) — everything downstream
// (calendar feed, runner, auto-scheduling, calendar sync, missed sweep) is unchanged.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Exercise, Goal, Split, SplitDay, WorkoutTemplate } from '@/types'
import { type DraftItem, itemToConfig, makeDraftItem } from './workoutBuilder'
import { EXERCISE_COLUMNS, metricsFor } from './customExercises'

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const isAutoSplit = (s: Split): boolean => s.kind === 'auto'

// A fresh split = a full rest week the user fills in. Always 7 days, Mon→Sun, so the
// editor and the materializer can index by weekday without gaps.
export function emptySplitDays(): SplitDay[] {
  return Array.from({ length: 7 }, (_, i) => ({
    weekday: i + 1,
    label: 'Rest',
    rest: true,
  }))
}

// Build a day's workout from picked exercises (default prescription).
export function dayFromDraftItems(weekday: number, label: string, items: DraftItem[]): SplitDay {
  return {
    weekday,
    label: label.trim() || 'Workout',
    rest: false,
    template_id: null,
    exercise_ids: items.map((i) => i.exercise.id),
    config: items.map(itemToConfig),
  }
}

// Snapshot a saved template onto a day (keeps a reference + a copy of the config).
export function dayFromTemplate(weekday: number, template: WorkoutTemplate): SplitDay {
  return {
    weekday,
    label: template.name,
    rest: false,
    template_id: template.id,
    exercise_ids: [...template.exercise_ids],
    config: template.config.map((c) => ({ ...c })),
  }
}

export function restDay(weekday: number): SplitDay {
  return { weekday, label: 'Rest', rest: true }
}

// Re-hydrate a saved day's workout into editable draft items (fetches exercise rows,
// preserving order and dropping any that were deleted). Mirrors templateToItems.
export async function dayToDraftItems(client: SupabaseClient, day: SplitDay): Promise<DraftItem[]> {
  const map = await daysToDraftItems(client, [day])
  return map.get(day.weekday) ?? []
}

// Hydrate MANY days in one round-trip: a single exercises query for the whole
// split instead of one per day. The split editor opens 7 days at once — the
// per-day version made that seven sequential network calls and a visibly slow
// (and flaky-feeling) load.
export async function daysToDraftItems(
  client: SupabaseClient,
  days: SplitDay[],
): Promise<Map<number, DraftItem[]>> {
  const allIds = [...new Set(days.flatMap((d) => d.exercise_ids ?? []))]
  const byId = new Map<string, Exercise>()
  if (allIds.length) {
    const { data } = await client.from('exercises').select(EXERCISE_COLUMNS).in('id', allIds)
    for (const e of (data ?? []) as Exercise[]) byId.set(e.id, e)
  }
  const out = new Map<number, DraftItem[]>()
  for (const day of days) {
    const items: DraftItem[] = []
    for (const id of day.exercise_ids ?? []) {
      const ex = byId.get(id)
      if (!ex) continue
      const cfg = day.config?.find((c) => c.exercise_id === id)
      if (cfg) {
        items.push({
          exercise: ex,
          sets: cfg.sets,
          repLow: cfg.rep_low,
          repHigh: cfg.rep_high,
          weightLbs: cfg.weight_lbs,
          durationSec: cfg.duration_sec,
          distanceM: cfg.distance_m,
          metrics: cfg.metrics?.length ? cfg.metrics : metricsFor(ex),
        })
      } else {
        items.push(makeDraftItem(ex))
      }
    }
    out.set(day.weekday, items)
  }
  return out
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function fetchSplits(client: SupabaseClient, userId: string): Promise<Split[]> {
  const { data } = await client
    .from('splits')
    .select('*')
    .eq('user_id', userId)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
  return (data ?? []) as Split[]
}

export async function fetchActiveSplit(client: SupabaseClient, userId: string): Promise<Split | null> {
  const { data } = await client
    .from('splits')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  return (data as Split) ?? null
}

export async function saveSplit(
  client: SupabaseClient,
  userId: string,
  args: { name: string; days: SplitDay[]; splitId?: string | null },
): Promise<string | null> {
  const name = args.name.trim()
  if (!name) return null
  const row = {
    user_id: userId,
    name,
    days: args.days,
    updated_at: new Date().toISOString(),
  }
  if (args.splitId) {
    const { error } = await client.from('splits').update(row).eq('id', args.splitId)
    return error ? null : args.splitId
  }
  const { data, error } = await client.from('splits').insert(row).select('id').single()
  return error ? null : (data?.id ?? null)
}

export async function deleteSplit(client: SupabaseClient, splitId: string): Promise<boolean> {
  const { error } = await client.from('splits').delete().eq('id', splitId)
  return !error
}

export async function duplicateSplit(
  client: SupabaseClient,
  userId: string,
  split: Split,
): Promise<string | null> {
  const { data, error } = await client
    .from('splits')
    .insert({ user_id: userId, name: `${split.name} (copy)`, days: split.days, is_active: false })
    .select('id')
    .single()
  return error ? null : (data?.id ?? null)
}

// Make exactly one split active. Deactivates the rest first so the partial-unique
// index (one active per user) is never violated.
export async function setActiveSplit(client: SupabaseClient, userId: string, splitId: string): Promise<boolean> {
  const { error: clearErr } = await client
    .from('splits')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true)
  if (clearErr) return false
  const { error } = await client.from('splits').update({ is_active: true }).eq('id', splitId).eq('user_id', userId)
  return !error
}

export async function deactivateSplits(client: SupabaseClient, userId: string): Promise<void> {
  await client.from('splits').update({ is_active: false }).eq('user_id', userId).eq('is_active', true)
}

// A friendly summary line for a day in the list ("3 exercises" / "Rest").
export function daySummary(day: SplitDay): string {
  if (day.rest) return 'Rest'
  const n = day.exercise_ids?.length ?? 0
  return n === 0 ? 'No exercises yet' : `${n} exercise${n === 1 ? '' : 's'}`
}

// ── Auto-plan mirror split ────────────────────────────────────────────────────
// The auto-generated program shows up in My Splits as a kind='auto' split, so a
// user can toggle it on/off next to any custom splits. Its `days` are a read-only
// preview built from the plan's own upcoming sessions; activating it (see
// lib/splitSchedule.activateAutoPlan) regenerates the periodized plan rather than
// materializing this static copy, so the mesocycle/deload logic is preserved.

const GOAL_PROGRAM_NAME: Record<Goal, string> = {
  muscle_gain: 'Muscle-Building Program',
  strength: 'Strength Program',
  fat_loss: 'Fat-Loss Program',
  general_fitness: 'Fitness Program',
  athletic: 'Athletic Program',
}

function isoWeekdayOf(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`)
  return ((d.getDay() + 6) % 7) + 1
}

// Build (or refresh) the auto split from the active plan's upcoming sessions.
// No-op when the user has no active plan. Idempotent — only writes when the mirror
// actually changed, and never bumps updated_at (so it doesn't jump the list order).
export async function ensureAutoSplit(client: SupabaseClient, userId: string, goal: Goal): Promise<void> {
  try {
    const { data: existingRows } = await client
      .from('splits')
      .select('*')
      .eq('user_id', userId)
      .eq('kind', 'auto')
    const auto = (existingRows?.[0] as Split | undefined) ?? null

    // Self-heal duplicates from older builds: the auto mirror is a *projection* of the
    // plan and must NEVER own scheduled rows (the plan owns those as source='plan').
    // A now-fixed bug could materialize the mirror into source='split' sessions on top
    // of the plan's, so a day showed the workout twice. Drop any such future rows —
    // they were never started, so no workout_logs depend on them. Idempotent once clean.
    if (auto) {
      const t = new Date(); t.setHours(0, 0, 0, 0)
      const tStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
      await client
        .from('scheduled_workouts')
        .delete()
        .eq('user_id', userId)
        .eq('split_id', auto.id)
        .eq('status', 'scheduled')
        .gte('planned_date', tStr)
    }

    const { data: plan } = await client
      .from('user_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!plan) {
      // No active program — keep the mirror around but inactive so the user can
      // switch back to it, without it claiming the "active schedule" slot.
      if (auto?.is_active) await client.from('splits').update({ is_active: false }).eq('id', auto.id)
      return
    }

    // First upcoming session per weekday → the week's shape.
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const { data: rows } = await client
      .from('scheduled_workouts')
      .select('planned_date, focus, exercise_ids')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .gte('planned_date', todayStr)
      .order('planned_date')
      .limit(21)

    const byWeekday = new Map<number, { focus: string; ids: string[] }>()
    for (const r of (rows ?? []) as { planned_date: string; focus: string; exercise_ids: string[] | null }[]) {
      const wd = isoWeekdayOf(r.planned_date)
      if (byWeekday.has(wd)) continue
      byWeekday.set(wd, { focus: (r.focus || 'Workout').replace(/\s*\(Deload\)\s*$/i, ''), ids: r.exercise_ids ?? [] })
    }
    if (!byWeekday.size) return // plan has no upcoming rows yet — nothing to mirror

    const days: SplitDay[] = Array.from({ length: 7 }, (_, i) => {
      const wd = i + 1
      const hit = byWeekday.get(wd)
      return hit && hit.ids.length
        ? { weekday: wd, label: hit.focus, rest: false, exercise_ids: hit.ids }
        : restDay(wd)
    })
    const name = GOAL_PROGRAM_NAME[goal] ?? GOAL_PROGRAM_NAME.general_fitness

    if (auto) {
      // Only write when something actually changed (avoid needless churn on open).
      const sameDays = JSON.stringify(auto.days) === JSON.stringify(days)
      if (sameDays && auto.name === name && auto.is_active) return
      await client.from('splits').update({ name, days, is_active: true }).eq('id', auto.id)
    } else {
      // A brand-new mirror is active only if no custom split currently is (the plan
      // being active already implies that, but guard the unique-active index).
      const { data: activeCustom } = await client
        .from('splits')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle()
      await client.from('splits').insert({ user_id: userId, name, days, kind: 'auto', is_active: !activeCustom })
    }
  } catch {
    // Best-effort — the mirror is a convenience, never block plan generation on it.
  }
}

// Re-export for the editor so it can seed a new exercise with sensible defaults.
export { makeDraftItem }
