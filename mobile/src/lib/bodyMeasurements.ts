// Body measurement history + trend math.
//
// The source of truth is the `body_measurements` time-series table (one row per
// logged entry — never overwritten). `user_profiles.bodyweight_lbs` is kept as a
// denormalised "latest weight" cache for quick reads (e.g. the scheduler / header),
// updated whenever a newer weight is logged.
//
// The trend helpers turn that raw series into the feedback loop the product needs:
// "−0.4 lb/week", a smoothed current weight, and progress vs. the user's goal.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BodyMeasurement } from '@/types'

export interface MeasurementInput {
  weight_lbs?: number | null
  body_fat_pct?: number | null
  waist_in?: number | null
  photo_url?: string | null
  note?: string | null
  measured_at?: string  // defaults to now()
}

/**
 * Log a new measurement. Appends to history (never overwrites) and, when a weight
 * is included and it's the newest entry, refreshes the cached profile weight.
 */
export async function logMeasurement(
  client: SupabaseClient,
  userId: string,
  input: MeasurementInput,
): Promise<BodyMeasurement | null> {
  const measuredAt = input.measured_at ?? new Date().toISOString()
  const { data, error } = await client
    .from('body_measurements')
    .insert({
      user_id: userId,
      weight_lbs: input.weight_lbs ?? null,
      body_fat_pct: input.body_fat_pct ?? null,
      waist_in: input.waist_in ?? null,
      photo_url: input.photo_url ?? null,
      note: input.note ?? null,
      measured_at: measuredAt,
    })
    .select('*')
    .single()
  if (error) throw error

  // Keep the profile's quick-read weight in sync when this is the latest weigh-in.
  if (input.weight_lbs != null) {
    const { data: latest } = await client
      .from('body_measurements')
      .select('measured_at')
      .eq('user_id', userId)
      .not('weight_lbs', 'is', null)
      .order('measured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!latest || latest.measured_at <= measuredAt) {
      await client.from('user_profiles').update({ bodyweight_lbs: input.weight_lbs }).eq('user_id', userId)
    }
  }

  return (data as BodyMeasurement) ?? null
}

/**
 * Fetch a user's measurements, newest first. `sinceDays` limits the window (e.g.
 * 90 for a quarter); omit for the full history.
 */
export async function fetchMeasurements(
  client: SupabaseClient,
  userId: string,
  sinceDays?: number,
): Promise<BodyMeasurement[]> {
  let q = client
    .from('body_measurements')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
  if (sinceDays != null) {
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
    q = q.gte('measured_at', since)
  }
  const { data, error } = await q
  if (error) throw error
  return (data as BodyMeasurement[]) ?? []
}

// ── Trend math ────────────────────────────────────────────────────────────────

export interface WeightTrend {
  // Slope in lb/week (negative = losing). null when there isn't enough data.
  lbsPerWeek: number | null
  // Smoothed current weight (latest rolling average) for display.
  currentAvg: number | null
  // Total change across the window (latest − earliest), in lb.
  totalChange: number | null
  // How many weigh-ins fed the calculation.
  samples: number
}

interface WeightPoint {
  t: number    // epoch ms
  w: number    // weight lb
}

function weightPoints(measurements: BodyMeasurement[]): WeightPoint[] {
  return measurements
    .filter((m) => m.weight_lbs != null)
    .map((m) => ({ t: Date.parse(m.measured_at), w: m.weight_lbs as number }))
    .sort((a, b) => a.t - b.t)
}

/**
 * Weekly weight trend via least-squares linear regression over the window — robust
 * to noisy day-to-day fluctuation in a way that a naive first-vs-last delta isn't.
 * Returns lb/week plus a smoothed current weight and total change.
 */
