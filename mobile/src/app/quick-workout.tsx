import { useEffect, useRef, useState, useCallback } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { TempoPulse, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import { PressableScale } from '@/components/motion'
import { TempoLottie } from '@/components/TempoLottie'
import { describeSaveError } from '@/lib/saveErrors'
import {
  generateQuickWorkout, persistQuickWorkout, getProfileForQuick,
  getScheduleRestrictions, injuriesToRestrictions,
  goalToPurpose, QUICK_DURATIONS, PURPOSE_META,
  type QuickMinutes, type QuickPurpose, type QuickWorkout, type ProfileForQuick, type MovementPattern, type QuickRestrictions,
} from '@/lib/quickWorkout'
import { useProGate } from '@/stores/entitlements'
import { fetchPresets, savePresets, describeEquipment, type EquipmentPreset } from '@/lib/equipmentPresets'
import { EquipmentPresetSheet } from '@/components/EquipmentPresetSheet'
import type { Equipment } from '@/types'

const PURPOSE_ORDER: QuickPurpose[] = [
  'strength_maintenance', 'muscle_growth', 'conditioning', 'athletic', 'recovery', 'mobility',
]

export default function QuickWorkoutScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
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
  const restrictionsRef = useRef<QuickRestrictions | null>(null)

  // ── Equipment presets (Pro): build a session around a saved setup ("Home",
  // "Hotel gym"). Free users can use their default gear; a saved preset's
  // custom-equipment regeneration is the Pro gate (consistent with Travel Mode).
  const { locked } = useProGate()
  const [presets, setPresets] = useState<EquipmentPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [presetSheet, setPresetSheet] = useState<{ open: boolean; edit: EquipmentPreset | null }>({ open: false, edit: null })
  useEffect(() => {
    if (!userId) return
    fetchPresets(supabase, userId).then(setPresets).catch(() => {})
  }, [userId])

  const selectedPreset = selectedPresetId ? presets.find((p) => p.id === selectedPresetId) ?? null : null
  const isCustomEquipment = !!selectedPreset
  const teased = isCustomEquipment && locked && !empty   // ready, but gated behind Pro

  const openPaywall = () => {
    track('paywall_shown', { context: 'quick_equipment' })
    router.push({ pathname: '/paywall', params: { context: 'quick_equipment' } } as never)
  }

  const regenerate = useCallback(async (m: QuickMinutes, p: QuickPurpose | null, equipOverride: Equipment[] | null) => {
    if (!userId) return
    setGenerating(true)
    setEmpty(false)
    try {
      if (!profileRef.current) {
        profileRef.current = await getProfileForQuick(supabase, userId)
      }
      // A selected preset overrides the profile's equipment for this session.
      const base = profileRef.current
      const profile = equipOverride ? { ...base, equipment: equipOverride } : base
      // Merge injury avoidance with schedule awareness (fetched once): skip what's
      // scheduled soon (don't pre-empt tomorrow's leg day) or was just trained.
      if (!restrictionsRef.current) {
        const injuryR = injuriesToRestrictions(base.injuries)
        const schedR = await getScheduleRestrictions(supabase, userId)
        restrictionsRef.current = {
          avoidMuscles: [...new Set([...injuryR.avoidMuscles, ...schedR.avoidMuscles])],
          avoidPatterns: [...new Set([...injuryR.avoidPatterns, ...schedR.avoidPatterns])],
        }
      }
      const restrictions = restrictionsRef.current
      // If the requested target (e.g. a missed "leg day") is now avoided because it's
      // scheduled soon, drop it so the "why" copy doesn't claim to build around it.
      const effectiveTarget = targetPattern && restrictions.avoidPatterns.includes(targetPattern) ? undefined : targetPattern
      const effectivePurpose = p ?? goalToPurpose(profile.goal)
      const w = await generateQuickWorkout(
        supabase, userId,
        { minutes: m, purpose: effectivePurpose, targetPattern: effectiveTarget, daysSinceTrained, fromCalendarGap, restrictions },
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
    regenerate(minutes, purpose, null)
  }, [regenerate]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentEquip = () => selectedPreset?.equipment ?? null
  const handlePickMinutes = (m: QuickMinutes) => {
    setMinutes(m)
    regenerate(m, purpose, currentEquip())
  }
  const handlePickPurpose = (p: QuickPurpose) => {
    const next = p === purpose ? null : p
    setPurpose(next)
    regenerate(minutes, next, currentEquip())
  }
  const handlePickPreset = (id: string | null) => {
    setSelectedPresetId(id)
    const pr = id ? presets.find((p) => p.id === id) ?? null : null
    regenerate(minutes, purpose, pr?.equipment ?? null)
  }
  const handleSavePreset = async (preset: EquipmentPreset) => {
    const next = presets.some((p) => p.id === preset.id)
      ? presets.map((p) => (p.id === preset.id ? preset : p))
      : [...presets, preset]
    setPresets(next)
    setPresetSheet({ open: false, edit: null })
    setSelectedPresetId(preset.id)
    regenerate(minutes, purpose, preset.equipment)
    await savePresets(supabase, userId, next)
  }
  const handleDeletePreset = async (id: string) => {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    setPresetSheet({ open: false, edit: null })
    if (selectedPresetId === id) { setSelectedPresetId(null); regenerate(minutes, purpose, null) }
    await savePresets(supabase, userId, next)
  }

  const handleStart = async () => {
    if (!workout || starting || !workout.exercises.length) return
    if (teased) { openPaywall(); return }  // custom-equipment session is a Pro gate
    setStarting(true)
    let id: string | null = null
    try {
      id = await persistQuickWorkout(supabase, userId, workout)
    } catch (err) {
      setStarting(false)
      const info = describeSaveError(err, 'start your session')
      Alert.alert('Couldn’t start', `${info.message}\n\nYour session is still ready — tap Start again.`)
      return
    }
    if (!id) {
      setStarting(false)
      Alert.alert('Couldn’t start', 'Check your connection and tap Start again — your session is still ready.')
      return
    }
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
      <ScreenHeader
        title="Quick Workout"
        size="sm"
        leading={<DismissButton kind="x" onPress={() => router.back()} label="Close" />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <TempoLottie source={require('@/assets/lottie/coach/walking.json')} width={46} height={82} style={styles.coachWalking} />
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

        {/* Equipment presets — build the session around a saved setup (Pro) */}
        <View style={styles.rowBetween}>
          <Text style={styles.sectionLabel}>EQUIPMENT</Text>
          {locked && <View style={styles.proTag}><Text style={styles.proTagText}>PRO</Text></View>}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
          <TouchableOpacity
            style={[styles.presetChip, !selectedPresetId && styles.presetChipActive]}
            onPress={() => handlePickPreset(null)}
            activeOpacity={0.85}
          >
            <Ionicons name="home" size={14} color={!selectedPresetId ? C.onPrimary : C.primary} />
            <Text style={[styles.presetChipText, !selectedPresetId && styles.presetChipTextActive]}>All my gear</Text>
          </TouchableOpacity>
          {presets.map((pr) => {
            const on = selectedPresetId === pr.id
            return (
              <TouchableOpacity
                key={pr.id}
                style={[styles.presetChip, on && styles.presetChipActive]}
                onPress={() => handlePickPreset(pr.id)}
                onLongPress={() => setPresetSheet({ open: true, edit: pr })}
                activeOpacity={0.85}
              >
                <Ionicons name="cube" size={14} color={on ? C.onPrimary : C.primary} />
                <Text style={[styles.presetChipText, on && styles.presetChipTextActive]} numberOfLines={1}>{pr.name}</Text>
                {locked && <Ionicons name="lock-closed" size={11} color={on ? 'rgba(255,255,255,0.9)' : C.gold} />}
              </TouchableOpacity>
            )
          })}
          <TouchableOpacity style={styles.presetNew} onPress={() => setPresetSheet({ open: true, edit: null })} activeOpacity={0.85}>
            <Ionicons name="add" size={15} color={C.primary} />
            <Text style={styles.presetNewText}>New</Text>
          </TouchableOpacity>
        </ScrollView>
        {presets.length > 0 && (
          <Text style={styles.presetHint}>Long-press a preset to edit. Use “All my gear” for your usual setup.</Text>
        )}

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
              <TempoPulse size={30} />
              <Text style={styles.previewLoadingText}>Building your session…</Text>
            </View>
          ) : empty ? (
            <View style={styles.previewLoading}>
              <Ionicons name="alert-circle-outline" size={22} color={C.textSecondary} />
              <Text style={styles.previewLoadingText}>
                No moves match your equipment for this focus. Try another focus or add equipment in your profile.
              </Text>
            </View>
          ) : teased && workout ? (
            <>
              <View style={styles.previewTop}>
                <View style={styles.proBadgeRow}>
                  <Ionicons name="lock-closed" size={11} color={C.gold} />
                  <Text style={styles.proBadgeText}>PRO</Text>
                </View>
                <Text style={styles.previewEst}>~{workout.estimatedMinutes} min</Text>
              </View>
              <Text style={styles.previewTitle}>Your {selectedPreset?.name} session is ready</Text>
              <View style={styles.whyBox}>
                <Ionicons name="sparkles" size={14} color={C.primary} style={{ marginTop: 1 }} />
                <Text style={styles.whyText}>
                  {workout.exercises.length} moves built around {describeEquipment(selectedPreset?.equipment ?? [])}, sized to your {minutes} minutes.
                </Text>
              </View>
              {/* Redacted list — shows it's really built, hides the details */}
              <View style={styles.exList}>
                {workout.exercises.slice(0, 5).map((ex, i) => (
                  <View key={ex.id} style={styles.exRow}>
                    <Text style={styles.exIndex}>{i + 1}</Text>
                    <View style={[styles.teaseBar, { width: `${64 - i * 7}%` as `${number}%` }]} />
                    <Ionicons name="lock-closed" size={13} color={C.outline} />
                  </View>
                ))}
              </View>
            </>
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
        <PressableScale
          style={[styles.startBtn, (generating || empty || starting) && { opacity: 0.5 }]}
          onPress={handleStart}
          disabled={generating || empty || starting}
        >
          {starting ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : teased ? (
            <>
              <Ionicons name="sparkles" size={16} color={C.onPrimary} />
              <Text style={styles.startBtnText}>Unlock to Start</Text>
            </>
          ) : (
            <>
              <Ionicons name="play" size={16} color={C.onPrimary} />
              <Text style={styles.startBtnText}>Start {minutes}-Minute Workout</Text>
            </>
          )}
        </PressableScale>
      </View>

      <EquipmentPresetSheet
        visible={presetSheet.open}
        preset={presetSheet.edit}
        onClose={() => setPresetSheet({ open: false, edit: null })}
        onSave={handleSavePreset}
        onDelete={handleDeletePreset}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm,
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 17, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 120, gap: Spacing.md },

  lead: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.3, marginTop: Spacing.xs },
  coachWalking: { marginBottom: Spacing.xs },
  leadSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 20 },

  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  durChip: {
    width: '22.5%', aspectRatio: 1.15, borderRadius: Radius.lg,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  durChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  durNum: { fontFamily: C.fontDisplay, fontSize: 23, color: C.text, letterSpacing: -0.5 },
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

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  proTag: { backgroundColor: C.gold, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  proTagText: { fontFamily: 'Inter_800ExtraBold', fontSize: 9.5, color: '#1b1400', letterSpacing: 0.6 },
  presetRow: { gap: Spacing.xs, paddingRight: Spacing.lg, paddingVertical: 2 },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 170,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  presetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  presetChipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text, flexShrink: 1 },
  presetChipTextActive: { color: C.onPrimary },
  presetNew: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: C.primaryLine, borderStyle: 'dashed',
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  presetNewText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  presetHint: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.outline, lineHeight: 16 },

  proBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.gold + '22', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  proBadgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, color: C.gold, letterSpacing: 0.5 },
  teaseBar: { flex: 1, height: 11, borderRadius: Radius.sm, backgroundColor: C.surfaceContainerHigh },

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
  previewTitle: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3, marginTop: -4 },
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
