import { useEffect, useState, useRef } from 'react'
import { AppState, Text, TextInput } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Stack, router } from 'expo-router'
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider, QueryCache, focusManager } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { useAuthStore } from '@/stores/auth'
import { useTutorialStore } from '@/stores/tutorial'
import { TutorialOverlay } from '@/components/TutorialOverlay'
import { useTheme, useThemeStore, ThemeTransitionOverlay, loadStoredThemeMode } from '@/theme'
import { initAnalytics, track } from '@/lib/analytics'
import { initCrashReporting, wrapWithCrashReporting, captureApiError } from '@/lib/crashReporting'
import { TempoErrorBoundary } from '@/components/TempoErrorBoundary'
import { supabase } from '@/lib/supabase'
import {
  configurePurchases, identifyPurchases, resetPurchasesUser,
  fetchIsPro, addProUpdateListener, infoHasActiveTrial,
} from '@/lib/purchases'
import { fetchProState } from '@/lib/proConfig'
import { useEntitlementStore, loadStoredDevProOverride } from '@/stores/entitlements'
import { loadStoredWeightUnit } from '@/lib/units'
import { loadStoredFocusMode } from '@/lib/focusModePref'
import { endStaleRestActivities } from '@/widgets/RestTimerActivity'
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter'
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono'
import * as SplashScreen from 'expo-splash-screen'

SplashScreen.preventAutoHideAsync()

// Dynamic Type: keep text accessible (it still scales with the OS font setting) while
// capping the multiplier so very large sizes don't break the app's dense, fixed-height
// layouts — workout timer, set tables, calendar cells, big stat numbers.
const MAX_FONT_SCALE = 1.4
;(Text as unknown as { defaultProps?: Record<string, unknown> }).defaultProps = {
  ...(Text as unknown as { defaultProps?: Record<string, unknown> }).defaultProps,
  maxFontSizeMultiplier: MAX_FONT_SCALE,
}
;(TextInput as unknown as { defaultProps?: Record<string, unknown> }).defaultProps = {
  ...(TextInput as unknown as { defaultProps?: Record<string, unknown> }).defaultProps,
  maxFontSizeMultiplier: MAX_FONT_SCALE,
}

// Initialise telemetry as early as possible — before the tree mounts — so crashes
// during startup are still captured. Both are no-ops when their env keys are unset.
initCrashReporting()
initAnalytics()
// Configure RevenueCat once (anonymous until a user signs in). No-ops safely if the
// native module isn't in this binary yet (pre-rebuild) — Pro stays dormant anyway.
configurePurchases()

const queryClient = new QueryClient({
  // Surface every failed query (network / Supabase / API) to crash reporting
  // without breaking the UI — components still handle the error locally.
  queryCache: new QueryCache({
    onError: (error, query) => {
      captureApiError('react-query', error, { queryKey: query.queryKey })
    },
  }),
  defaultOptions: {
    // gcTime must outlive the persisted cache's maxAge, or restored entries
    // would be garbage-collected the moment they hydrate.
    queries: { retry: 1, staleTime: 30_000, gcTime: 24 * 60 * 60 * 1000 },
  },
})

// Cold-start speed: persist the JSON-safe training queries to the SQLite-backed
// localStorage (installed by lib/supabase), so relaunching the app paints real
// content immediately and refreshes in the background. Only plain-row queries
// are persisted — keys whose data holds Dates/Sets/Maps (range_events,
// ignored_events, progress_set_logs) would not survive JSON round-tripping.
const PERSISTED_QUERY_ROOTS = new Set([
  'scheduled_workouts', 'missed_workouts', 'next_workout',
  'block_phase', 'recovery_today', 'progress_workouts',
])
const persistStorage: Storage | undefined = (globalThis as { localStorage?: Storage }).localStorage
const persister = persistStorage
  ? createSyncStoragePersister({ storage: persistStorage, key: 'tempo.queryCache', throttleTime: 2_000 })
  : undefined
