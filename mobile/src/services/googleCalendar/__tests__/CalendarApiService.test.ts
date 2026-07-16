// Regression coverage (B5.5) for the third named "recurring near-catastrophic
// bug class" (audit §4.2/§11.2): "silent Google vanish" — getCalendarEventsForRange
// used to swallow every read failure to `[]`, so a revoked token, a disabled API,
// or a missing scope all looked identical to "no events" from the user's side,
// with nothing to diagnose. describeReadError (tested here via the public
// fetchUserBusySlots + getLastCalendarReadError surface) is what replaced that
// silence with a real, categorized reason + fix hint.

import { fetchUserBusySlots } from '../CalendarApiService'
import { getLastCalendarReadError } from '../CalendarApiService'
import { captureApiError } from '@/lib/crashReporting'

jest.mock('../CalendarAuthService', () => ({
  getGoogleAccessToken: jest.fn().mockResolvedValue('fake-token'),
  invalidateGoogleAccessToken: jest.fn(),
}))
jest.mock('@/lib/crashReporting', () => ({
  captureApiError: jest.fn(),
}))

const { getGoogleAccessToken, invalidateGoogleAccessToken } = jest.requireMock('../CalendarAuthService')

function fakeResponse(status: number, body: any): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe('CalendarApiService — Google read-failure diagnosis (not silence)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getGoogleAccessToken as jest.Mock).mockResolvedValue('fake-token')
    global.fetch = jest.fn() as any
  })

  it('a healthy response resolves normally with no recorded error', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(fakeResponse(200, { items: [] }))
    await expect(fetchUserBusySlots(7)).resolves.toEqual([])
  })

  it('SERVICE_DISABLED / accessNotConfigured → the "enable the API" hint', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      fakeResponse(403, { error: { status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }] } }),
    )
    await expect(fetchUserBusySlots(7)).rejects.toThrow(/gcal_fetch_failed_403_accessNotConfigured/)
    expect(getLastCalendarReadError()).toEqual({ status: 403, reason: 'accessNotConfigured' })
    expect(captureApiError).toHaveBeenCalledWith(
      'gcal_read', expect.any(Error),
      expect.objectContaining({ hint: expect.stringMatching(/Enable "Google Calendar API"/) }),
    )
  })

  it('a scope/insufficient reason → the "reconnect with the right scope" hint', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      fakeResponse(403, { error: { errors: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }),
    )
    await expect(fetchUserBusySlots(7)).rejects.toThrow()
    expect(captureApiError).toHaveBeenCalledWith(
      'gcal_read', expect.any(Error),
      expect.objectContaining({ hint: expect.stringMatching(/calendar\.events scope/) }),
    )
  })

  it('a forbidden/PERMISSION_DENIED-only reason → the permission hint', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      fakeResponse(403, { error: { errors: [{ reason: 'forbidden' }] } }),
    )
    await expect(fetchUserBusySlots(7)).rejects.toThrow()
    expect(captureApiError).toHaveBeenCalledWith(
      'gcal_read', expect.any(Error),
      expect.objectContaining({ hint: expect.stringMatching(/permission denied/) }),
    )
  })

  it('an unrecognized reason is still recorded (status + reason), with no invented hint', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(fakeResponse(500, { error: { message: 'backendError' } }))
    await expect(fetchUserBusySlots(7)).rejects.toThrow()
    expect(getLastCalendarReadError()).toEqual({ status: 500, reason: 'backendError' })
    expect(captureApiError).toHaveBeenCalledWith(
      'gcal_read', expect.any(Error),
      expect.objectContaining({ hint: undefined }),
    )
  })

  it('a non-JSON error body still records the raw HTTP status rather than throwing past it', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, json: async () => { throw new Error('not json') } } as any)
    await expect(fetchUserBusySlots(7)).rejects.toThrow(/gcal_fetch_failed_503_http_503/)
    expect(getLastCalendarReadError()).toEqual({ status: 503, reason: 'http_503' })
  })

  it('retries once on a 401 with a freshly-minted token (cached token revoked / clock skew)', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse(401, {}))
      .mockResolvedValueOnce(fakeResponse(200, { items: [] }))
    ;(getGoogleAccessToken as jest.Mock)
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token')

    await expect(fetchUserBusySlots(7)).resolves.toEqual([])
    expect(invalidateGoogleAccessToken).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('never calls fetch at all when there is no token to attach (not_connected)', async () => {
    ;(getGoogleAccessToken as jest.Mock).mockResolvedValue(null)
    await expect(fetchUserBusySlots(7)).rejects.toThrow('not_connected')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
