import { useEffect } from 'react'
import { AppState, Text, TextInput } from 'react-native'
import { Stack, router } from 'expo-router'
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider, QueryCache, focusManager } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { useAuthStore } from '@/stores/auth'
import { useTheme, useThemeStore, ThemeTransitionOverlay } from '@/theme'
import { initAnalytics, track } from '@/lib/analytics'
import { initCrashReporting, wrapWithCrashReporting, captureApiError } from '@/lib/crashReporting'
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
          <Stack.Screen name="split-editor" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-history" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="session-detail" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="exercise-library" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="exercise-progress" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-complete" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
        </Stack>
        <ThemeTransitionOverlay />
      </ThemeProvider>
  )

  // Persisted cache when storage is available (native); plain provider otherwise.
  return persistOptions ? (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {app}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
  )
}

// Wrap the root so native crashes and render errors are reported (no-op without a DSN).
export default wrapWithCrashReporting(RootLayout)
