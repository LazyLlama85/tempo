import { Stack, Redirect } from 'expo-router'
import { useAuthStore } from '@/stores/auth'
import { ThemedView } from '@/components/themed-view'
import { PulseLoader } from '@/components/brand'

export default function OnboardingLayout() {
  const { session, loading } = useAuthStore()

  // Same fix as (tabs)/_layout.tsx, same founder report — a bare, indicator-less
  // view during the auth store's cold-start wait read as frozen, not loading.
  if (loading) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <PulseLoader />
      </ThemedView>
    )
  }

  if (!session) {
    return <Redirect href="/sign-in" />
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
  )
}
