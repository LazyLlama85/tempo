import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { supabase } from '@/lib/supabase'
import { recordWorkoutFeedback, type WorkoutFeel } from '@/lib/adaptation'

const C = Colors.light

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'muscle-building',
  fat_loss: 'fat-loss',
  strength: 'strength',
  general_fitness: 'fitness',
  athletic: 'athletic',
}

export default function WorkoutCompleteScreen() {
  const router = useRouter()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { minutes, quick } = useLocalSearchParams<{ minutes?: string; quick?: string }>()
  const isQuick = quick === '1'
  const mins = Number(minutes) || 0

  const { stats, refetch } = useProgressStats(userId)
  const [feel, setFeel] = useState<WorkoutFeel | null>(null)

  // Stats were just mutated by completing the session — pull the fresh numbers so
  // the streak / consistency / weekly figures reflect this workout.
  useEffect(() => { refetch() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFeel = (f: WorkoutFeel) => {
    setFeel(f)
    if (userId) recordWorkoutFeedback(supabase, userId, f)
  }

  const FEEL_OPTIONS: { key: WorkoutFeel; label: string; icon: string }[] = [
    { key: 'too_easy', label: 'Too easy', icon: 'flash-outline' },
    { key: 'just_right', label: 'Just right', icon: 'checkmark-circle-outline' },
    { key: 'too_hard', label: 'Too hard', icon: 'flame-outline' },
  ]
  const feelConfirm: Record<WorkoutFeel, string> = {
    too_easy: "Got it — we'll add a set to each lift next session to push you.",
    just_right: 'Perfect — your plan stays right where it is.',
    too_hard: "Noted — we'll ease back the volume next time so you recover.",
  }

  const goalLabel = GOAL_LABELS[profile?.goal ?? 'general_fitness'] ?? 'fitness'
  const weeklyTarget = profile?.days_per_week ?? 3
  const weekPct = Math.min(100, Math.round((stats.thisWeek / weeklyTarget) * 100))

  if (!session) return <Redirect href="/sign-in" />

  // Lead line ties the effort back to the long-term goal — short work still counts.
  const lead = isQuick
    ? `${mins} minutes completed. You stayed on track with your ${goalLabel} goal.`
    : `Session complete. Every rep moves your ${goalLabel} goal forward.`

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={44} color={C.onPrimary} />
        </View>
        <Text style={styles.title}>Nice work.</Text>
        <Text style={styles.lead}>{lead}</Text>

        {/* Streak impact */}
        <View style={[styles.card, styles.streakCard]}>
          <View style={styles.streakRow}>
            <Ionicons name="flame" size={22} color="#fff" />
            <Text style={styles.streakTag}>STREAK</Text>
          </View>
          <Text style={styles.streakNum}>{stats.streak} <Text style={styles.streakUnit}>days</Text></Text>
          <Text style={styles.streakCaption}>
            {stats.streak > 1
              ? `This workout preserved your ${stats.streak}-day streak. Keep it alive.`
              : 'Your streak starts today — come back tomorrow to build it.'}
          </Text>
        </View>

        {/* Two stat tiles */}
        <View style={styles.tileRow}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>CONSISTENCY</Text>
            <Text style={styles.tileValue}>{stats.consistency_pct}%</Text>
            <Text style={styles.tileSub}>{stats.deltaStr}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>THIS WEEK</Text>
            <Text style={styles.tileValue}>{stats.thisWeek}<Text style={styles.tileValueUnit}>/{weeklyTarget}</Text></Text>
            <Text style={styles.tileSub}>{weekPct}% of weekly target</Text>
          </View>
        </View>

        {/* Weekly target progress bar */}
        <View style={styles.card}>
          <Text style={styles.weekLabel}>WEEKLY TRAINING TARGET</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${weekPct}%` as `${number}%` }]} />
          </View>
          <Text style={styles.weekCaption}>
            {weekPct >= 100
              ? `You've hit your full weekly target — outstanding.`
              : `You've completed ${weekPct}% of this week's training target.`}
          </Text>
        </View>

        {/* Difficulty check-in — coarse signal that tunes the next session's volume */}
        <View style={styles.card}>
          <Text style={styles.weekLabel}>HOW DID THAT FEEL?</Text>
          {feel ? (
            <View style={styles.feelDoneRow}>
              <Ionicons name="checkmark-circle" size={18} color={C.primary} />
              <Text style={styles.feelConfirm}>{feelConfirm[feel]}</Text>
            </View>
          ) : (
            <View style={styles.feelRow}>
              {FEEL_OPTIONS.map((o) => (
                <TouchableOpacity key={o.key} style={styles.feelBtn} onPress={() => handleFeel(o.key)} activeOpacity={0.8}>
                  <Ionicons name={o.icon as any} size={20} color={C.primary} />
                  <Text style={styles.feelBtnText}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {isQuick && (
          <View style={styles.noteBox}>
            <Ionicons name="bulb-outline" size={16} color={C.primary} style={{ marginTop: 1 }} />
            <Text style={styles.noteText}>
              Short sessions add up. Showing up on a busy day protects everything you've built —
              that's the whole point of Tempo.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(tabs)')} activeOpacity={0.85}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.xl, paddingBottom: 120, gap: Spacing.md, alignItems: 'stretch' },
  badge: {
    width: 88, height: 88, borderRadius: Radius.full, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    shadowColor: '#0058BC', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 24, elevation: 8,
  },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, color: C.text, letterSpacing: -0.5, textAlign: 'center', marginTop: Spacing.sm },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.xs },

  card: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: Spacing.xs },
  streakCard: { backgroundColor: C.primary, borderColor: C.primary },
  streakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakTag: { fontFamily: 'Inter_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 },
  streakNum: { fontFamily: 'Inter_800ExtraBold', fontSize: 44, color: '#fff', letterSpacing: -1.5, lineHeight: 48 },
  streakUnit: { fontFamily: 'Inter_400Regular', fontSize: 22, color: 'rgba(255,255,255,0.8)' },
  streakCaption: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20 },

  tileRow: { flexDirection: 'row', gap: Spacing.md },
  tile: { flex: 1, backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: 2 },
  tileLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  tileValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, color: C.text, letterSpacing: -1 },
  tileValueUnit: { fontFamily: 'Inter_400Regular', fontSize: 18, color: C.textSecondary },
  tileSub: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.primary },

  weekLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  barTrack: { height: 8, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full, marginTop: 4 },
  barFill: { height: 8, backgroundColor: C.primary, borderRadius: Radius.full },
  weekCaption: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 4, lineHeight: 18 },

  feelRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  feelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, borderWidth: 1, borderColor: C.outlineVariant,
  },
  feelBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },
  feelDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  feelConfirm: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },

  noteBox: { flexDirection: 'row', gap: 8, backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  doneBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  doneBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
