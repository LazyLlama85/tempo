// Tempo — Edge Function: retention-push
//
// The server-side retention engine. Runs on a schedule (hourly via pg_cron — see
// supabase/add_push_notifications.sql) and decides, per user, whether to send a
// push *right now*. This is what makes notifications a retention driver instead
// of dumb device-local alarms: the decision is data-driven and server-triggered,
// so it scales to every user with no manual sending.
//
// Rules implemented (each de-duplicated to at most once per user per day):
//   1. missed_workout   — a plan workout was due earlier today and not completed.
//   2. streak_at_risk   — user has an active streak but hasn't trained today; nudge
//                         in the evening before the day (and the streak) is lost.
//   3. free_time_gap    — user has free time today (no workout scheduled / completed)
//                         during the daytime → "you've got 20 min, get a quick one in".
//   4. reactivation     — no activity for INACTIVE_DAYS+ days → win them back.
//
// Every attempt is written to notification_log (status sent|failed), and tokens
// Expo reports as dead are disabled so we stop wasting sends on them.
//
// Deploy:  npx supabase functions deploy retention-push --no-verify-jwt
//          (invoked by cron with the service-role key; not user-facing.)

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const INACTIVE_DAYS = 5            // reactivation threshold
const EVENING_HOUR_UTC_FALLBACK = 18 // used only if we can't infer local hour

type NotificationType = 'weekly_report' | 'missed_workout' | 'streak_at_risk' | 'free_time_gap' | 'reactivation'

interface Candidate {
  userId: string
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown>
}

