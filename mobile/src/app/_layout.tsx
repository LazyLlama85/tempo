import { useEffect } from 'react'
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
import { useTheme, useThemeStore, ThemeTransitionOverlay } from '@/theme'
import { initAnalytics, track } from '@/lib/analytics'
import { initCrashReporting, wrapWithCrashReporting, captureApiError } from '@/lib/crashReporting'
import { supabase } from '@/lib/supabase'
import {
  configurePurchases, identifyPurchases, resetPurchasesUser,
  fetchIsPro, addProUpdateListener, infoHasActiveTrial,
} from '@/lib/purchases'
import { fetchProEnabled } from '@/lib/proConfig'
import { useEntitlementStore } from '@/stores/entitlements'
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter'
import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque'
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

function RootLayout() {
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

      const [enabled, isPro] = await Promise.all([
        fetchProEnabled(supabase, sessionUserId ?? ''),
        fetchIsPro(),
      ])
      if (cancelled) return
      store.setProEnabled(enabled)
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
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    Inter_800ExtraBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  })

  useEffect(() => {
    initialize()
    track('app_open')
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
      if (data?.type) track('app_open') // attribute the open to the push
      switch (data?.screen) {
        case 'quick-workout': router.push('/quick-workout'); break
        case 'plan': router.push('/(tabs)/plan'); break
        case 'home': router.push('/(tabs)'); break
        case 'weekly-report': router.push('/weekly-report' as any); break
      }
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  const app = (
    <ThemeProvider value={NavTheme}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        {/* Default push = native slide; modals below override with slide-up. */}
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="quick-workout" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="availability" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="travel-mode" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="legal" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="weekly-report" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="plan-explainer" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-builder" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="edit-session" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="my-workouts" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="my-splits" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="social" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="friend-profile" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="badges" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="shared-workout" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="split-editor" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-history" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="session-detail" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="exercise-library" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="exercise-progress" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="pr-browser" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="calendar-setup" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="how-tempo-works" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-complete" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="welcome" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
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

// Wrap the root so native crashes and render errors are reported (no-op without a DSN).
export default wrapWithCrashReporting(RootLayout)
