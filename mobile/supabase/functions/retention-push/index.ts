// Tempo — Edge Function: retention-push
//
// The server-side retention engine. Runs on a schedule (hourly via pg_cron — see
// supabase/add_push_notifications.sql) and decides, per user, whether to send a
// push *right now*. This is what makes notifications a retention driver instead
// of dumb device-local alarms: the decision is data-driven and server-triggered,
// so it scales to every user with no manual sending.
//
// Rules implemented (each de-duplicated to at most once per user per day):
//   1. missed_workout      — today's session still isn't done; the daytime nudge.
//   2. streak_at_risk      — today's SCHEDULED session is still open in the evening;
//                            the last call before the session (and streak) is lost.
//                            NEVER fires on a planned rest day — streaks count
//                            completed sessions, so rest days can't break them.
//   2b. partner_reminder   — a workout scheduled WITH a friend is TOMORROW (evening,
//                            day before) → "don't leave your partner hanging".
//   2c. friend_competition — Thursday evening, you're exactly one workout from passing
//                            a friend on this week's leaderboard → "get one in".
//   3. free_time_gap       — user has free time today (no workout scheduled / completed)
//                            during the daytime → "you've got 20 min, get a quick one in".
//   4. reactivation        — no activity for INACTIVE_DAYS+ days → win them back.
//
// Social rules respect the same per-rule opt-out (§6.1) and the one-push-per-run cap.
//
// Every attempt is written to notification_log (status sent|failed), and tokens
// Expo reports as dead are disabled so we stop wasting sends on them.
//
// Deploy:  npx supabase functions deploy retention-push --no-verify-jwt
//          (invoked by cron with the service-role key; not user-facing.)

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const INACTIVE_DAYS = 5            // reactivation threshold
const EVENING_HOUR = 18 // "evening" threshold, applied to each user's LOCAL hour (see localHourFor)

type NotificationType =
  | 'weekly_report' | 'missed_workout' | 'streak_at_risk' | 'free_time_gap' | 'reactivation'
  | 'partner_reminder' | 'friend_competition'

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

// MASTER_FIX_PLAN.md F10 part 4 — EVENING_HOUR used to be judged against the
// SERVER's UTC clock for every user identically, so an "evening" push could
// land at 10am in California or 3am in Tokyo. user_profiles.timezone (IANA
// string, e.g. 'America/Los_Angeles') lets each user's hour/weekday be
// computed against their OWN local time; falls back to the server's UTC
// hour/day only for accounts with no timezone set yet (pre-migration) or an
// invalid value.
function localHourFor(date: Date, timezone: string | null): number {
  if (!timezone) return date.getUTCHours()
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(date)
    const hour = parts.find((p) => p.type === 'hour')?.value
    return hour ? parseInt(hour, 10) : date.getUTCHours()
  } catch {
    return date.getUTCHours() // an invalid/unrecognized IANA string
  }
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
function localDayFor(date: Date, timezone: string | null): number {
  if (!timezone) return date.getUTCDay()
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).formatToParts(date)
    const wd = parts.find((p) => p.type === 'weekday')?.value
    return wd && wd in WEEKDAY_INDEX ? WEEKDAY_INDEX[wd] : date.getUTCDay()
  } catch {
    return date.getUTCDay()
  }
}

