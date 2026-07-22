import {
  buildCoachContext, describeAction, actionCta, COACH_HORIZON_DAYS,
  type CoachContextInput,
} from '@/lib/coach'
import type { ScheduledWorkout, UserProfile } from '@/types'

const TODAY = '2026-07-20' // a Monday

function workout(over: Partial<ScheduledWorkout> & { id: string; planned_date: string }): ScheduledWorkout {
  return {
    user_plan_id: null,
    user_id: 'u1',
    planned_start_time: '18:00:00',
    planned_duration_min: 45,
    focus: 'Upper',
    calendar_event_id: null,
    calendar_provider: null,
    status: 'scheduled',
    completed_at: null,
    ...over,
  } as ScheduledWorkout
}

const PROFILE = {
  user_id: 'u1',
  goal: 'muscle_gain',
  experience: 'intermediate',
  equipment: ['dumbbells', 'barbell'],
  days_per_week: 4,
  preferred_duration_min: 45,
  injuries: null,
} as unknown as UserProfile

function input(over: Partial<CoachContextInput> = {}): CoachContextInput {
  return {
    today: TODAY,
    profile: PROFILE,
    upcoming: [],
    history: [],
    measurements: [],
    recentPRs: [],
    travel: null,
    feedback: [],
    ...over,
  }
}

