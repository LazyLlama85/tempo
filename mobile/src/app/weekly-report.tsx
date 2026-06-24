// Tempo — Weekly Progress Report screen.
//
// The Sunday "am I improving?" answer: workouts, volume vs last week, estimated
// strength gains, weight trend, consistency — then a one-tap share. All numbers
// come from computeWeeklyReport (lib/weeklyReport.ts); the share reuses the
// existing Wrapped cards.

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, Redirect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { computeWeeklyReport, reportHasContent, type WeeklyReport } from '@/lib/weeklyReport'
import { buildWrappedCards, type WrappedCard } from '@/lib/wrapped'
import { formatTrend } from '@/lib/bodyMeasurements'
import { ShareCardSheet } from '@/components/ShareCardSheet'

const C = Colors.light

export default function WeeklyReportScreen() {
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<WrappedCard[]>([])
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => {
    if (!userId) return
    computeWeeklyReport(supabase, userId).then((r) => { setReport(r); setLoading(false) })
    buildWrappedCards(supabase, userId).then(setCards).catch(() => setCards([]))
  }, [userId])

  if (!session) return <Redirect href="/sign-in" />

  const volLine = report?.volumeDeltaPct == null
    ? 'First week of volume logged'
    : `${report.volumeDeltaPct >= 0 ? '+' : ''}${report.volumeDeltaPct}% vs last week`
  const wkLine = report
    ? report.prevWorkouts > 0
      ? `${report.workouts >= report.prevWorkouts ? '+' : ''}${report.workouts - report.prevWorkouts} vs last week`
      : 'Keep it rolling'
    : ''

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Week</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : !report || !reportHasContent(report) ? (
        <View style={styles.center}>
          <Ionicons name="bar-chart-outline" size={30} color={C.outline} />
          <Text style={styles.emptyText}>No sessions logged this week yet. Finish a workout and your report fills in.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.lead}>Here's your progress this week. The numbers don't lie — you're moving.</Text>

          {/* Workouts + consistency tiles */}
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>WORKOUTS</Text>
              <Text style={styles.tileValue}>{report.workouts}</Text>
              <Text style={styles.tileSub}>{wkLine}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>CONSISTENCY</Text>
              <Text style={styles.tileValue}>{report.consistencyPct}%</Text>
              <Text style={styles.tileSub}>of planned sessions</Text>
            </View>
          </View>

          {/* Volume */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardLabel}>VOLUME LIFTED</Text>
              <View style={[styles.deltaPill, (report.volumeDeltaPct ?? 0) >= 0 ? styles.deltaUp : styles.deltaDown]}>
                <Ionicons
                  name={(report.volumeDeltaPct ?? 0) >= 0 ? 'trending-up' : 'trending-down'}
                  size={13}
                  color={(report.volumeDeltaPct ?? 0) >= 0 ? C.success : C.error}
                />
                <Text style={[styles.deltaText, { color: (report.volumeDeltaPct ?? 0) >= 0 ? C.success : C.error }]}>{volLine}</Text>
              </View>
            </View>
            <Text style={styles.cardValue}>{report.volumeLbs.toLocaleString()} <Text style={styles.cardUnit}>lbs</Text></Text>
            <Text style={styles.cardSub}>{report.minutes} min trained this week</Text>
          </View>

          {/* Estimated strength */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ESTIMATED STRENGTH</Text>
            <Text style={styles.cardValue}>
              {report.strongerExercises > 0 ? `Up in ${report.strongerExercises} lift${report.strongerExercises === 1 ? '' : 's'}` : 'Holding steady'}
            </Text>
            {report.strengthGains.length > 0 ? (
              <View style={styles.gainList}>
                {report.strengthGains.map((g) => (
                  <View key={g.name} style={styles.gainRow}>
                    <Ionicons name="trending-up" size={14} color={C.success} />
                    <Text style={styles.gainName} numberOfLines={1}>{g.name}</Text>
                    <Text style={styles.gainDelta}>+{g.deltaLbs} lbs est. 1RM</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.cardSub}>Log heavier or more reps to push your estimated maxes.</Text>
            )}
          </View>

          {/* Weight + PRs */}
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>WEIGHT TREND</Text>
              <Text style={[styles.tileValue, { fontSize: 22 }]}>{formatTrend(report.weightPerWeek)}</Text>
              <Text style={styles.tileSub}>{report.weightPerWeek == null ? 'Log your weight' : 'this month'}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>NEW PRs</Text>
              <Text style={styles.tileValue}>{report.newPRs}</Text>
              <Text style={styles.tileSub}>this week</Text>
            </View>
          </View>

          {cards.length > 0 && (
            <TouchableOpacity style={styles.shareBtn} onPress={() => setShareOpen(true)} activeOpacity={0.85}>
              <Ionicons name="share-outline" size={18} color={C.primary} />
              <Text style={styles.shareBtnText}>Share my week</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <ShareCardSheet visible={shareOpen} cards={cards} onClose={() => setShareOpen(false)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm },
  headerTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.text, letterSpacing: -0.2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22, marginTop: Spacing.xs },

  tileRow: { flexDirection: 'row', gap: Spacing.md },
  tile: { flex: 1, backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: 2 },
  tileLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  tileValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, color: C.text, letterSpacing: -1 },
  tileSub: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },

  card: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  cardValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.6 },
  cardUnit: { fontFamily: 'Inter_400Regular', fontSize: 16, color: C.textSecondary },
  cardSub: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, marginTop: 2 },
  deltaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  deltaUp: { backgroundColor: C.successSoft },
  deltaDown: { backgroundColor: C.dangerSoft },
  deltaText: { fontFamily: 'Inter_700Bold', fontSize: 11 },

  gainList: { gap: Spacing.xs, marginTop: Spacing.sm },
  gainRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gainName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  gainDelta: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.success },

  shareBtn: { height: 52, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surfaceContainerLow, marginTop: Spacing.xs },
  shareBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
})
