import { useEffect, useRef, useState, useCallback } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import {
  generateQuickWorkout, persistQuickWorkout, getProfileForQuick,
  goalToPurpose, QUICK_DURATIONS, PURPOSE_META,
  type QuickMinutes, type QuickPurpose, type QuickWorkout, type ProfileForQuick, type MovementPattern,
} from '@/lib/quickWorkout'

const C = Colors.light
const PURPOSE_ORDER: QuickPurpose[] = [
  'strength_maintenance', 'muscle_growth', 'conditioning', 'athletic', 'recovery', 'mobility',
]

export default function QuickWorkoutScreen() {
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const params = useLocalSearchParams<{
    minutes?: string; purpose?: string; targetPattern?: string
    daysSinceTrained?: string; fromCalendarGap?: string
  }>()

  const initialMinutes = (Number(params.minutes) as QuickMinutes) || 15
  const targetPattern = (params.targetPattern as MovementPattern) || undefined
  const daysSinceTrained = params.daysSinceTrained ? Number(params.daysSinceTrained) : undefined
  const fromCalendarGap = params.fromCalendarGap === '1'

  const [minutes, setMinutes] = useState<QuickMinutes>(
    QUICK_DURATIONS.includes(initialMinutes) ? initialMinutes : 15
  )
  const [purpose, setPurpose] = useState<QuickPurpose | null>(
    (params.purpose as QuickPurpose) || null
  )
  const [workout, setWorkout] = useState<QuickWorkout | null>(null)
  const [generating, setGenerating] = useState(true)
  const [starting, setStarting] = useState(false)
  const [empty, setEmpty] = useState(false)
  const profileRef = useRef<ProfileForQuick | null>(null)

  const regenerate = useCallback(async (m: QuickMinutes, p: QuickPurpose | null) => {
    if (!userId) return
    setGenerating(true)
    setEmpty(false)
    try {
      if (!profileRef.current) {
        profileRef.current = await getProfileForQuick(supabase, userId)
      }
      const profile = profileRef.current
      const effectivePurpose = p ?? goalToPurpose(profile.goal)
      const w = await generateQuickWorkout(
        supabase, userId,
        { minutes: m, purpose: effectivePurpose, targetPattern, daysSinceTrained, fromCalendarGap },
        profile,
      )
      setWorkout(w)
      setEmpty(w.exercises.length === 0)
      if (w.exercises.length > 0) {
        track('quick_workout_generated', { minutes: m, purpose: effectivePurpose })
      }
    } catch {
      setEmpty(true)
    } finally {
      setGenerating(false)
    }
  // targetPattern / daysSinceTrained / fromCalendarGap are stable per-mount params
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Pre-generate on open so a Start button is ready immediately (<10s to start).
  useEffect(() => {
    regenerate(minutes, purpose)
  }, [regenerate]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePickMinutes = (m: QuickMinutes) => {
    setMinutes(m)
    regenerate(m, purpose)
  }
  const handlePickPurpose = (p: QuickPurpose) => {
    const next = p === purpose ? null : p
    setPurpose(next)
    regenerate(minutes, next)
  }

  const handleStart = async () => {
    if (!workout || starting || !workout.exercises.length) return
    setStarting(true)
    const id = await persistQuickWorkout(supabase, userId, workout)
    if (!id) { setStarting(false); return }
    track('session_start', {
      type: 'quick',
      duration_min: workout.estimatedMinutes,
      purpose: workout.purpose,
    })
    router.replace({ pathname: '/(tabs)/plan', params: { workoutId: id, quick: '1' } })
  }

  if (!session) return <Redirect href="/sign-in" />

  const activePurpose = workout?.purpose ?? purpose ?? 'muscle_growth'
  const meta = PURPOSE_META[activePurpose]

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="close" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quick Workout</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.lead}>How much time do you have?</Text>
        <Text style={styles.leadSub}>
          No setup. Tempo builds the highest-impact session for your window and goal.
        </Text>

        {/* Duration chips */}
        <View style={styles.durationGrid}>
          {QUICK_DURATIONS.map(m => {
            const active = m === minutes
            return (
              <TouchableOpacity
                key={m}
                style={[styles.durChip, active && styles.durChipActive]}
                onPress={() => handlePickMinutes(m)}
                activeOpacity={0.85}
              >
                <Text style={[styles.durNum, active && styles.durNumActive]}>{m}</Text>
                <Text style={[styles.durUnit, active && styles.durUnitActive]}>min</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Purpose chips (defaults from goal; tap to steer) */}
        <Text style={styles.sectionLabel}>FOCUS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.purposeRow}>
          {PURPOSE_ORDER.map(p => {
            const active = p === activePurpose
            const pm = PURPOSE_META[p]
            return (
              <TouchableOpacity
                key={p}
                style={[styles.purposeChip, active && styles.purposeChipActive]}
                onPress={() => handlePickPurpose(p)}
                activeOpacity={0.85}
              >
                <Ionicons name={pm.icon as any} size={15} color={active ? C.onPrimary : C.primary} />
                <Text style={[styles.purposeText, active && styles.purposeTextActive]}>{pm.label}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        {/* Generated preview */}
        <View style={styles.previewCard}>
          {generating ? (
            <View style={styles.previewLoading}>
              <ActivityIndicator color={C.primary} />
              <Text style={styles.previewLoadingText}>Building your session…</Text>
            </View>
          ) : empty ? (
            <View style={styles.previewLoading}>
              <Ionicons name="alert-circle-outline" size={22} color={C.textSecondary} />
              <Text style={styles.previewLoadingText}>
                No moves match your equipment for this focus. Try another focus or add equipment in your profile.
              </Text>
            </View>
          ) : workout ? (
            <>
              <View style={styles.previewTop}>
                <View style={styles.purposeBadge}>
                  <Ionicons name={meta.icon as any} size={13} color={C.primary} />
                  <Text style={styles.purposeBadgeText}>{meta.label.toUpperCase()}</Text>
                </View>
                <Text style={styles.previewEst}>~{workout.estimatedMinutes} min</Text>
              </View>
              <Text style={styles.previewTitle}>{workout.title}</Text>

              {/* Why this — the differentiator: never a random list */}
              <View style={styles.whyBox}>
                <Ionicons name="sparkles" size={14} color={C.primary} style={{ marginTop: 1 }} />
                <Text style={styles.whyText}>{workout.why}</Text>
              </View>

              {/* Exercise list */}
              <View style={styles.exList}>
                {workout.exercises.map((ex, i) => (
                  <View key={ex.id} style={styles.exRow}>
                    <Text style={styles.exIndex}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.exName}>{ex.name}</Text>
                      <Text style={styles.exMeta}>
                        {ex.primary_muscles.slice(0, 2).join(' · ')}
                      </Text>
                    </View>
                    <Text style={styles.exDose}>
                      {ex.sets} × {ex.repLow}–{ex.repHigh}{ex.repUnit === 'sec' ? 's' : ''}
                    </Text>
                  </View>
                ))}
              </View>

              {/* How it helps long-term */}
              <View style={styles.contribBox}>
                <Text style={styles.contribLabel}>WHY IT COUNTS</Text>
                <Text style={styles.contribText}>{workout.contribution}</Text>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky Start */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.startBtn, (generating || empty || starting) && { opacity: 0.5 }]}
          onPress={handleStart}
          disabled={generating || empty || starting}
          activeOpacity={0.85}
        >
          {starting ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <>
              <Ionicons name="play" size={16} color={C.onPrimary} />
              <Text style={styles.startBtnText}>Start {minutes}-Minute Workout</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm,
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 120, gap: Spacing.md },

  lead: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: C.text, letterSpacing: -0.3, marginTop: Spacing.xs },
  leadSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 20 },

  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  durChip: {
    width: '22.5%', aspectRatio: 1.15, borderRadius: Radius.lg,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  durChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  durNum: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.5 },
  durNumActive: { color: C.onPrimary },
  durUnit: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline },
  durUnitActive: { color: 'rgba(255,255,255,0.85)' },

  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  purposeRow: { gap: Spacing.xs, paddingRight: Spacing.lg },
  purposeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  purposeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  purposeText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text },
  purposeTextActive: { color: C.onPrimary },

  previewCard: {
    backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: Spacing.md,
  },
  previewLoading: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  previewLoadingText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  previewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  purposeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  purposeBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.5 },
  previewEst: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  previewTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.3, marginTop: -4 },
  whyBox: { flexDirection: 'row', gap: 8, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  whyText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  exList: { gap: 2 },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh },
  exIndex: { width: 20, fontFamily: 'Inter_700Bold', fontSize: 13, color: C.outline, textAlign: 'center' },
  exName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  exMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize', marginTop: 1 },
  exDose: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  contribBox: { backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  contribLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.6 },
  contribText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19 },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, paddingBottom: Spacing.xl,
    backgroundColor: C.surface, borderTopWidth: 0.5, borderTopColor: C.outlineVariant,
  },
  startBtn: {
    height: 56, backgroundColor: C.primary, borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
  },
  startBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