// Per-rule opt-out (audit §6.1). `reactivation` is always on (low-frequency
// win-back, not user-exposed). Every other rule defaults ON so nothing a user
// currently receives silently stops when this ships; a user only loses a rule by
// explicitly turning it off. (To make free_time_gap opt-in per the audit, default
// it to false here AND in lib/notificationPrefs.ts.) Keep these two in sync.
function ruleEnabled(prefs: Record<string, unknown> | undefined, type: NotificationType): boolean {
  if (type === 'reactivation') return true
  const v = prefs?.[type]
  if (typeof v === 'boolean') return v
  return true
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
  const [{ data: scheduled }, { data: logs }, { data: alreadySent }, { data: profiles }] = await Promise.all([
    admin
      .from('scheduled_workouts')
      .select('user_id, planned_date, planned_start_time, status, focus, partner_id')
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
    // Per-user rule preferences (audit §6.1) + timezone (F10 — real quiet
    // hours instead of one hardcoded UTC hour for everyone). Absent row /
    // absent key = default.
    admin
      .from('user_profiles')
      .select('user_id, notification_prefs, timezone')
      .in('user_id', userIds),
  ])

  const prefsByUser = new Map<string, Record<string, unknown>>(
    (profiles ?? []).map((r) => [r.user_id as string, (r.notification_prefs ?? {}) as Record<string, unknown>]),
  )
  const tzByUser = new Map<string, string | null>(
    (profiles ?? []).map((r) => [r.user_id as string, (r.timezone as string | null) ?? null]),
  )
  const sentKey = new Set((alreadySent ?? []).map((r) => `${r.user_id}:${r.type}`))
  const completedDates = byUser(logs ?? [], (r) => (r.completed_at as string | null)?.slice(0, 10))
  const sched = groupBy(scheduled ?? [], (r) => r.user_id as string)

  // Server UTC time — still used for the week-boundary date math below (which
  // calendar day counts as "this week" is a separate, lower-stakes question
  // than "is it evening for THIS user," and changing which day a week starts
  // on per-timezone is a materially bigger change than this fix scopes to).
  // Per-user local hour/day (used for the actual quiet-hours gating in the
  // rules below) is computed inside the loop instead — see localHourFor/
  // localDayFor.
  const serverNowDate = new Date()
  const weekStartStr = addDays(today, -((serverNowDate.getUTCDay() + 6) % 7)) // Monday of this week
  const tomorrow = addDays(today, 1)

  // ── Social accountability inputs (partner reminders + friend competition) ──────
  const userIdSet = new Set(userIds)
  const { data: friendships } = await admin
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.in.(${userIds.join(',')}),addressee_id.in.(${userIds.join(',')})`)
  const friendsByUser = new Map<string, Set<string>>()
  const addFriend = (a: string, b: string) => {
    if (!userIdSet.has(a)) return
    const s = friendsByUser.get(a) ?? new Set<string>()
    s.add(b); friendsByUser.set(a, s)
  }
  for (const f of friendships ?? []) {
    addFriend(f.requester_id as string, f.addressee_id as string)
    addFriend(f.addressee_id as string, f.requester_id as string)
  }
  const friendIds = new Set<string>()
  for (const s of friendsByUser.values()) for (const id of s) friendIds.add(id)
  const partnerIds = new Set<string>()
  for (const w of scheduled ?? []) if (w.partner_id) partnerIds.add(w.partner_id as string)

  // Names for partners + friends (who may not have tokens themselves).
  const nameIds = [...new Set([...userIds, ...friendIds, ...partnerIds])]
  const { data: nameRows } = nameIds.length
    ? await admin.from('user_profiles').select('user_id, display_name').in('user_id', nameIds)
    : { data: [] as { user_id: string; display_name: string | null }[] }
  const nameById = new Map<string, string>(
    (nameRows ?? []).map((r) => [r.user_id as string, (r.display_name as string | null) ?? 'a friend']),
  )

  // This week's completed count for everyone we might compare (users + their friends).
  const countIds = [...new Set([...userIds, ...friendIds])]
  const { data: weekRows } = await admin
    .from('scheduled_workouts')
    .select('user_id')
    .eq('status', 'completed')
    .gte('planned_date', weekStartStr)
    .in('user_id', countIds)
  const weekCountByUser = new Map<string, number>()
  for (const r of weekRows ?? []) {
    const u = r.user_id as string
    weekCountByUser.set(u, (weekCountByUser.get(u) ?? 0) + 1)
  }

  for (const userId of userIds) {
    const completed = completedDates.get(userId) ?? new Set<string>()
    const mine = sched.get(userId) ?? []
    const completedToday = completed.has(today)
    const prefs = prefsByUser.get(userId)
    // This user's own local hour/day of week — every rule below that gates on
    // "is it evening" now judges against the user's real local time, not the
    // server's, falling back to server UTC time only if no timezone is set.
    const tz = tzByUser.get(userId) ?? null
    const nowHourUtc = localHourFor(serverNowDate, tz)
    const nowDayUtc = localDayFor(serverNowDate, tz)

    const add = (c: Omit<Candidate, 'userId'>) => {
      if (!ruleEnabled(prefs, c.type)) return         // user muted this rule (§6.1)
      if (sentKey.has(`${userId}:${c.type}`)) return // de-dup: one per type per day
      candidates.push({ userId, ...c })
      sentKey.add(`${userId}:${c.type}`)             // also prevent two rules colliding
    }

    // 0. Weekly report — Sunday evening, if they trained at all this week. The
    //    recap is the highest-value retention nudge, so it leads on Sundays.
    if (nowDayUtc === 0 && nowHourUtc >= EVENING_HOUR) {
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

    // 1. Missed workout — a plan session was due today and still isn't done; the
    //    daytime nudge. (The evening pass is rule 2's, so the two don't stack in
    //    the same hour.)
    const missedToday = mine.find(
      (w) => w.planned_date === today && (w.status === 'missed' || w.status === 'scheduled'),
    )
    if (missedToday && !completedToday && nowHourUtc < EVENING_HOUR) {
      add({
        type: 'missed_workout',
        title: 'Still time to train today',
        body: `Your ${missedToday.focus} session is waiting. Even 15 minutes keeps you on track.`,
        data: { screen: 'plan' },
      })
      continue // one push per user per run is plenty — don't stack nudges
    }

    // 2. Streak at risk — TODAY'S SCHEDULED session is still open in the evening.
    //    This never fires on a planned rest day: a streak is consecutive completed
    //    SESSIONS, so the rest days the plan itself schedules can't break it —
    //    nagging people to train on them would contradict Tempo's own coaching.
    const pendingToday = mine.some((w) => w.planned_date === today && w.status === 'scheduled')
    if (pendingToday && !completedToday && nowHourUtc >= EVENING_HOUR) {
      add({
        type: 'streak_at_risk',
        title: "Tonight's session is still open",
        body: 'A shorter version still counts — finish today and your streak of completed sessions stays alive.',
        data: { screen: 'plan' },
      })
      continue
    }

    // 2b. Partner reminder — a workout scheduled WITH a friend is tomorrow. The
    //     "don't leave your partner hanging" accountability nudge; evening, day before.
    const partnerW = mine.find(
      (w) => w.planned_date === tomorrow && w.partner_id && w.status === 'scheduled',
    )
    if (partnerW && nowHourUtc >= EVENING_HOUR) {
      const pname = firstName(nameById.get(partnerW.partner_id as string) ?? 'your friend')
      add({
        type: 'partner_reminder',
        title: 'Training with a friend tomorrow 🤝',
        body: `You and ${pname} have ${partnerW.focus} tomorrow — don't leave them hanging.`,
        data: { screen: 'plan' },
      })
      continue
    }

    // 2c. Friend competition — you're one workout from passing a friend this week.
    //     Thursday evening only, so it's a weekly end-of-week push, not a daily nag.
    if (nowDayUtc === 4 && nowHourUtc >= EVENING_HOUR) {
      const myWeek = weekCountByUser.get(userId) ?? 0
      let passName: string | null = null
      for (const fid of friendsByUser.get(userId) ?? []) {
        if ((weekCountByUser.get(fid) ?? 0) === myWeek + 1) { passName = firstName(nameById.get(fid) ?? 'a friend'); break }
      }
      if (passName) {
        add({
          type: 'friend_competition',
          title: 'One workout from the lead 🏁',
          body: `You're 1 workout from passing ${passName} on this week's leaderboard. Get one in.`,
          data: { screen: 'social' },
        })
        continue
      }
    }

    // 3. Free-time gap — nothing scheduled or done today, during the active part of
    //    the day → surface a Quick Workout while there's room for it.
    const hasWorkoutToday = mine.some((w) => w.planned_date === today)
    if (!hasWorkoutToday && !completedToday && nowHourUtc >= 12 && nowHourUtc < EVENING_HOUR) {
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
function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'a friend'
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
