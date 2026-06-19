import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { DarkTheme, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { Colors } from '@/constants/theme'
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter'
import * as SplashScreen from 'expo-splash-screen'

SplashScreen.preventAutoHideAsync()

const queryClient = new QueryClient({
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

export default function RootLayout() {
  const { initialize } = useAuthStore()
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    Inter_800ExtraBold,
  })

  useEffect(() => {
    initialize()
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
          <Stack.Screen name="workout-complete" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