describe('buildCoachContext', () => {
  it('is deterministic — same input produces byte-identical JSON', () => {
    // Guards the prompt-prefix stability the Edge Function depends on: a context
    // pack whose key order wobbles would silently defeat any future caching and
    // make two identical requests look different.
    const a = JSON.stringify(buildCoachContext(input()))
    const b = JSON.stringify(buildCoachContext(input()))
    expect(a).toBe(b)
  })

  it('sorts equipment and injuries so ordering never varies by row order', () => {
    const ctx = buildCoachContext(input({
      profile: { ...PROFILE, equipment: ['kettlebell', 'barbell', 'dumbbells'], injuries: ['shoulder', 'knee'] } as UserProfile,
    }))
    expect(ctx.profile?.equipment).toEqual(['barbell', 'dumbbells', 'kettlebell'])
    expect(ctx.profile?.injuries).toEqual(['knee', 'shoulder'])
  })

  it('omits absent data instead of sending nulls', () => {
    const ctx = buildCoachContext(input({ profile: null }))
    expect(ctx.today).toBe(TODAY)
    expect('profile' in ctx).toBe(false)
    expect('schedule' in ctx).toBe(false)
    expect('stats' in ctx).toBe(false)
    expect('weight' in ctx).toBe(false)
    expect('travel' in ctx).toBe(false)
    // A null would invite the model to comment on missing data; omission doesn't.
    expect(JSON.stringify(ctx)).not.toContain('null')
  })

  it('omits injuries entirely when the list is empty', () => {
    const ctx = buildCoachContext(input({ profile: { ...PROFILE, injuries: [] } as UserProfile }))
    expect(ctx.profile).toBeDefined()
    expect('injuries' in (ctx.profile ?? {})).toBe(false)
  })

  it('includes only sessions inside the horizon, sorted by date then time', () => {
    const ctx = buildCoachContext(input({
      upcoming: [
        workout({ id: 'c', planned_date: '2026-07-22', planned_start_time: '07:00:00' }),
        workout({ id: 'a', planned_date: '2026-07-20', planned_start_time: '18:00:00' }),
        workout({ id: 'b', planned_date: '2026-07-20', planned_start_time: '07:00:00' }),
        workout({ id: 'past', planned_date: '2026-07-19' }),          // before today
        workout({ id: 'far', planned_date: '2026-09-01' }),           // past the horizon
      ],
    }))
    expect(ctx.schedule?.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('trims seconds off session times', () => {
    const ctx = buildCoachContext(input({
      upcoming: [workout({ id: 'a', planned_date: TODAY, planned_start_time: '18:30:00' })],
    }))
    expect(ctx.schedule?.[0].time).toBe('18:30')
  })

  it('keeps the horizon at exactly COACH_HORIZON_DAYS inclusive', () => {
    const lastDay = '2026-08-03' // TODAY + 14
    const ctx = buildCoachContext(input({
      upcoming: [
        workout({ id: 'edge', planned_date: lastDay }),
        workout({ id: 'over', planned_date: '2026-08-04' }),
      ],
    }))
    expect(COACH_HORIZON_DAYS).toBe(14)
    expect(ctx.schedule?.map((s) => s.id)).toEqual(['edge'])
  })

  it('summarizes training history into completion counts and a streak', () => {
    const ctx = buildCoachContext(input({
      history: [
        { planned_date: '2026-07-18', status: 'completed' },
        { planned_date: '2026-07-17', status: 'completed' },
        { planned_date: '2026-07-15', status: 'missed' },
      ],
    }))
    expect(ctx.stats?.completed_4w).toBe(2)
    expect(ctx.stats?.missed_4w).toBe(1)
    expect(typeof ctx.stats?.tempo_score).toBe('number')
  })

  it('reports weight as a direction and rate, never a series', () => {
    const m = (measured_at: string, weight_lbs: number) => ({
      id: measured_at, user_id: 'u1', weight_lbs, body_fat_pct: null, waist_in: null,
      photo_url: null, note: null, measured_at, created_at: measured_at,
    })
    const ctx = buildCoachContext(input({
      // Newest first, matching the fetch order.
      measurements: [
        m(new Date().toISOString(), 180),
        m(new Date(Date.now() - 14 * 86_400_000).toISOString(), 184),
      ],
    }))
    expect(ctx.weight?.latest_lb).toBe(180)
    expect(typeof ctx.weight?.lb_per_week).toBe('number')
  })

  it('caps PRs and feedback so the pack cannot grow unbounded', () => {
    const ctx = buildCoachContext(input({
      recentPRs: [
        { name: 'Bench', weight: 225, date: '2026-07-18' },
        { name: 'Squat', weight: 315, date: '2026-07-17' },
        { name: 'Row', weight: 185, date: '2026-07-16' },
        { name: 'OHP', weight: 135, date: '2026-07-15' },
      ],
      feedback: ['too_easy', 'just_right', 'too_hard', 'just_right'],
    }))
    expect(ctx.prs).toHaveLength(3)
    expect(ctx.feedback).toHaveLength(3)
    // Feedback keeps the MOST RECENT three, not the first three.
    expect(ctx.feedback?.[2]).toBe('just_right')
  })

  it('carries travel mode with sorted equipment', () => {
    const ctx = buildCoachContext(input({
      travel: { until: '2026-07-27', equipment: ['dumbbells', 'bodyweight'] } as never,
    }))
    expect(ctx.travel).toEqual({ until: '2026-07-27', equipment: ['bodyweight', 'dumbbells'] })
  })
})

describe('describeAction', () => {
  it('names the busy days in a reschedule proposal', () => {
    expect(describeAction({ name: 'reschedule_week', input: { reason: 'work', busy_days: ['tue', 'wed'] } }))
      .toBe('Re-plan your week around Tuesday and Wednesday')
  })

  it('handles three or more days with an Oxford-free list', () => {
    expect(describeAction({ name: 'reschedule_week', input: { reason: 'x', busy_days: ['mon', 'tue', 'wed'] } }))
      .toBe('Re-plan your week around Monday, Tuesday and Wednesday')
  })

  it('falls back cleanly when no days were named', () => {
    expect(describeAction({ name: 'reschedule_week', input: { reason: 'x', busy_days: [] } }))
      .toBe('Re-plan your upcoming week')
  })

  it('includes the time on a move only when one was given', () => {
    expect(describeAction({ name: 'move_workout', input: { workout_id: 'a', to_date: '2026-07-23', to_time: '07:00' } }))
      .toContain('at 07:00')
    expect(describeAction({ name: 'move_workout', input: { workout_id: 'a', to_date: '2026-07-23', to_time: '' } }))
      .not.toContain('at ')
  })

  it('uses the exercise name in a swap', () => {
    expect(describeAction({ name: 'swap_exercise', input: { exercise_id: 'e1', exercise_name: 'Overhead Press', reason: 'pain' } }))
      .toBe('Swap Overhead Press for an alternative')
  })

  it('never returns an empty string, for any tool or a malformed one', () => {
    // This is the fallback shown when the model returns a tool call with no text
    // block — an empty bubble on the purchase-driving surface is not acceptable.
    const actions = [
      { name: 'reschedule_week', input: {} },
      { name: 'move_workout', input: {} },
      { name: 'swap_exercise', input: {} },
      { name: 'start_travel_mode', input: {} },
      { name: 'explain', input: {} },
      { name: 'something_unknown', input: {} },
    ]
    for (const a of actions) {
      expect(describeAction(a).length).toBeGreaterThan(0)
      expect(actionCta(a).length).toBeGreaterThan(0)
    }
  })
})
