// Tempo — Tempo Coach, DEV-ONLY canned replies.
//
// ⚠️ TEMPORARY SCAFFOLDING. Delete this file once `tempo-coach` is deployed and
// ANTHROPIC_API_KEY is set. It exists for exactly one reason: the C4 action
// layer (confirm card → executor → re-validation → action_state) is the batch
// most likely to hurt the scheduling engine, and it should be device-tested
// before an API key exists rather than after. Testing it against fixed inputs
// is also strictly better than testing it against a nondeterministic model.
//
// It is reached only from `sendCoachMessage`, only when `coachStubEnabled()` is
// true (`__DEV__` AND `EXPO_PUBLIC_COACH_STUB=1`, which no EAS profile sets),
// and only via a dynamic import — so a release build never loads it.
//
// Every reply carries `messageId: null`, which is what stops a stubbed proposal
// from writing `action_state` against a `coach_messages` row that doesn't exist
// and polluting the apply-rate metric with fake data.

import type { CoachContext, CoachReply } from './coach'

function reply(text: string, action: CoachReply['action'] = null): CoachReply {
  return { text, action, messageId: null, truncated: false, remaining: null, locked: false }
}

/**
 * Keyword-routed canned replies — one per tool, so every branch of the confirm
 * card and the executor switch can be driven from the composer. Ids and dates
 * are pulled from the REAL context pack, so the proposals point at the tester's
 * own workouts and pass `validateAction` exactly as a live reply would.
 */
export function stubReply(message: string, ctx: CoachContext): CoachReply {
  const m = message.toLowerCase()
  const next = ctx.schedule?.[0]

  // move_workout — needs a real id from the pack, so it degrades to text when
  // the tester has nothing scheduled. That degradation is itself worth seeing.
  if (/(move|shift|can'?t make|reschedule).*(it|that|session|workout|tomorrow|monday|tuesday)|move/.test(m)) {
    if (!next) return reply("You've got nothing scheduled in the next two weeks, so there's nothing for me to move.")
    const to = addDays(next.date, 1)
    return reply(
      `You've got ${next.focus} on ${next.date}. I'd push it a day to ${to} and keep the same time — that keeps the spacing between sessions honest.`,
      { name: 'move_workout', input: { workout_id: next.id, to_date: to, to_time: '' } },
    )
  }

  if (/busy|slammed|swamped|week fell apart|fix my week|re-?plan/.test(m)) {
    return reply(
      "Let's re-lay the whole week rather than shuffle one session. I'll keep every workout, just pick better days around what you've told me.",
      { name: 'reschedule_week', input: { reason: 'busy stretch', busy_days: ['tue', 'wed'] } },
    )
  }

  if (/travel|hotel|away|trip|visiting/.test(m)) {
    return reply(
      "I'll switch you to travel mode so the plan stops prescribing kit you won't have. Dumbbells and bodyweight only until you're back.",
      { name: 'start_travel_mode', input: { until: addDays(ctx.today, 7), equipment: ['dumbbells', 'bodyweight'] } },
    )
  }

  if (/hurt|pain|sore|tweak|shoulder|knee|back/.test(m)) {
    // Intentionally invalid: exercise ids aren't in the context pack yet, so
    // this is the case where a proposal must render as TEXT ONLY. Keeping a
    // deliberately-unrenderable action here is how that path gets exercised.
    return reply(
      "I'm not able to tell you what's going on with that — if it keeps up, get it looked at. What I can do is program around it. Tell me which movement aggravates it and I'll swap it out.",
      { name: 'swap_exercise', input: { exercise_id: 'not-a-real-id', exercise_name: 'Barbell Bench Press', reason: 'pain' } },
    )
  }

  if (/progress|getting stronger|improving|working/.test(m)) {
    const s = ctx.stats
    return reply(
      s
        ? `You've completed ${s.completed_4w} sessions in the last four weeks with a ${s.streak}-session streak going. That's the part that compounds — the loads follow.`
        : "I don't have enough logged sessions yet to say anything useful about your trend. Give it a couple of weeks.",
      { name: 'explain', input: { topic: 'progress' } },
    )
  }

  // Plain text — the no-action path.
  return reply(
    "[stub] No canned action for that one. Try: \"I'm slammed Tuesday and Wednesday\", \"move my next session\", \"I'm travelling next week\", \"my shoulder hurts\", or \"am I making progress?\"",
  )
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00`)
  d.setDate(d.getDate() + n)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
