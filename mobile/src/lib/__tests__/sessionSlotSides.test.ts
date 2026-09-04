// A session must never borrow from the opposite side of the body.
//
// Production, 2026-09-03: a founder report said a Push day came back "mostly good
// but had pull exercises". The plan's PUSH_DAY template asks only for push slots,
// so the crossing happened in FALLBACK. Barbell-only users have an empty
// `lat_raise` pool (every lateral raise in the core library needs cables or
// dumbbells), so the Push day walked the `lat_raise -> rear_delt` affinity edge,
// found rear_delt empty too, dropped to the full library and programmed
// "Barbell Rear Delt Row" — a rowing movement — onto a Push day. Four such rows
// existed in the live scheduled_workouts table.

import {
  slotSide, sideAllows, classifyExercise,
  PUSH_COMPOUND_SLOTS, PUSH_ISO_SLOTS, PULL_COMPOUND_SLOTS, PULL_ISO_SLOTS,
  LOWER_COMPOUND_SLOTS, LOWER_ISO_SLOTS,
} from '@/lib/exerciseProgramming'

describe('slotSide', () => {
  it('puts every push slot on the push side', () => {
    for (const s of [...PUSH_COMPOUND_SLOTS, ...PUSH_ISO_SLOTS]) expect(slotSide(s)).toBe('push')
  })

  it('puts every pull slot on the pull side', () => {
    for (const s of [...PULL_COMPOUND_SLOTS, ...PULL_ISO_SLOTS]) expect(slotSide(s)).toBe('pull')
  })

  it('puts every lower slot on the lower side', () => {
    for (const s of [...LOWER_COMPOUND_SLOTS, ...LOWER_ISO_SLOTS]) expect(slotSide(s)).toBe('lower')
  })

  it('leaves core, cardio and carry side-less so they pair with anything', () => {
    for (const s of ['core', 'cardio', 'carry'] as const) expect(slotSide(s)).toBe('neutral')
  })
})

describe('sideAllows', () => {
  it('refuses the exact edge that caused the bug (push day -> rear_delt)', () => {
    expect(sideAllows('push', 'rear_delt')).toBe(false)
    expect(sideAllows('push', 'h_pull')).toBe(false)
    expect(sideAllows('push', 'v_pull')).toBe(false)
    expect(sideAllows('push', 'biceps')).toBe(false)
  })

  it('still lets a push day widen into another press', () => {
    expect(sideAllows('push', 'v_push')).toBe(true)
    expect(sideAllows('push', 'h_push')).toBe(true)
    expect(sideAllows('push', 'chest_iso')).toBe(true)
    expect(sideAllows('push', 'triceps')).toBe(true)
  })

  it('keeps a pull day off push work', () => {
    for (const s of [...PUSH_COMPOUND_SLOTS, ...PUSH_ISO_SLOTS]) expect(sideAllows('pull', s)).toBe(false)
    for (const s of [...PULL_COMPOUND_SLOTS, ...PULL_ISO_SLOTS]) expect(sideAllows('pull', s)).toBe(true)
  })

  it('keeps a leg day off upper-body work, and vice versa', () => {
    expect(sideAllows('lower', 'h_push')).toBe(false)
    expect(sideAllows('lower', 'h_pull')).toBe(false)
    expect(sideAllows('push', 'squat')).toBe(false)
    expect(sideAllows('pull', 'hinge')).toBe(false)
  })

  it('lets a mixed day (Upper, Full Body) use both sides', () => {
    for (const s of ['h_push', 'h_pull', 'squat', 'biceps', 'core'] as const) {
      expect(sideAllows('mixed', s)).toBe(true)
    }
  })

  it('always allows the side-less slots', () => {
    for (const side of ['push', 'pull', 'lower'] as const) {
      for (const s of ['core', 'cardio', 'carry'] as const) expect(sideAllows(side, s)).toBe(true)
    }
  })
})

// The movements actually named in the report, plus the one the DB really held.
describe('the reported exercises are classified as pull, and so are barred from a push day', () => {
  const rows = [
    { name: 'Pull-Up', movement_pattern: 'pull', primary_muscles: ['lats'] },
    { name: 'Lat Pulldown', movement_pattern: 'pull', primary_muscles: ['lats'] },
    { name: 'Assisted Pull-Up (Machine)', movement_pattern: 'pull', primary_muscles: ['lats'] },
    { name: 'Cable Pulldown', movement_pattern: 'pull', primary_muscles: ['lats'] },
    { name: 'Barbell Rear Delt Row', movement_pattern: 'pull', primary_muscles: ['rear_delts'] },
    { name: 'Barbell Rear Delt Raise', movement_pattern: 'pull', primary_muscles: ['rear_delts'] },
  ]

  it.each(rows)('$name never lands on a push day', (row) => {
    const { slot } = classifyExercise(row as never)
    expect(slotSide(slot)).toBe('pull')
    expect(sideAllows('push', slot)).toBe(false)
  })
})