export function computeWeightTrend(
  measurements: BodyMeasurement[],
  windowDays = 28,
): WeightTrend {
  const cutoff = Date.now() - windowDays * 86_400_000
  const pts = weightPoints(measurements).filter((p) => p.t >= cutoff)

  if (pts.length < 2) {
    const all = weightPoints(measurements)
    return {
      lbsPerWeek: null,
      currentAvg: all.length ? all[all.length - 1].w : null,
      totalChange: null,
      samples: pts.length,
    }
  }

  // Regress weight on time (in weeks) — slope is directly lb/week.
  const weeks = pts.map((p) => (p.t - pts[0].t) / (7 * 86_400_000))
  const n = pts.length
  const sumX = weeks.reduce((a, b) => a + b, 0)
  const sumY = pts.reduce((a, p) => a + p.w, 0)
  const sumXY = pts.reduce((a, p, i) => a + weeks[i] * p.w, 0)
  const sumXX = weeks.reduce((a, x) => a + x * x, 0)
  const denom = n * sumXX - sumX * sumX
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom

  return {
    lbsPerWeek: round1(slope),
    currentAvg: rollingAverage(measurements, 7) ?? round1(pts[pts.length - 1].w),
    totalChange: round1(pts[pts.length - 1].w - pts[0].w),
    samples: n,
  }
}

/**
 * Rolling average weight over the last `days` (default 7). Smooths the latest
 * reading so a single heavy/light day doesn't read as real progress. null when no
 * weigh-ins fall in the window.
 */
export function rollingAverage(measurements: BodyMeasurement[], days = 7): number | null {
  const cutoff = Date.now() - days * 86_400_000
  const recent = weightPoints(measurements).filter((p) => p.t >= cutoff)
  if (recent.length === 0) return null
  return round1(recent.reduce((a, p) => a + p.w, 0) / recent.length)
}

/** Format a weekly trend for display, e.g. "−0.4 lb/week" / "+0.2 lb/week" / "—". */
export function formatTrend(lbsPerWeek: number | null): string {
  if (lbsPerWeek == null) return '—'
  if (Math.abs(lbsPerWeek) < 0.05) return 'Holding steady'
  const sign = lbsPerWeek < 0 ? '−' : '+'
  return `${sign}${Math.abs(lbsPerWeek).toFixed(1)} lb/week`
}

// ── Generic metric trend (body fat %, waist) ────────────────────────────────────

export type TrendMetric = 'body_fat_pct' | 'waist_in'

export interface MetricTrend {
  perWeek: number | null   // change per week (negative = decreasing)
  latest: number | null    // most recent reading
  totalChange: number | null
  samples: number
}

/**
 * Same least-squares regression as weight, applied to body fat % or waist. Returns
 * change-per-week + the latest reading. Used for the optional body-composition
 * trends alongside weight.
 */
export function computeMetricTrend(
  measurements: BodyMeasurement[],
  metric: TrendMetric,
  windowDays = 42,
): MetricTrend {
  const cutoff = Date.now() - windowDays * 86_400_000
  const pts = measurements
    .filter((m) => m[metric] != null)
    .map((m) => ({ t: Date.parse(m.measured_at), v: m[metric] as number }))
    .sort((a, b) => a.t - b.t)
  const inWindow = pts.filter((p) => p.t >= cutoff)

  if (inWindow.length < 2) {
    return { perWeek: null, latest: pts.length ? pts[pts.length - 1].v : null, totalChange: null, samples: inWindow.length }
  }

  const weeks = inWindow.map((p) => (p.t - inWindow[0].t) / (7 * 86_400_000))
  const n = inWindow.length
  const sumX = weeks.reduce((a, b) => a + b, 0)
  const sumY = inWindow.reduce((a, p) => a + p.v, 0)
  const sumXY = inWindow.reduce((a, p, i) => a + weeks[i] * p.v, 0)
  const sumXX = weeks.reduce((a, x) => a + x * x, 0)
  const denom = n * sumXX - sumX * sumX
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom

  return {
    perWeek: round1(slope),
    latest: round1(inWindow[inWindow.length - 1].v),
    totalChange: round1(inWindow[inWindow.length - 1].v - inWindow[0].v),
    samples: n,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
