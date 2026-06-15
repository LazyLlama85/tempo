import { Stack, Redirect } from 'expo-router'
import { useAuthStore } from '@/stores/auth'
import { ThemedView } from '@/components/themed-view'

export default function OnboardingLayout() {
  const { session, loading } = useAuthStore()

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />
  }

  if (!session) {
    return <Redirect href="/sign-in" />
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
  )
}
