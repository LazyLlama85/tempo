// Sessions should be built from movements the user actually knows.
//
// Founder, 2026-09-04: "it would also be helpful to give workouts people are
// familiar with based on what they have done, not just random things, but also
// not always the same, good to do exercises that are new if helpful."
//
// Before this, both selection engines ranked candidates purely on properties of
// the EXERCISE — muscles worked, popularity, equipment — and never once looked at
// what the person in front of them had done. The three requirements pull against
// each other, so they are tested separately: familiar-first, still varied, and a
// bounded amount of genuinely new work.

jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { createFakeSupabase } from './fakeSupabase'
import {
  buildFamiliarity, loadFamiliarity, noveltySlotIndex, byFamiliarity,
  NO_HISTORY, MIN_KNOWN_FOR_NOVELTY, MIN_PICKS_FOR_NOVELTY,
} from '@/lib/exerciseFamiliarity'

const USER = 'user-1'

describe('buildFamiliarity', () => {
  it('counts SESSIONS, not sets', () => {
    // Five sets of one lift in a single workout is one exposure to it. Counting
    // sets would let one high-volume day outrank a lift trained every week.
    const fam = buildFamiliarity([
      { exercise_id: 'squat', workout_log_id: 'log-1' },
      { exercise_id: 'squat', workout_log_id: 'log-1' },
      { exercise_id: 'squat', workout_log_id: 'log-1' },
      { exercise_id: 'squat', workout_log_id: 'log-1' },
      { exercise_id: 'squat', workout_log_id: 'log-1' },
      { exercise_id: 'bench', workout_log_id: 'log-1' },
      { exercise_id: 'bench', workout_log_id: 'log-2' },
    ])
    expect(fam.sessions('squat')).toBe(1)
    expect(fam.sessions('bench')).toBe(2)
    expect(fam.known).toBe(2)
  })

  it('reports 0 for anything never performed', () => {
    const fam = buildFamiliarity([{ exercise_id: 'squat', workout_log_id: 'log-1' }])
    expect(fam.sessions('deadlift')).toBe(0)
  })

  it('ignores rows with missing ids rather than counting a phantom exercise', () => {
    const fam = buildFamiliarity([
      { exercise_id: null, workout_log_id: 'log-1' },
      { exercise_id: 'squat', workout_log_id: null },
      { exercise_id: 'squat', workout_log_id: 'log-1' },
    ])
    expect(fam.known).toBe(1)
    expect(fam.sessions('squat')).toBe(1)
  })
})

describe('byFamiliarity', () => {
  const fam = buildFamiliarity([{ exercise_id: 'known', workout_log_id: 'log-1' }])

  it('puts a movement the user has done ahead of one they have not', () => {
    expect(byFamiliarity('known', 'unseen', fam)).toBeLessThan(0)
    expect(byFamiliarity('unseen', 'known', fam)).toBeGreaterThan(0)
  })

  it('inverts for the novelty slot', () => {
    expect(byFamiliarity('known', 'unseen', fam, true)).toBeGreaterThan(0)
  })

  it('ties two equally familiar movements so the caller keeps its own ordering', () => {
    // This is what makes the whole thing a no-op for a new user, and what stops
    // the single most-performed lift freezing into first place forever.
    expect(byFamiliarity('a', 'b', NO_HISTORY)).toBe(0)
    const both = buildFamiliarity([
      { exercise_id: 'a', workout_log_id: 'log-1' },
      { exercise_id: 'b', workout_log_id: 'log-2' },
      { exercise_id: 'b', workout_log_id: 'log-3' },
    ])
    // b has more sessions than a, but both are "known" — no ordering imposed.
    expect(byFamiliarity('a', 'b', both)).toBe(0)
  })
})

describe('noveltySlotIndex', () => {
  const experienced = buildFamiliarity(
    Array.from({ length: MIN_KNOWN_FOR_NOVELTY }, (_, i) => ({
      exercise_id: `ex-${i}`, workout_log_id: `log-${i}`,
    })),
  )

  it('spends the LAST slot on something new, not the first', () => {
    // A new movement belongs after the work that matters, never in the primary
    // position where the user is strongest and most invested.
    expect(noveltySlotIndex(experienced, 6)).toBe(5)
  })

  it('leaves a beginner alone — everything is already new to them', () => {
    const beginner = buildFamiliarity([
      { exercise_id: 'a', workout_log_id: 'log-1' },
      { exercise_id: 'b', workout_log_id: 'log-1' },
    ])
    expect(noveltySlotIndex(beginner, 6)).toBeNull()
    expect(noveltySlotIndex(NO_HISTORY, 6)).toBeNull()
  })

  it('will not spend a slot a short session cannot spare', () => {
    expect(noveltySlotIndex(experienced, MIN_PICKS_FOR_NOVELTY - 1)).toBeNull()
    expect(noveltySlotIndex(experienced, MIN_PICKS_FOR_NOVELTY)).toBe(MIN_PICKS_FOR_NOVELTY - 1)
  })

  it('never claims more than one slot, however long the session', () => {
    for (const total of [4, 6, 8, 12]) {
      expect(noveltySlotIndex(experienced, total)).toBe(total - 1)
    }
  })
})

describe('loadFamiliarity', () => {
  it('reads the user’s own performed sets', async () => {
    const client = createFakeSupabase({
      workout_logs: [
        { id: 'log-1', user_id: USER, completed_at: new Date().toISOString() },
        { id: 'log-2', user_id: 'someone-else', completed_at: new Date().toISOString() },
      ],
      set_logs: [
        { workout_log_id: 'log-1', exercise_id: 'squat', is_warmup: false },
        { workout_log_id: 'log-2', exercise_id: 'bench', is_warmup: false },
      ],
    })

    const fam = await loadFamiliarity(client, USER)

    expect(fam.sessions('squat')).toBe(1)
    // Another user's training is not this user's familiarity.
    expect(fam.sessions('bench')).toBe(0)
  })

  it('does not count warm-up sets as knowing a movement', async () => {
    const client = createFakeSupabase({
      workout_logs: [{ id: 'log-1', user_id: USER, completed_at: new Date().toISOString() }],
      set_logs: [
        { workout_log_id: 'log-1', exercise_id: 'squat', is_warmup: true },
        { workout_log_id: 'log-1', exercise_id: 'bench', is_warmup: false },
      ],
    })

    const fam = await loadFamiliarity(client, USER)

    expect(fam.sessions('squat')).toBe(0)
    expect(fam.sessions('bench')).toBe(1)
  })

  it('returns no history for someone who has never logged anything', async () => {
    const client = createFakeSupabase({ workout_logs: [], set_logs: [] })
    const fam = await loadFamiliarity(client, USER)
    expect(fam.known).toBe(0)
  })

  it('degrades to no-history rather than breaking generation when the read fails', async () => {
    // Plan generation must never fail because a personalisation input was
    // unavailable — the worst acceptable outcome is the old, unpersonalised order.
    const client = createFakeSupabase(
      { workout_logs: [], set_logs: [] },
      { failOps: new Set(['workout_logs.select']) },
    )
    const fam = await loadFamiliarity(client, USER)
    expect(fam.known).toBe(0)
  })
})
