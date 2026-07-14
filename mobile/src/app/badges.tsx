// Tempo — Badges collection (modal). The trophy case: every badge (milestones,
// consistency, competitive, social), earned lit and locked dimmed with progress,
// in the Achievements tile language. Opened from the badges button on the Profile
// header; opening it marks earned badges "seen" so the header count clears.

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ScreenHeader, DismissButton, PulseLoader } from '@/components/brand'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { BadgeShelf } from '@/components/BadgeShelf'
import { badgeStatsFromSessions, computeEarnedBadges, fetchStoredBadges, markBadgesSeen, BADGES } from '@/lib/badges'

export default function BadgesScreen() {
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { stats, workouts, isLoading } = useProgressStats(userId)

  const [stored, setStored] = useState<string[]>([])
  useEffect(() => {
    if (userId) fetchStoredBadges(supabase, userId).then(setStored).catch(() => {})
  }, [userId])

  const today = new Date().toISOString().slice(0, 10)
  const badgeStats = badgeStatsFromSessions(workouts, profile?.days_per_week ?? 3, today, {
    totalWorkouts: stats.totalWorkouts,
    totalVolume: stats.totalVolumeNum,
  })
  const earned = computeEarnedBadges(badgeStats, new Set(stored))

  // Opening the trophy case clears the "new badges" count on the Profile.
  const earnedKey = [...earned].sort().join(',')
  useEffect(() => {
    if (!isLoading && userId && earned.size) markBadgesSeen(userId, earned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, userId, earnedKey])

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Badges" size="sm" leading={<DismissButton onPress={() => router.back()} label="Close" />} />
      {isLoading ? (
        <View style={styles.center}><PulseLoader caption="Loading your badges…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.count}>{earned.size} of {BADGES.length} earned</Text>
          <Text style={styles.intro}>
            Badges reward consistency, not strength — showing up, finishing what you plan, and keeping streaks going.
          </Text>
          <View style={styles.card}>
            <BadgeShelf earned={earned} stats={badgeStats} showLocked />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.sm },
  count: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: Spacing.xs },
  card: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md, ...CardShadow },
})
