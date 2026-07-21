// Coverage for lib/feedLog.ts — the Feed redesign's core fix: an item logged
// once should NOT reappear every day it stays eligible (the "same Goal ETA
// every day" complaint), but SHOULD reappear once its cooldown genuinely
// expires, and read-state must not falsely mark a fresh re-occurrence as read.

import { getFeedLog, logFeedItem, getLastReadAt, markRead, isUnread } from '@/lib/feedLog'

const USER = 'user-1'

// jest's testEnvironment is 'node' — no real localStorage global. A minimal
// in-memory stand-in, matching the Storage interface feedLog.ts reads via
// `globalThis.localStorage`.
function installFakeLocalStorage() {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
}

describe('feedLog', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  it('logs a new item', () => {
    logFeedItem(USER, { id: 'context:goal', icon: 'flag', title: 'Goal ETA', body: 'On track for 180 lbs by March.' })
    const log = getFeedLog(USER)
    expect(log).toHaveLength(1)
    expect(log[0].id).toBe('context:goal')
  })

  it('does not re-log the same id within the cooldown window', () => {
    logFeedItem(USER, { id: 'context:goal', icon: 'flag', title: 'Goal ETA', body: 'v1' }, 1000)
    logFeedItem(USER, { id: 'context:goal', icon: 'flag', title: 'Goal ETA', body: 'v2 — still eligible today' }, 1000)
    const log = getFeedLog(USER)
    expect(log).toHaveLength(1)
    expect(log[0].body).toBe('v1') // the original entry, untouched
  })

  it('re-logs the same id once the cooldown has genuinely expired', () => {
    logFeedItem(USER, { id: 'context:goal', icon: 'flag', title: 'Goal ETA', body: 'v1' }, -1) // already-expired cooldown
    logFeedItem(USER, { id: 'context:goal', icon: 'flag', title: 'Goal ETA', body: 'v2' }, -1)
    const log = getFeedLog(USER)
    expect(log).toHaveLength(1)
    expect(log[0].body).toBe('v2')
  })

  it('read-state is per-occurrence: marking read then logging a fresh occurrence is unread again', () => {
    jest.useFakeTimers().setSystemTime(1_000_000)
    logFeedItem(USER, { id: 'context:goal', icon: 'flag', title: 'Goal ETA', body: 'v1' }, -1)
    let log = getFeedLog(USER)
    markRead(USER, [log[0].id])
    expect(isUnread(log[0], getLastReadAt(USER))).toBe(false)

    // A genuinely new occurrence after the cooldown expires must count as new,
    // even though the same logical id was already marked read once before.
    jest.setSystemTime(2_000_000)
    logFeedItem(USER, { id: 'context:goal', icon: 'flag', title: 'Goal ETA', body: 'v2' }, -1)
    log = getFeedLog(USER)
    expect(isUnread(log[0], getLastReadAt(USER))).toBe(true)
    jest.useRealTimers()
  })

  it('caps the log at 80 entries', () => {
    for (let i = 0; i < 90; i++) {
      logFeedItem(USER, { id: `item-${i}`, icon: 'flag', title: `Item ${i}`, body: '' }, -1)
    }
    expect(getFeedLog(USER)).toHaveLength(80)
  })
})