interface DeviceToken {
  token: string
  platform: string
}

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req: Request) => {
  // Cron invokes with the service-role bearer; reject anything else.
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    const candidates = await buildCandidates(admin)
    const result = await dispatch(admin, candidates)
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[retention-push] unhandled:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ─────────────────────────────────────────────
// Rules → candidate notifications
// ─────────────────────────────────────────────
async function buildCandidates(admin: SupabaseClient): Promise<Candidate[]> {
  const today = todayStr()
  const candidates: Candidate[] = []

  // Only consider users with at least one live device token. One row per user is
  // enough here; token fan-out happens at send time.
  const { data: tokenUsers } = await admin
    .from('device_tokens')
    .select('user_id')
    .eq('enabled', true)
  const userIds = [...new Set((tokenUsers ?? []).map((r) => r.user_id as string))]
  if (userIds.length === 0) return candidates

  // Pull the day's signal in bulk to keep this O(few queries) rather than per-user.
  const [{ data: scheduled }, { data: logs }, { data: alreadySent }] = await Promise.all([
    admin
      .from('scheduled_workouts')
      .select('user_id, planned_date, planned_start_time, status, focus')
      .gte('planned_date', addDays(today, -INACTIVE_DAYS))
      .in('user_id', userIds),
    admin
      .from('workout_logs')
      .select('user_id, completed_at')
      .gte('completed_at', addDays(today, -(INACTIVE_DAYS + 30)) + 'T00:00:00Z')
      .in('user_id', userIds),
    // What we've already sent today, so we never double-nudge.
    admin
      .from('notification_log')
      .select('user_id, type')
      .gte('created_at', today + 'T00:00:00Z')
      .in('user_id', userIds),
  ])

  const sentKey = new Set((alreadySent ?? []).map((r) => `${r.user_id}:${r.type}`))
  const completedDates = byUser(logs ?? [], (r) => (r.completed_at as string | null)?.slice(0, 10))
  const sched = groupBy(scheduled ?? [], (r) => r.user_id as string)

  const nowDate = new Date()
  const nowHourUtc = nowDate.getUTCHours()
  const nowDayUtc = nowDate.getUTCDay() // 0 = Sunday
  const weekStartStr = addDays(today, -((nowDate.getUTCDay() + 6) % 7)) // Monday of this week

  for (const userId of userIds) {
    const completed = completedDates.get(userId) ?? new Set<string>()
    const mine = sched.get(userId) ?? []
    const completedToday = completed.has(today)

    const add = (c: Omit<Candidate, 'userId'>) => {
      if (sentKey.has(`${userId}:${c.type}`)) return // de-dup: one per type per day
      candidates.push({ userId, ...c })
      sentKey.add(`${userId}:${c.type}`)             // also prevent two rules colliding
    }

    // 0. Weekly report — Sunday evening, if they trained at all this week. The
    //    recap is the highest-value retention nudge, so it leads on Sundays.
    if (nowDayUtc === 0 && nowHourUtc >= EVENING_HOUR_UTC_FALLBACK) {
      const trainedThisWeek = [...completed].some(d => d >= weekStartStr)
      if (trainedThisWeek) {
        add({
          type: 'weekly_report',
          title: 'Your week in review 📊',
          body: 'See your progress this week — workouts, volume, and what improved. Then share it.',
          data: { screen: 'weekly-report' },
        })
        continue
      }
    }

    // 1. Missed workout — a plan session was due earlier today, still not done.
    const missedToday = mine.find(
      (w) => w.planned_date === today && (w.status === 'missed' || w.status === 'scheduled'),
    )
    if (missedToday && !completedToday) {
      add({
        type: 'missed_workout',
        title: 'Still time to train today',
        body: `Your ${missedToday.focus} session is waiting. Even 15 minutes keeps you on track.`,
        data: { screen: 'plan' },
      })
      continue // one push per user per run is plenty — don't stack nudges
    }

    // 2. Streak at risk — trained recently (yesterday) but not yet today; nudge in the evening.
    const trainedYesterday = completed.has(addDays(today, -1))
    if (trainedYesterday && !completedToday && nowHourUtc >= EVENING_HOUR_UTC_FALLBACK) {
      add({
        type: 'streak_at_risk',
        title: "Don't break your streak",
        body: 'You showed up yesterday. A quick session right now keeps the momentum alive.',
        data: { screen: 'quick-workout' },
      })
      continue
    }

    // 3. Free-time gap — nothing scheduled or done today, during the active part of
    //    the day → surface a Quick Workout while there's room for it.
    const hasWorkoutToday = mine.some((w) => w.planned_date === today)
    if (!hasWorkoutToday && !completedToday && nowHourUtc >= 12 && nowHourUtc < EVENING_HOUR_UTC_FALLBACK) {
      add({
        type: 'free_time_gap',
        title: 'Got 20 minutes?',
        body: "There's a gap in your day — Tempo can build a quick session that fits it right now.",
        data: { screen: 'quick-workout' },
      })
      continue
    }

    // 4. Reactivation — no completed workout in the last INACTIVE_DAYS days.
    const lastActive = mostRecent(completed)
    const inactiveDays = lastActive ? daysBetween(lastActive, today) : Infinity
    if (inactiveDays >= INACTIVE_DAYS) {
      add({
        type: 'reactivation',
        title: 'Your plan is still here',
        body: "It's been a few days. Pick up right where you left off — one short workout to restart.",
        data: { screen: 'home' },
      })
    }
  }

  return candidates
}

// ─────────────────────────────────────────────
// Dispatch via Expo Push API + logging + dead-token cleanup
// ─────────────────────────────────────────────
async function dispatch(admin: SupabaseClient, candidates: Candidate[]) {
  if (candidates.length === 0) return { sent: 0, failed: 0, candidates: 0 }

  // Fan each candidate out to all of that user's enabled tokens.
  const { data: tokens } = await admin
    .from('device_tokens')
    .select('user_id, token, platform')
    .eq('enabled', true)
    .in('user_id', candidates.map((c) => c.userId))

  const tokensByUser = groupBy(tokens ?? [], (t) => t.user_id as string)

  interface Outgoing {
    candidate: Candidate
    token: string
  }
  const outgoing: Outgoing[] = []
  for (const c of candidates) {
    for (const t of (tokensByUser.get(c.userId) ?? []) as DeviceToken[]) {
      outgoing.push({ candidate: c, token: t.token })
    }
  }

  let sent = 0
  let failed = 0

  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < outgoing.length; i += 100) {
    const batch = outgoing.slice(i, i + 100)
    const messages = batch.map(({ candidate, token }) => ({
      to: token,
      sound: 'default',
      title: candidate.title,
      body: candidate.body,
      data: { type: candidate.type, ...candidate.data },
      channelId: 'workouts',
    }))

    let tickets: any[] = []
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      })
      const json = await res.json()
      tickets = json.data ?? []
    } catch (e) {
      // Whole-batch network failure: log every message as failed for retry next run.
      const msg = e instanceof Error ? e.message : String(e)
      await logBatch(admin, batch.map(({ candidate, token }) => ({
        ...candidate, token, status: 'failed' as const, error: msg, ticketId: null,
      })))
      failed += batch.length
      continue
    }

    const deadTokens: string[] = []
    const rows = batch.map(({ candidate, token }, idx) => {
      const ticket = tickets[idx]
      const ok = ticket?.status === 'ok'
      if (ok) sent++
      else {
        failed++
        // DeviceNotRegistered → the token is dead; disable it so we stop trying.
        if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(token)
      }
      return {
        ...candidate,
        token,
        status: ok ? ('sent' as const) : ('failed' as const),
        error: ok ? null : (ticket?.message ?? ticket?.details?.error ?? 'unknown'),
        ticketId: ticket?.id ?? null,
      }
    })

    await logBatch(admin, rows)

    if (deadTokens.length) {
      await admin.from('device_tokens').update({ enabled: false }).in('token', deadTokens)
    }
  }

  return { candidates: candidates.length, messages: outgoing.length, sent, failed }
}

async function logBatch(
  admin: SupabaseClient,
  rows: Array<Candidate & { token: string; status: 'sent' | 'failed'; error: string | null; ticketId: string | null }>,
) {
  if (rows.length === 0) return
  await admin.from('notification_log').insert(
    rows.map((r) => ({
      user_id: r.userId,
      type: r.type,
      title: r.title,
      body: r.body,
      data: r.data,
      token: r.token,
      status: r.status,
      error: r.error,
      expo_ticket_id: r.ticketId,
      sent_at: r.status === 'sent' ? new Date().toISOString() : null,
    })),
  )
}

// ─────────────────────────────────────────────
// Small date / grouping helpers
// ─────────────────────────────────────────────
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000,
  )
}
function mostRecent(dates: Set<string>): string | null {
  let max: string | null = null
  for (const d of dates) if (!max || d > max) max = d
  return max
}
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}
function byUser<T extends { user_id: string }>(
  rows: T[],
  pick: (r: T) => string | undefined,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const r of rows) {
    const v = pick(r)
    if (!v) continue
    const s = m.get(r.user_id) ?? new Set<string>()
    s.add(v)
    m.set(r.user_id, s)
  }
  return m
}
