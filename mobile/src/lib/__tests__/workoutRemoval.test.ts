// Removing a workout should mean what the workout is.
//
// Founder, 2026-09-04: "shouldn't there be a skip for today vs delete forever
// and similar stuff if it's a quick workout or similar type of edge cases."
//
// Until this, every removal path set `status = 'skipped'` — Home's "Skip it" and
// EditWorkoutSheet's "Remove" were the same write under two different words. For
// a Quick Workout that is simply wrong: it is a one-off the user invented, it
// recurs never, and marking it "skipped" records a failure that did not happen
// and leaves a permanent ghost in their history. Production had 10 such rows, and
// `useProgressStats` already filtered `source === 'quick' && skipped` back out —
// a workaround for exactly this gap.

import { createFakeSupabase } from './fakeSupabase'

jest.mock('@/services/calendarSync', () => ({ removeWorkoutFromCalendar: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/notifications', () => ({ cancelWorkoutReminder: jest.fn().mockResolvedValue(undefined) }))

import { removeWorkoutFromCalendar } from '@/services/calendarSync'
import { cancelWorkoutReminder } from '@/lib/notifications'
import { isOneOff, removalModeFor, removalCopy, applyRemoval } from '@/lib/workoutRemoval'

const USER = 'user-1'

function row(id: string, source: string | null, extra: Record<string, unknown> = {}) {
  return {
    id, user_id: USER, source, focus: 'Push Day', status: 'scheduled',
    calendar_event_id: null, calendar_provider: null, ...extra,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('removalModeFor', () => {
  it('deletes the one-offs the user created themselves', () => {
    expect(isOneOff('quick')).toBe(true)
    expect(isOneOff('custom')).toBe(true)
    expect(removalModeFor('quick')).toBe('delete')
    expect(removalModeFor('custom')).toBe('delete')
  })

  it('skips anything that is one occurrence of a recurring programme', () => {
    expect(removalModeFor('plan')).toBe('skip')
    expect(removalModeFor('split')).toBe('skip')
  })

  it('falls back to skip for an unknown or missing source', () => {
    // Skip is the conservative outcome: the row survives and can be reasoned
    // about later. A delete cannot be undone, so it is never the default.
    expect(removalModeFor(null)).toBe('skip')
    expect(removalModeFor(undefined)).toBe('skip')
    expect(removalModeFor('smart')).toBe('skip')
  })
})

describe('removalCopy', () => {
  it('promises deletion, not skipping, for a one-off', () => {
    const c = removalCopy('delete', 'Quick · Legs')
    expect(c.title).toContain('Delete')
    expect(c.actionLabel).toBe('Delete it')
    expect(c.subtitle).toContain("won't count as a missed session")
  })

  it('says next week is unaffected when skipping a plan session', () => {
    const c = removalCopy('skip', 'Push Day')
    expect(c.title).toContain('Skip')
    expect(c.subtitle).toContain("Next week's session isn't affected")
  })

  it('never produces a dangling name when focus is empty', () => {
    expect(removalCopy('skip', '   ').title).toBe('Skip this workout?')
  })
})

describe('applyRemoval', () => {
  it('a Quick Workout is really gone, not marked skipped', async () => {
    const tables = { scheduled_workouts: [row('w1', 'quick')] }
    const client = createFakeSupabase(tables)

    const outcome = await applyRemoval(client, USER, { id: 'w1', source: 'quick' }, 'delete')

    expect(outcome).toBe('deleted')
    expect(tables.scheduled_workouts).toHaveLength(0)
  })

  it('a plan session is marked skipped and keeps its row', async () => {
    const tables = { scheduled_workouts: [row('w1', 'plan')] }
    const client = createFakeSupabase(tables)

    const outcome = await applyRemoval(client, USER, { id: 'w1', source: 'plan' }, 'skip')

    expect(outcome).toBe('skipped')
    expect(tables.scheduled_workouts).toHaveLength(1)
    expect(tables.scheduled_workouts[0].status).toBe('skipped')
  })

  it('falls back to skipping when a started session cannot be deleted', async () => {
    // workout_logs.scheduled_workout_id is ON DELETE NO ACTION, so deleting a
    // session someone already logged sets against fails with 23503. The logged
    // work must survive, so this degrades to a skip rather than erroring at the
    // user or destroying their sets.
    const tables = { scheduled_workouts: [row('w1', 'quick')] }
    const client = createFakeSupabase(tables, {
      failOpCodes: { 'scheduled_workouts.delete': '23503' },
    })

    const outcome = await applyRemoval(client, USER, { id: 'w1', source: 'quick' }, 'delete')

    expect(outcome).toBe('skipped')
    expect(tables.scheduled_workouts).toHaveLength(1)
    expect(tables.scheduled_workouts[0].status).toBe('skipped')
  })

  it('surfaces a delete failure that is NOT the foreign key case', async () => {
    const tables = { scheduled_workouts: [row('w1', 'quick')] }
    const client = createFakeSupabase(tables, {
      failOpCodes: { 'scheduled_workouts.delete': '42501' },
    })

    await expect(
      applyRemoval(client, USER, { id: 'w1', source: 'quick' }, 'delete'),
    ).rejects.toMatchObject({ code: '42501' })
    // Nothing silently became "skipped" behind a real failure.
    expect(tables.scheduled_workouts[0].status).toBe('scheduled')
  })

  it('clears the calendar event and the reminder either way', async () => {
    const tables = { scheduled_workouts: [row('w1', 'quick', { calendar_event_id: 'evt-1' })] }
    const client = createFakeSupabase(tables)

    await applyRemoval(
      client, USER,
      { id: 'w1', source: 'quick', calendar_event_id: 'evt-1', calendar_provider: 'google' },
      'delete',
    )

    expect(removeWorkoutFromCalendar).toHaveBeenCalledTimes(1)
    expect(cancelWorkoutReminder).toHaveBeenCalledWith('w1')
  })

  it('does not touch the calendar when there is no event to remove', async () => {
    const tables = { scheduled_workouts: [row('w1', 'plan')] }
    const client = createFakeSupabase(tables)

    await applyRemoval(client, USER, { id: 'w1', source: 'plan' }, 'skip')

    expect(removeWorkoutFromCalendar).not.toHaveBeenCalled()
    expect(cancelWorkoutReminder).toHaveBeenCalledWith('w1')
  })

  it('only ever removes the caller’s own workout', async () => {
    const tables = {
      scheduled_workouts: [row('w1', 'quick'), { ...row('w2', 'quick'), user_id: 'someone-else' }],
    }
    const client = createFakeSupabase(tables)

    await applyRemoval(client, USER, { id: 'w2', source: 'quick' }, 'delete')

    // The other user's row is untouched: the query is scoped by user_id.
    expect(tables.scheduled_workouts.some(r => r.id === 'w2')).toBe(true)
  })
})
