// Tempo — Tempo Coach action layer (batch C4).
//
// These tests cover the ONE thing that stands between a hallucinated tool call
// and a bad write to the training plan: validateAction. `strict: true` on the
// tool schema guarantees the model's arguments are well-typed; it guarantees
// nothing about whether they point at anything real. Everything asserted here
// is a case where a well-formed proposal must still be refused.
//
// The executors themselves aren't unit-tested — they are thin routers over
// lib functions (rescheduleWholeWeek, rescheduleWorkout, saveSubstitution,
// saveTravelMode) that already have their own coverage, and testing them here
// would mostly assert that Supabase mocks were called.

import { actionGate, busyDays, explainRoute, validateAction } from '@/lib/coachActions'
import type { CoachAction, CoachContext } from '@/lib/coach'

const TODAY = '2026-07-20'

const CTX: CoachContext = {
  today: TODAY,
  schedule: [
    { id: 'w1', date: '2026-07-21', time: '18:00', focus: 'Upper', status: 'scheduled' },
    { id: 'w2', date: '2026-07-23', time: '07:00', focus: 'Lower', status: 'scheduled' },
  ],
}

const act = (name: string, input: Record<string, unknown>): CoachAction => ({ name, input })

describe('validateAction — move_workout', () => {
  it('accepts a workout id that was in the context pack', () => {
    expect(validateAction(act('move_workout', {
      workout_id: 'w1', to_date: '2026-07-22', to_time: '18:00',
    }), CTX).valid).toBe(true)
  })

  it('REJECTS an id the model invented', () => {
    // The single most important assertion in this file. The model only ever
    // sees the ids we send it; anything else is fabricated, and a card offering
    // to move a session that does not exist is worse than no card at all.
    const r = validateAction(act('move_workout', {
      workout_id: 'totally-made-up', to_date: '2026-07-22', to_time: '',
    }), CTX)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/not in context/)
  })

  it('rejects a date in the past', () => {
    expect(validateAction(act('move_workout', {
      workout_id: 'w1', to_date: '2026-07-19', to_time: '',
    }), CTX).valid).toBe(false)
  })

  it('rejects a date that is well-formed but does not exist', () => {
    // 2026-02-31 passes a naive regex and rolls over to March in Date().
    expect(validateAction(act('move_workout', {
      workout_id: 'w1', to_date: '2026-02-31', to_time: '',
    }), CTX).valid).toBe(false)
  })

  it('accepts an empty to_time (keep the current slot) but rejects a malformed one', () => {
    expect(validateAction(act('move_workout', { workout_id: 'w1', to_date: '2026-07-22', to_time: '' }), CTX).valid).toBe(true)
    expect(validateAction(act('move_workout', { workout_id: 'w1', to_date: '2026-07-22', to_time: '6pm' }), CTX).valid).toBe(false)
  })

  it('rejects when there is no context at all', () => {
    expect(validateAction(act('move_workout', {
      workout_id: 'w1', to_date: '2026-07-22', to_time: '',
    }), null).valid).toBe(false)
  })
})

describe('validateAction — start_travel_mode', () => {
  it('accepts known equipment values', () => {
    expect(validateAction(act('start_travel_mode', {
      until: '2026-07-27', equipment: ['dumbbells', 'bodyweight'],
    }), CTX).valid).toBe(true)
  })

  it('rejects equipment outside the Equipment union', () => {
    // Would otherwise be written straight into user_profiles.travel_mode and
    // silently break exercise selection for the whole trip.
    const r = validateAction(act('start_travel_mode', {
      until: '2026-07-27', equipment: ['dumbbells', 'smith_machine'],
    }), CTX)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/equipment/)
  })

  it('rejects an empty equipment list and a past end date', () => {
    expect(validateAction(act('start_travel_mode', { until: '2026-07-27', equipment: [] }), CTX).valid).toBe(false)
    expect(validateAction(act('start_travel_mode', { until: '2026-07-01', equipment: ['dumbbells'] }), CTX).valid).toBe(false)
  })
})

describe('validateAction — explain, reschedule_week, unknown tools', () => {
  it('accepts the four known explain topics and rejects anything else', () => {
    for (const topic of ['plan', 'progress', 'deload', 'session']) {
      expect(validateAction(act('explain', { topic }), CTX).valid).toBe(true)
    }
    expect(validateAction(act('explain', { topic: 'nutrition' }), CTX).valid).toBe(false)
  })

  it('accepts reschedule_week with a reason, regardless of busy_days', () => {
    expect(validateAction(act('reschedule_week', { reason: 'work travel', busy_days: [] }), CTX).valid).toBe(true)
    expect(validateAction(act('reschedule_week', { busy_days: ['tue'] }), CTX).valid).toBe(false)
  })

  it('rejects a tool name that is not in the surface', () => {
    // Guards against a future prompt/tool drift shipping a card for something
    // the executor switch has no branch for.
    expect(validateAction(act('delete_everything', {}), CTX).valid).toBe(false)
  })
})

describe('busyDays / explainRoute / actionGate', () => {
  it('drops day keys it does not recognise instead of failing the action', () => {
    expect(busyDays(act('reschedule_week', { reason: 'x', busy_days: ['tue', 'funday', 'wed'] })))
      .toEqual(['tue', 'wed'])
    expect(busyDays(act('reschedule_week', { reason: 'x' }))).toEqual([])
  })

  it('routes each explain topic somewhere real', () => {
    expect(explainRoute(act('explain', { topic: 'progress' }))).toBe('/(tabs)/progress')
    expect(explainRoute(act('explain', { topic: 'deload' }))).toBe('/plan-explainer')
    expect(explainRoute(act('explain', { topic: 'session' }))).toBe('/(tabs)/plan')
  })

  it('gates only the whole-week re-plan, matching the Plan tab', () => {
    // If this ever returns null for reschedule_week, the Coach has become a
    // free side door around a paywall the rest of the app enforces.
    expect(actionGate(act('reschedule_week', { reason: 'x' }))).toBe('schedule_optimization')
    expect(actionGate(act('move_workout', {}))).toBeNull()
    expect(actionGate(act('start_travel_mode', {}))).toBeNull()
  })
})
