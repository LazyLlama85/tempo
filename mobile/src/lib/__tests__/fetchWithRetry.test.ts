// Regression cover for the App Review rejection (Guideline 2.1(a), 2026-08-14):
// "error message displayed when we completed onboarding". The reviewer's own
// request log showed every call returning 503 for ~1 minute while Postgres was
// healthy — a Supabase gateway blip — and the app turned that single failure
// straight into a user-facing error, aborting onboarding.
//
// These tests pin both halves of the fix: transient gateway failures are
// retried, and ambiguous failures on writes are NOT (a retry that re-sends a
// mutation which actually landed would be worse than the error it papers over).

import { fetchWithRetry } from '@/lib/fetchWithRetry'

const originalFetch = global.fetch

function mockFetchSequence(...responses: Array<Response | Error>) {
  const fn = jest.fn()
  for (const r of responses) {
    if (r instanceof Error) fn.mockImplementationOnce(() => Promise.reject(r))
    else fn.mockImplementationOnce(() => Promise.resolve(r))
  }
  global.fetch = fn as unknown as typeof fetch
  return fn
}

const res = (status: number) => new Response(null, { status })

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick'] }) })
afterEach(() => {
  jest.useRealTimers()
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

// The retry waits between attempts; drive the fake clock while the promise runs.
async function runAll<T>(p: Promise<T>): Promise<T> {
  await jest.runAllTimersAsync()
  return p
}

describe('fetchWithRetry', () => {
  it('retries a 503 and succeeds — the exact failure that got the app rejected', async () => {
    const fn = mockFetchSequence(res(503), res(200))
    const out = await runAll(fetchWithRetry('https://example.test/rest/v1/user_profiles', { method: 'POST' }))
    expect(out.status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries a 503 on a WRITE — a gateway 503 means the request never reached the database', async () => {
    const fn = mockFetchSequence(res(503), res(503), res(201))
    const out = await runAll(fetchWithRetry('https://example.test/rest/v1/scheduled_workouts', { method: 'POST' }))
    expect(out.status).toBe(201)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up after the attempt budget and returns the last response rather than hanging', async () => {
    const fn = mockFetchSequence(res(503), res(503), res(503))
    const out = await runAll(fetchWithRetry('https://example.test/rest/v1/user_profiles', { method: 'POST' }))
    expect(out.status).toBe(503)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a 500 — it may have partially executed', async () => {
    const fn = mockFetchSequence(res(500), res(200))
    const out = await runAll(fetchWithRetry('https://example.test/rest/v1/set_logs', { method: 'POST' }))
    expect(out.status).toBe(500)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry a 4xx — that is a real answer, not a blip', async () => {
    const fn = mockFetchSequence(res(400), res(200))
    const out = await runAll(fetchWithRetry('https://example.test/rest/v1/user_profiles'))
    expect(out.status).toBe(400)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries a dropped connection on a GET (idempotent)', async () => {
    const fn = mockFetchSequence(new TypeError('Network request failed'), res(200))
    const out = await runAll(fetchWithRetry('https://example.test/rest/v1/exercises', { method: 'GET' }))
    expect(out.status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a dropped connection on a POST — the write may already have landed', async () => {
    const fn = mockFetchSequence(new TypeError('Network request failed'), res(200))
    // No retry means no backoff sleep, so this needs no fake-timer draining —
    // awaiting it directly also keeps the rejection attached from the start.
    await expect(fetchWithRetry('https://example.test/rest/v1/set_logs', { method: 'POST' }))
      .rejects.toThrow('Network request failed')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry a 504 on a POST, but does on a GET', async () => {
    const post = mockFetchSequence(res(504), res(200))
    expect((await runAll(fetchWithRetry('https://example.test/x', { method: 'POST' }))).status).toBe(504)
    expect(post).toHaveBeenCalledTimes(1)

    const get = mockFetchSequence(res(504), res(200))
    expect((await runAll(fetchWithRetry('https://example.test/x', { method: 'GET' }))).status).toBe(200)
    expect(get).toHaveBeenCalledTimes(2)
  })
})
