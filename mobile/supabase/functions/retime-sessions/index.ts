// Arclo — Edge Function: retime-sessions
//
// Server-side enforcement of "never schedule a session at a time the user told
// us they cannot train".
//
// WHY THIS EXISTS, when the client already does this.
//
// `lib/retimeUnmakeable.ts` performs the same repair on the device, on app open.
// That is the right place for it and it is not enough, for a reason that took a
// production incident to make obvious: it can only ever run inside a JS bundle
// the user has actually received. On 2026-09-05 an audit found 162 future
// sessions (44% of all of them) at impossible times — sessions during school,
// during work, before the user was out of bed. The engine fix AND the client
// repair both already existed. Neither had reached anybody, so the code written
// to clean up the damage was trapped behind the same delivery failure that let
// the damage persist.
//
// Those 162 rows were repaired out of band. Hours later a user on an old bundle
// generated a fresh plan and was handed a session starting at 07:30 — the exact
// minute their workday starts. That is the lesson: a one-time data repair does
// not hold while any client can still write bad times. Enforcement has to live
// somewhere every user reaches regardless of what version they are running, and
// the only such place is the server.
//
// So this runs hourly, for every user, and re-times only sessions that are
// genuinely unmakeable. It is deliberately the same narrow judgement the client
// makes:
//   • a session must fit ENTIRELY inside one free window
//   • never before wake + WAKE_BUFFER_MIN
//   • a session that is merely early, or merely not where the scheduler would
//     put it today, is left alone — the user may have chosen it
//   • a day with no free window at all is left alone rather than guessed at
//
// `availability.ts` here is a VERBATIM copy of `mobile/src/lib/availability.ts`,
// which has zero imports precisely so it can be shared. Drift between the two is
// prevented by `lib/__tests__/availabilityVendorCopy.test.ts`, which fails the
// suite if the files differ by a single byte.
//
// Auth: same shared-secret scheme as retention-push (deployed verify_jwt=false
// because pg_cron has no user JWT). See add_retention_push_auth.sql.
//
// Deploy: npx supabase functions deploy retime-sessions --no-verify-jwt

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  chooseSessionStart, weekdayFreeIntervals, toMinutes, minutesToTime, isoWeekday,
  WAKE_BUFFER_MIN, type AvailabilityInputs,
} from './availability.ts'

/** How far ahead to repair. Matches the plan's own rolling horizon. */
const HORIZON_DAYS = 28

/** Candidate times a repair prefers, in order: the session's own hour first. */
function candidatesFor(startTime: string): number[] {
  const own = toMinutes(startTime)
  const usual = ['07:00', '08:00', '09:00', '12:30', '15:30', '16:00', '17:30', '18:30', '19:00']
    .map((t) => toMinutes(t))
    .filter((m): m is number => m != null)
  return own != null ? [own, ...usual] : usual
}

interface Row {
  id: string
  user_id: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number | null
}

/**
 * Is this session impossible as scheduled? Mirrors `isUnmakeable` in
 * lib/retimeUnmakeable.ts exactly.
 */
