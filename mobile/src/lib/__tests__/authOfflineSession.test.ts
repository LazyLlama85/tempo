// Regression cover for the founder-reported cluster (2026-08-14):
//   • airplane mode dumps you on the sign-in screen
//   • a brief flash of sign-in on a normal (slow) cold open
//   • "everything looks like it's loading but never loads"
//
// One root cause behind all three. supabase auth-js's `getSession()` returns
// `{ session: null, error }` when the access token had expired and the REFRESH
// call failed — i.e. "couldn't verify", not "signed out". auth-js keeps the
// stored session in that case (it only erases it on non-retryable errors). The
// store read only `session`, saw null, and cleared everything — which sent the
// user to /sign-in and, because every screen's queries are `enabled: !!userId`,
// left them pending forever behind skeletons that could never resolve.
//
// A second door onto the same trap: `onAuthStateChange` fires INITIAL_SESSION
// with a null session in that same offline case, so clearing on any null session
// re-broke it moments after the first fix preserved it.

const mockGetSession = jest.fn()
const mockOnAuthStateChange = jest.fn()

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      onAuthStateChange: (...a: unknown[]) => mockOnAuthStateChange(...a),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    },
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    })),
  },
}))
jest.mock('@/lib/analytics', () => ({ identifyUser: jest.fn(), resetUser: jest.fn(), track: jest.fn() }))
jest.mock('@/lib/crashReporting', () => ({ setCrashUser: jest.fn(), captureException: jest.fn(), captureApiError: jest.fn() }))
jest.mock('@/lib/pushTokens', () => ({ registerPushToken: jest.fn(() => Promise.resolve()), unregisterPushToken: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/social', () => ({ syncSocialOnOpen: jest.fn(() => Promise.resolve()) }))

const USER_ID = 'user-abc'
const PROJECT_URL = 'https://testref.supabase.co'
const AUTH_KEY = 'sb-testref-auth-token'

const storedSession = {
  access_token: 'stored-access-token',
  refresh_token: 'stored-refresh-token',
  user: { id: USER_ID },
}
const cachedProfile = { user_id: USER_ID, onboarding_complete: true, goal: 'strength' }

function installStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

// A device that has signed in before: supabase's persisted session + our own
// last-known-good profile cache.
function installSignedInDevice() {
  installStorage({
    [AUTH_KEY]: JSON.stringify(storedSession),
    [`tempo.profile.${USER_ID}`]: JSON.stringify(cachedProfile),
  })
}

async function freshStore() {
  jest.resetModules()
  process.env.EXPO_PUBLIC_SUPABASE_URL = PROJECT_URL
  const mod = await import('@/stores/auth')
  return mod.useAuthStore
}

const flush = () => new Promise<void>(r => setImmediate(r))

beforeEach(() => {
  jest.clearAllMocks()
  // initialize() arms a 5s cold-start safety timer. Fake timers keep it from
  // holding the Jest process open in the cases where getSession never settles.
  // setImmediate stays real so `flush()` still drains microtasks normally.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  mockOnAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }))
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('auth store — offline / unverifiable session', () => {
  it('keeps the user signed in when the token refresh fails (airplane mode)', async () => {
    installSignedInDevice()
    // Exactly what auth-js returns when the refresh call can't reach the server.
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', message: 'Network request failed' },
    })

    const useAuthStore = await freshStore()
    useAuthStore.getState().initialize()
    await flush()

    const s = useAuthStore.getState()
    expect(s.session?.user.id).toBe(USER_ID)   // was null before the fix → /sign-in
    expect(s.profile?.onboarding_complete).toBe(true)
    expect(s.loading).toBe(false)              // and the gate must still open
  })

  it('renders immediately from the persisted session, without waiting on the network', async () => {
    installSignedInDevice()
    // getSession never settles — a slow connection stuck on the token refresh.
    mockGetSession.mockReturnValue(new Promise(() => {}))

    const useAuthStore = await freshStore()
    useAuthStore.getState().initialize()

    // Synchronously after initialize(): already usable, no await needed.
    const s = useAuthStore.getState()
    expect(s.session?.user.id).toBe(USER_ID)
    expect(s.loading).toBe(false)
  })

  it('still signs out properly when the session is genuinely invalid', async () => {
    installSignedInDevice()
    // No error means this IS a real answer: the session is gone.
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })

    const useAuthStore = await freshStore()
    useAuthStore.getState().initialize()
    await flush()

    expect(useAuthStore.getState().session).toBeNull()
    expect(useAuthStore.getState().loading).toBe(false)
  })

  it('does not sign out a device that has never signed in', async () => {
    installStorage({})
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })

    const useAuthStore = await freshStore()
    useAuthStore.getState().initialize()
    await flush()

    expect(useAuthStore.getState().session).toBeNull()
    expect(useAuthStore.getState().loading).toBe(false)
  })
})

describe('auth store — onAuthStateChange with a null session', () => {
  async function initAndCaptureListener() {
    installSignedInDevice()
    mockGetSession.mockReturnValue(new Promise(() => {}))
    const useAuthStore = await freshStore()
    useAuthStore.getState().initialize()
    const listener = mockOnAuthStateChange.mock.calls[0][0] as (e: string, s: unknown) => void
    return { useAuthStore, listener }
  }

  it('ignores INITIAL_SESSION carrying a null session (the offline case)', async () => {
    const { useAuthStore, listener } = await initAndCaptureListener()
    expect(useAuthStore.getState().session?.user.id).toBe(USER_ID)

    listener('INITIAL_SESSION', null)
    await flush()

    // Must NOT have been cleared — this is the second door onto the same bug.
    expect(useAuthStore.getState().session?.user.id).toBe(USER_ID)
  })

  it('clears on an explicit SIGNED_OUT', async () => {
    const { useAuthStore, listener } = await initAndCaptureListener()

    listener('SIGNED_OUT', null)
    await flush()

    expect(useAuthStore.getState().session).toBeNull()
    expect(useAuthStore.getState().profile).toBeNull()
  })
})
