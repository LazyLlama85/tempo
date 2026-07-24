// Tempo — pendingSetLogs.ts (the offline set-log retry queue).
//
// lib/prefStorage.ts's readPref/writePref are no-ops under the Jest node
// environment (no real localStorage, and the expo-sqlite/kv-store dynamic
// import can't resolve) — mocked here to a simple in-memory Map so the
// queue/dedupe/flush logic under test actually persists between calls, the
// same way it would on-device.

const store = new Map<string, string>()
jest.mock('@/lib/prefStorage', () => ({
  readPref: jest.fn(async (key: string) => store.get(key) ?? null),
  writePref: jest.fn((key: string, value: string) => { store.set(key, value) }),
}))

import { createFakeSupabase } from './fakeSupabase'
import {
  queuePendingSetLog, clearPendingSetLog, flushPendingSetLogs, type SetLogInsert,
} from '@/lib/pendingSetLogs'

function payload(over: Partial<SetLogInsert> = {}): SetLogInsert {
  return {
    workout_log_id: 'log-1', exercise_id: 'ex-1', set_number: 1,
    reps_completed: 8, weight_lbs: 135, duration_sec: null, distance_m: null,
    rpe: null, is_warmup: false, completed_at: '2026-07-24T00:00:00.000Z',
    ...over,
  }
}

describe('pendingSetLogs', () => {
  beforeEach(() => { store.clear() })

  it('flushes a queued set on the next attempt when the server accepts it', async () => {
    await queuePendingSetLog(payload())
    const client = createFakeSupabase({ set_logs: [] })
    const result = await flushPendingSetLogs(client)
    expect(result).toEqual({ flushed: 1, remaining: 0 })
    const { data } = await client.from('set_logs').select('*')
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ workout_log_id: 'log-1', exercise_id: 'ex-1', set_number: 1 })
  })

  it('leaves a still-failing entry queued rather than dropping it', async () => {
    await queuePendingSetLog(payload())
    const client = createFakeSupabase({ set_logs: [] }, { failOps: new Set(['set_logs.insert']) })
    const result = await flushPendingSetLogs(client)
    expect(result).toEqual({ flushed: 0, remaining: 1 })
    // A second flush attempt (e.g. the next cold open) still finds it queued.
    const client2 = createFakeSupabase({ set_logs: [] })
    expect(await flushPendingSetLogs(client2)).toEqual({ flushed: 1, remaining: 0 })
  })

  it('a retry of the same set replaces its own stale queued attempt, not stacks a second one', async () => {
    await queuePendingSetLog(payload({ reps_completed: 8 }))
    await queuePendingSetLog(payload({ reps_completed: 10 })) // user edited before retrying
    const client = createFakeSupabase({ set_logs: [] })
    const result = await flushPendingSetLogs(client)
    expect(result.flushed).toBe(1) // not 2
    const { data } = await client.from('set_logs').select('*')
    expect(data).toHaveLength(1)
    expect(data[0].reps_completed).toBe(10) // the fresher attempt won
  })

  it('clearPendingSetLog removes a queued entry so a later flush cannot double-insert it', async () => {
    await queuePendingSetLog(payload())
    // Simulates the user manually tapping retry and succeeding before any flush ran.
    await clearPendingSetLog(payload())
    const client = createFakeSupabase({ set_logs: [] })
    expect(await flushPendingSetLogs(client)).toEqual({ flushed: 0, remaining: 0 })
    const { data } = await client.from('set_logs').select('*')
    expect(data).toHaveLength(0)
  })

  it('clearing an entry that was never queued is a safe no-op', async () => {
    await expect(clearPendingSetLog(payload())).resolves.toBeUndefined()
  })

  it('flushing an empty queue does nothing and never touches the client', async () => {
    const client = createFakeSupabase({ set_logs: [] })
    expect(await flushPendingSetLogs(client)).toEqual({ flushed: 0, remaining: 0 })
    const { data } = await client.from('set_logs').select('*')
    expect(data).toHaveLength(0)
  })

  it('two different sets both queue and both flush independently', async () => {
    await queuePendingSetLog(payload({ set_number: 1 }))
    await queuePendingSetLog(payload({ set_number: 2 }))
    const client = createFakeSupabase({ set_logs: [] })
    expect(await flushPendingSetLogs(client)).toEqual({ flushed: 2, remaining: 0 })
  })
})
