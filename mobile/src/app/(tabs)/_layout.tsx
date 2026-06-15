import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Platform, View } from 'react-native'
import { useAuthStore } from '@/stores/auth'
import { Colors } from '@/constants/theme'

const C = Colors.light
type IoniconsName = keyof typeof Ionicons.glyphMap

export default function TabsLayout() {
  const { session, profile, loading } = useAuthStore()

  if (loading) return <View style={{ flex: 1, backgroundColor: C.background }} />
  if (!session) return <Redirect href="/sign-in" />
  if (!profile?.onboarding_complete) return <Redirect href="/onboarding/goal" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.outline,
        tabBarStyle: {
          backgroundColor: C.background,
          borderTopColor: C.outlineVariant,
          borderTopWidth: 0.5,
          height: Platform.select({ ios: 84, android: 68 }),
          paddingBottom: Platform.select({ ios: 28, android: 12 }),
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline' as IoniconsName} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Workouts',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'barbell' : 'barbell-outline' as IoniconsName} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'trending-up' : 'trending-up-outline' as IoniconsName} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'person' : 'person-outline' as IoniconsName} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