function isUnmakeable(row: Row, av: AvailabilityInputs): boolean {
  const start = toMinutes(row.planned_start_time)
  if (start == null) return false
  const duration = row.planned_duration_min ?? 45
  const end = start + duration

  // Nothing declared means nothing to contradict — never move a session on the
  // strength of default values alone.
  const declared = !!av.wake_time || !!av.work_start || !!av.school_start ||
    !!(av.unavailable_blocks ?? []).length
  if (!declared) return false

  const wake = toMinutes(av.wake_time)
  if (wake != null && start < wake + WAKE_BUFFER_MIN) return true

  const free = weekdayFreeIntervals(av, isoWeekday(row.planned_date))
  if (free.length === 0) return false // nothing known about this day: leave it be
  return !free.some(([s, e]) => start >= s && end <= e)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const presented = req.headers.get('x-retention-push-secret')
  if (!presented) return new Response('unauthorized', { status: 401 })
  const { data: expected, error: secretErr } = await admin.rpc('get_retention_push_secret')
  if (secretErr || !expected || presented !== expected) {
    console.error('[retime-sessions] rejected: bad or missing shared secret')
    return new Response('unauthorized', { status: 401 })
  }

  // `dry=1` reports what it WOULD change without writing. Used to verify a
  // deploy against live data before letting it near anyone's schedule.
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  try {
    const today = new Date().toISOString().slice(0, 10)
    const horizon = new Date(`${today}T00:00:00Z`)
    horizon.setUTCDate(horizon.getUTCDate() + HORIZON_DAYS)
    const horizonStr = horizon.toISOString().slice(0, 10)

    const { data: rows, error: rowsErr } = await admin
      .from('scheduled_workouts')
      .select('id, user_id, planned_date, planned_start_time, planned_duration_min')
      .eq('status', 'scheduled')
      .gte('planned_date', today)
      .lte('planned_date', horizonStr)
    if (rowsErr) throw rowsErr
    if (!rows?.length) {
      return new Response(JSON.stringify({ ok: true, checked: 0, moved: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const userIds = [...new Set(rows.map((r) => r.user_id as string))]
    const { data: profiles, error: profErr } = await admin
      .from('user_profiles')
      .select('user_id, wake_time, bedtime, work_start, work_end, school_start, school_end, unavailable_blocks')
      .in('user_id', userIds)
    if (profErr) throw profErr

    const avByUser = new Map<string, AvailabilityInputs>()
    for (const p of profiles ?? []) {
      avByUser.set(p.user_id as string, {
        wake_time: (p.wake_time ?? null) as string | null,
        bedtime: (p.bedtime ?? null) as string | null,
        work_start: (p.work_start ?? null) as string | null,
        work_end: (p.work_end ?? null) as string | null,
        school_start: (p.school_start ?? null) as string | null,
        school_end: (p.school_end ?? null) as string | null,
        unavailable_blocks: (p.unavailable_blocks ?? []) as AvailabilityInputs['unavailable_blocks'],
      })
    }

    let moved = 0
    let leftAlone = 0
    const changes: string[] = []

    for (const raw of rows as Row[]) {
      const av = avByUser.get(raw.user_id)
      if (!av) continue
      if (!isUnmakeable(raw, av)) continue

      const next = chooseSessionStart({
        candidates: candidatesFor(raw.planned_start_time),
        weekday: isoWeekday(raw.planned_date),
        durationMin: raw.planned_duration_min ?? 45,
        av,
      })
      // No window at all that day: leave it where it is rather than guessing.
      if (next == null) { leftAlone++; continue }

      const newTime = minutesToTime(next)
      if (newTime === raw.planned_start_time) continue

      // Never write a time that is not itself makeable.
      const duration = raw.planned_duration_min ?? 45
      const fits = weekdayFreeIntervals(av, isoWeekday(raw.planned_date))
        .some(([s, e]) => next >= s && next + duration <= e)
      if (!fits) { leftAlone++; continue }

      changes.push(`${raw.planned_date} ${raw.planned_start_time} -> ${newTime}`)
      if (dry) { moved++; continue }

      // Guarded on the previous time so a session the user moved themselves
      // between the read and the write is never clobbered.
      const { error } = await admin
        .from('scheduled_workouts')
        .update({ planned_start_time: newTime })
        .eq('id', raw.id)
        .eq('planned_start_time', raw.planned_start_time)
        .eq('status', 'scheduled')
      if (!error) moved++
    }

    if (moved > 0) console.log(`[retime-sessions] ${dry ? 'would move' : 'moved'} ${moved}`)

    return new Response(
      JSON.stringify({
        ok: true, dry, checked: rows.length, moved, leftAlone,
        changes: changes.slice(0, 40),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[retime-sessions] unhandled:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
