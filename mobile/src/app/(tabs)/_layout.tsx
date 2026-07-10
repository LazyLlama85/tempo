import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router'
import { View } from 'react-native'
import { useAuthStore } from '@/stores/auth'
import { useTutorialStore } from '@/stores/tutorial'
import { T } from '@/lib/tutorial'
import { useTheme } from '@/theme'
import { TempoTabBar, type TabBarProps } from '@/components/TempoTabBar'

export default function TabsLayout() {
  const { session, profile, loading } = useAuthStore()
  // Read the tutorial state reactively so completing the welcome re-evaluates the gate.
  const welcomePending = useTutorialStore(s => !!s.data.armed[T.welcome] && !s.data.skipped[T.welcome] && !s.data.completedSteps['welcome_done'])
  const C = useTheme()

  if (loading) return <View style={{ flex: 1, backgroundColor: C.background }} />
  if (!session) return <Redirect href="/sign-in" />
  if (!profile?.onboarding_complete) return <Redirect href="/onboarding/goal" />
  // A freshly-onboarded user is routed through the Welcome experience before the
  // app. Force-close-proof: this gate re-shows it on reopen until it's completed.
  if (welcomePending) return <Redirect href={'/welcome' as any} />

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
      <Tabs.Screen name="plan" options={{ title: 'Train' }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  )
}
