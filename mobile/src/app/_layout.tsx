import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { DarkTheme, ThemeProvider } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { Colors } from '@/constants/theme'
import { initAnalytics, track } from '@/lib/analytics'
import { initCrashReporting, wrapWithCrashReporting, captureApiError } from '@/lib/crashReporting'
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter'
import * as SplashScreen from 'expo-splash-screen'

SplashScreen.preventAutoHideAsync()

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
    queries: { retry: 1, staleTime: 30_000 },
  },
})

// Tempo is dark-mode-first — keep the navigation background dark so there's no
// white flash behind screens or during transitions.
const C = Colors.light
const NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: C.surface,
    card: C.background,
    text: C.text,
    border: C.outlineVariant,
    primary: C.primary,
  },
}

function RootLayout() {
  const { initialize } = useAuthStore()
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    Inter_800ExtraBold,
  })

  useEffect(() => {
    initialize()
    track('app_open')
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

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={NavTheme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="quick-workout" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="smart-scheduler" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="availability" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="travel-mode" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="legal" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="weekly-report" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="plan-explainer" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="workout-complete" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

// Wrap the root so native crashes and render errors are reported (no-op without a DSN).
export default wrapWithCrashReporting(RootLayout)
