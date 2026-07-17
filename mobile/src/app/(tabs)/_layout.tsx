import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router'
import { View } from 'react-native'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/theme'
import { TempoTabBar, type TabBarProps } from '@/components/TempoTabBar'

export default function TabsLayout() {
  const { session, profile, loading } = useAuthStore()
  const C = useTheme()

  if (loading) return <View style={{ flex: 1, backgroundColor: C.background }} />
  if (!session) return <Redirect href="/sign-in" />
  if (!profile?.onboarding_complete) return <Redirect href="/onboarding/goal" />
  // A freshly-onboarded user used to be routed through a separate /welcome screen
  // here (removed 2026-07-17 — it repeated the same plan facts plan-preview's own
  // reveal already shows). That reveal now sets 'welcome_done' directly, so there's
  // nothing left for this gate to redirect to.

  return (
    <Tabs
      // The floating Tempo dock replaces the stock bar (icons, GO button and
      // active states all live in TempoTabBar).
      tabBar={(props) => <TempoTabBar {...(props as unknown as TabBarProps)} />}
      screenOptions={{
        headerShown: false,
        // All four tabs mount (and fetch) at startup, so switching is instant and
        // nothing ever mounts mid-transition. The `shift` scene animation is gone
        // on purpose: interrupted shifts could strand a scene half-hidden — the
        // "screen doesn't load until I come back" bug. Transition feel now lives
        // in the tab bar itself + per-screen focus motion, which can't hide content.
        lazy: false,
        sceneStyle: { backgroundColor: C.surface },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  )
}