const persistOptions = persister
  ? {
      persister,
      maxAge: 24 * 60 * 60 * 1000,
      buster: 'tempo-cache-v1',
      dehydrateOptions: {
        shouldDehydrateQuery: (q: { state: { status: string }; queryKey: readonly unknown[] }) =>
          q.state.status === 'success' &&
          typeof q.queryKey[0] === 'string' &&
          PERSISTED_QUERY_ROOTS.has(q.queryKey[0]),
      },
    }
  : undefined

// TempoErrorBoundary used to wrap only the JSX built partway through this
// component (after the `ready` check) — so a throw in any hook ABOVE that
// point (theme, auth store, the entitlement effect, useFonts) had nothing to
// catch it. React unmounts the whole tree on an uncaught render error, which
// with no boundary above it means a genuinely blank screen with no fallback
// UI and nothing in the crash log tied to a component stack. Moved the
// boundary to wrap this entire component instead (see the real RootLayout
// export at the bottom) so every hook here is covered, not just the JSX.
function RootLayoutInner() {
  const { initialize } = useAuthStore()
  const sessionUserId = useAuthStore(s => s.session?.user.id)
  // Load this user's device-local tutorial state whenever the signed-in user changes.
  useEffect(() => {
    if (sessionUserId) useTutorialStore.getState().init(sessionUserId)
  }, [sessionUserId])

  // Tempo Pro (§10): tie RevenueCat to the signed-in user, load the dormant remote
  // flag, read current entitlement, and watch for live changes. All of it no-ops
  // while Pro is dormant or the native module isn't present — the free app is
  // unchanged until the flag is flipped on.
  useEffect(() => {
    let unsubscribe = () => {}
    let cancelled = false
    ;(async () => {
      const store = useEntitlementStore.getState()
      if (sessionUserId) await identifyPurchases(sessionUserId)
      else await resetPurchasesUser()

      const [proState, isPro] = await Promise.all([
        fetchProState(supabase, sessionUserId ?? ''),
        fetchIsPro(),
      ])
      if (cancelled) return
      store.setProEnabled(proState.proEnabled)
      store.setGranted(proState.proGranted)
      store.setTester(proState.isTester)
      store.setIsPro(isPro)
      store.setReady(true)

      // Purchases / renewals / expirations arrive here while the app is open.
      unsubscribe = addProUpdateListener((nowPro, info) => {
        const wasPro = useEntitlementStore.getState().isPro
        useEntitlementStore.getState().setIsPro(nowPro)
        if (nowPro && !wasPro) track(infoHasActiveTrial(info) ? 'trial_started' : 'trial_converted')
        else if (!nowPro && wasPro) track('subscription_cancelled')
      })
    })().catch(() => {})
    return () => { cancelled = true; unsubscribe() }
  }, [sessionUserId])
  // Live navigation theme — follows the active palette so screen backgrounds and
  // transitions never flash the wrong color when the mode changes.
  const C = useTheme()
  const mode = useThemeStore((s) => s.mode)
  const NavTheme = {
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: C.surface,
      card: C.background,
      text: C.text,
      border: C.outlineVariant,
      primary: C.primary,
    },
  }
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    Inter_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  })

  // Cold-start safety net (fixes the intermittent "app won't load, have to kill and
  // reopen" hang): the app gates its first render on fonts. If `useFonts` ever
  // errors (fontError) or stalls without resolving, the old code left `fontsLoaded`
  // false forever → `return null` behind a splash that never hides. Now a font
  // ERROR counts as ready (render with system fonts rather than block), and a 5s
  // timeout force-proceeds even if useFonts never settles at all. Normal loads are
  // unaffected — `ready` still flips the instant fonts finish.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 5000)
    return () => clearTimeout(t)
  }, [])
  const ready = fontsLoaded || !!fontError || timedOut

  // Shared between the two effects below — see the app_open double-fire fix.
  const coldLaunchRef = useRef(true)

  useEffect(() => {
    initialize()
    track('app_open')
    // Fixed 2026-08-02: a cold launch triggered by tapping a push notification
    // used to fire `app_open` TWICE — once here unconditionally, once more
    // below when addNotificationResponseReceivedListener receives the SAME
    // launching notification's response (Expo's listener fires for the
    // response that launched the app, not just ones tapped while running).
    // This 2s window treats any notification-tap event that arrives that
    // soon after mount as the same cold-launch open already counted here; a
    // genuine tap while the app is already running (well outside this
    // window) still tracks its own app_open below, as before.
    const t = setTimeout(() => { coldLaunchRef.current = false }, 2000)
    // Force-quit mid-rest safety net: don't leave a stale Live Activity on the
    // Lock Screen any longer than it takes to reopen the app (iOS also
    // auto-expires them on its own timeout, but this is faster and explicit).
    endStaleRestActivities()
    // Device-local prefs (theme, weight unit, Focus Mode, tester Pro override)
    // default synchronously on module load and are corrected here, AFTER first
    // paint, via the async SQLite API — see theme/index.tsx for why a
    // synchronous localStorage read before mount was the root cause of the
    // "blank screen on first launch, fixed by force-quitting" bug.
    loadStoredThemeMode()
    loadStoredWeightUnit()
    loadStoredFocusMode()
    loadStoredDevProOverride()
    return () => clearTimeout(t)
  }, [])

  // React Native has no "window focus" — tell React Query when the app comes
  // back to the foreground so stale queries refetch on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      focusManager.setFocused(status === 'active')
    })
    return () => sub.remove()
  }, [])

  // Route taps on a retention push to the screen it targets (data.screen).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { screen?: string; type?: string }
      // Only attribute a FRESH app_open here — see coldLaunchRef's declaration
      // above. A response arriving within the cold-launch window is the same
      // open the other effect already tracked, not a second one.
      if (data?.type && !coldLaunchRef.current) track('app_open')
      switch (data?.screen) {
        case 'quick-workout': router.push('/quick-workout'); break
        case 'plan': router.push('/(tabs)/plan'); break
        case 'home': router.push('/(tabs)'); break
        case 'weekly-report': router.push('/weekly-report' as any); break
        case 'social': router.push('/social' as any); break
        default:
          // Fixed 2026-08-02: an unrecognized/future data.screen value used to
          // silently no-op — but ONLY do this for a retention-push notification
          // (data.type present). Local notifications (pre-workout reminder,
          // rest-timer-done — lib/notifications.ts) carry no `data` at all;
          // tapping those must keep doing nothing special, not yank the user
          // to Home mid-workout.
          if (data?.type) router.push('/(tabs)')
      }
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [ready])

  if (!ready) return null

  const app = (
    <ThemeProvider value={NavTheme}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        {/* Default push = native slide; modals below override with slide-up. */}
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="quick-workout" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="coach" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="availability" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="travel-mode" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="pause-mode" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="legal" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="weekly-report" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="feed" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="plan-explainer" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-builder" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="edit-session" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="my-workouts" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="my-splits" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="social" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="friend-profile" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="badges" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="group-detail" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="shared-workout" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="split-editor" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-history" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="progress-photos" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="session-detail" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="exercise-library" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="exercise-progress" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="muscle-history" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="pr-browser" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="calendar-setup" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="calendar-picker" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-complete" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
        </Stack>
        <ThemeTransitionOverlay />
        <TutorialOverlay />
    </ThemeProvider>
  )

  // Persisted cache when storage is available (native); plain provider otherwise.
  const withQueryClient = persistOptions ? (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {app}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
  )

  // @gorhom/bottom-sheet needs a GestureHandlerRootView ancestor for pan gestures to
  // work, and BottomSheetModalProvider to host the imperative sheet portal.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>{withQueryClient}</BottomSheetModalProvider>
    </GestureHandlerRootView>
  )
}

// TempoErrorBoundary wraps the WHOLE component (every hook above, not just
// the JSX built after `ready`) — see the comment on RootLayoutInner.
function RootLayout() {
  return (
    <TempoErrorBoundary>
      <RootLayoutInner />
    </TempoErrorBoundary>
  )
}

// Wrap the root so native crashes and render errors are reported (no-op without a DSN).
export default wrapWithCrashReporting(RootLayout)
