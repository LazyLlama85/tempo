import { useEffect, useRef, useState, useCallback } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { ScreenHeader, DismissButton, PulseLoader } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import { PressableScale } from '@/components/motion'
import { TempoLottie } from '@/components/TempoLottie'
import { Slider } from '@/components/Slider'
import { describeSaveError } from '@/lib/saveErrors'
import {
  generateQuickWorkout, persistQuickWorkout, getProfileForQuick,
  getScheduleRestrictions, injuriesToRestrictions,
  goalToPurpose, snapToQuickMinutes, QUICK_DURATIONS, PURPOSE_META, TARGET_AREA_OPTIONS,
  type QuickMinutes, type QuickPurpose, type QuickWorkout, type ProfileForQuick, type MovementPattern,
  type QuickRestrictions, type TargetAreaOption,
} from '@/lib/quickWorkout'
import { useProGate } from '@/stores/entitlements'
import { ProBadge } from '@/components/ProGate'
import { fetchPresets, savePresets, type EquipmentPreset } from '@/lib/equipmentPresets'
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
  const daysSinceTrained = params.daysSinceTrained ? Number(params.daysSinceTrained) : undefined
  const fromCalendarGap = params.fromCalendarGap === '1'

  const [minutes, setMinutes] = useState<QuickMinutes>(
    QUICK_DURATIONS.includes(initialMinutes) ? initialMinutes : 15
  )
  const [purpose, setPurpose] = useState<QuickPurpose | null>(
    (params.purpose as QuickPurpose) || null
  )
  // A missed "leg day" suggestion arrives via route param, pattern-based
  // (e.g. 'squat') — kept exactly as before, distinct from the muscle-based
  // Target Area chips below, since the two mechanisms feed generateQuickWorkout
  // independently (targetPattern reorders priority; targetMuscles hard-filters).
  const [targetPattern, setTargetPattern] = useState<MovementPattern | undefined>(
    (params.targetPattern as MovementPattern) || undefined
  )
  const [targetMuscles, setTargetMuscles] = useState<string[] | undefined>(undefined)
  const [workout, setWorkout] = useState<QuickWorkout | null>(null)
  const [generating, setGenerating] = useState(true)
  const [starting, setStarting] = useState(false)
  const [empty, setEmpty] = useState(false)
  // Training style + equipment are real, useful, but not what a beginner needs
  // staring at on open — collapsed by default, auto-opened when a route param
  // already picked a purpose so that choice isn't hidden from the user.
  const [moreOpen, setMoreOpen] = useState(!!params.purpose)
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

  const regenerate = useCallback(async (
    m: QuickMinutes, p: QuickPurpose | null, equipOverride: Equipment[] | null,
    tp: MovementPattern | undefined, tm: string[] | undefined,
  ) => {
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
      // If the requested target (e.g. a missed "leg day" route param) is now
      // avoided because it's scheduled soon, drop it.
      const effectiveTarget = tp && restrictions.avoidPatterns.includes(tp) ? undefined : tp
      const effectivePurpose = p ?? goalToPurpose(profile.goal)
      const w = await generateQuickWorkout(
        supabase, userId,
        { minutes: m, purpose: effectivePurpose, targetPattern: effectiveTarget, targetMuscles: tm, daysSinceTrained, fromCalendarGap, restrictions },
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
  // daysSinceTrained / fromCalendarGap are stable per-mount params
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Pre-generate on open so a Start button is ready immediately (<10s to start).
  useEffect(() => {
    regenerate(minutes, purpose, null, targetPattern, targetMuscles)
  }, [regenerate]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentEquip = () => selectedPreset?.equipment ?? null
  const handlePickMinutes = (m: QuickMinutes) => {
    setMinutes(m)
    regenerate(m, purpose, currentEquip(), targetPattern, targetMuscles)
  }
  const handlePickPurpose = (p: QuickPurpose) => {
    const next = p === purpose ? null : p
    setPurpose(next)
    regenerate(minutes, next, currentEquip(), targetPattern, targetMuscles)
  }
  // Target Area chips are mutually exclusive with each other (and with a
  // route-driven targetPattern) — picking one clears whichever mechanism the
  // previous selection used. "Pick for me" is an explicit reset to Tempo's
  // normal purpose-driven pick, not a filter of its own.
  const handlePickTargetArea = (opt: TargetAreaOption) => {
    if (opt.surprise) {
      setTargetPattern(undefined)
      setTargetMuscles(undefined)
      regenerate(minutes, purpose, currentEquip(), undefined, undefined)
      return
    }
    const isActive = opt.pattern ? opt.pattern === targetPattern : (!!opt.muscles && opt.muscles === targetMuscles)
    const nextPattern = isActive ? undefined : opt.pattern
    const nextMuscles = isActive ? undefined : opt.muscles
    setTargetPattern(nextPattern)
    setTargetMuscles(nextMuscles)
    regenerate(minutes, purpose, currentEquip(), nextPattern, nextMuscles)
  }
  const handlePickPreset = (id: string | null) => {
    setSelectedPresetId(id)
    const pr = id ? presets.find((p) => p.id === id) ?? null : null
    regenerate(minutes, purpose, pr?.equipment ?? null, targetPattern, targetMuscles)
  }
  const handleSavePreset = async (preset: EquipmentPreset) => {
    const next = presets.some((p) => p.id === preset.id)
      ? presets.map((p) => (p.id === preset.id ? preset : p))
      : [...presets, preset]
    setPresets(next)
    setPresetSheet({ open: false, edit: null })
    setSelectedPresetId(preset.id)
    regenerate(minutes, purpose, preset.equipment, targetPattern, targetMuscles)
    await savePresets(supabase, userId, next)
  }
  const handleDeletePreset = async (id: string) => {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    setPresetSheet({ open: false, edit: null })
    if (selectedPresetId === id) { setSelectedPresetId(null); regenerate(minutes, purpose, null, targetPattern, targetMuscles) }
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

        {/* Duration — one slider instead of eight separate buttons */}
        <View style={styles.durationCard}>
          <Text style={styles.durationBig}>{minutes}<Text style={styles.durationUnit}> min</Text></Text>
          {/* durationCard centers its text (alignItems:'center'), which also
              collapses any child with no explicit width to its content size
              instead of stretching — the Slider's own track has no width of
              its own, so it needs an explicit full-width wrapper here rather
              than relying on the parent's default stretch behavior. */}
          <View style={styles.sliderWrap}>
            <Slider
              value={minutes}
              min={5}
              max={60}
              step={5}
              onChange={(v) => setMinutes(snapToQuickMinutes(v))}
              onSlidingComplete={(v) => handlePickMinutes(snapToQuickMinutes(v))}
              formatValue={(v) => `${snapToQuickMinutes(v)} min`}
              accessibilityLabel="Workout duration"
            />
          </View>
        </View>

        {/* Target Area — the primary, beginner-friendly decision (real body
            parts, not training-taxonomy jargon like "push"/"pull"). */}
        <Text style={styles.sectionLabel}>TARGET AREA</Text>
        <View style={styles.targetGrid}>
          {TARGET_AREA_OPTIONS.map(opt => {
            const active = opt.surprise
              ? !targetPattern && !targetMuscles
              : opt.pattern ? opt.pattern === targetPattern : (!!opt.muscles && opt.muscles === targetMuscles)
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.targetChip, active && styles.targetChipActive]}
                onPress={() => handlePickTargetArea(opt)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Ionicons name={opt.icon as any} size={17} color={active ? C.onPrimary : C.primary} />
                <Text style={[styles.targetChipText, active && styles.targetChipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Training style + equipment — real, but not what a beginner needs
            staring at by default. Tucked behind one disclosure instead of two
            more always-visible pill rows. */}
        <TouchableOpacity
          style={styles.moreToggle}
          onPress={() => setMoreOpen(v => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: moreOpen }}
          accessibilityLabel={moreOpen ? 'Show fewer options' : 'Show more options'}
        >
          <Text style={styles.moreToggleText}>{moreOpen ? 'Fewer options' : 'More options'}</Text>
          <Ionicons name={moreOpen ? 'chevron-up' : 'chevron-down'} size={15} color={C.textSecondary} />
        </TouchableOpacity>

        {moreOpen && (
          <>
            <Text style={styles.sectionLabel}>TRAINING STYLE</Text>
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
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={pm.label}
                  >
                    <Ionicons name={pm.icon as any} size={15} color={active ? C.onPrimary : C.primary} />
                    <Text style={[styles.purposeText, active && styles.purposeTextActive]}>{pm.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            <View style={styles.rowBetween}>
              <Text style={styles.sectionLabel}>EQUIPMENT</Text>
              {locked && <ProBadge />}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
              <TouchableOpacity
                style={[styles.presetChip, !selectedPresetId && styles.presetChipActive]}
                onPress={() => handlePickPreset(null)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: !selectedPresetId }}
                accessibilityLabel="All my gear"
              >
                <Ionicons name="home" size={14} color={!selectedPresetId ? C.onPrimary : C.primary} />
                <Text style={[styles.presetChipText, !selectedPresetId && styles.presetChipTextActive]}>All my gear</Text>
              </TouchableOpacity>
              {presets.map((pr) => {
                const on = selectedPresetId === pr.id
                return (
                  // A plain View wrapping two separate touch targets, not one
                  // nested inside the other — long-press-to-edit doesn't exist
                  // as a gesture on web, so editing needs its own real tap
                  // target, not just a gesture only native users can find.
                  <View key={pr.id} style={[styles.presetChip, on && styles.presetChipActive]}>
                    <TouchableOpacity
                      style={styles.presetChipMain}
                      onPress={() => handlePickPreset(pr.id)}
                      onLongPress={() => setPresetSheet({ open: true, edit: pr })}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={locked ? `${pr.name}, Pro` : pr.name}
                    >
                      <Ionicons name="cube" size={14} color={on ? C.onPrimary : C.primary} />
                      <Text style={[styles.presetChipText, on && styles.presetChipTextActive]} numberOfLines={1}>{pr.name}</Text>
                      {locked && <Ionicons name="lock-closed" size={11} color={on ? 'rgba(255,255,255,0.9)' : C.gold} />}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.presetChipEdit}
                      onPress={() => setPresetSheet({ open: true, edit: pr })}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit or delete ${pr.name}`}
                    >
                      <Ionicons name="pencil" size={12} color={on ? 'rgba(255,255,255,0.85)' : C.outline} />
                    </TouchableOpacity>
                  </View>
                )
              })}
              <TouchableOpacity
                style={styles.presetNew}
                onPress={() => setPresetSheet({ open: true, edit: null })}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="New equipment preset"
              >
                <Ionicons name="add" size={15} color={C.primary} />
                <Text style={styles.presetNewText}>New</Text>
              </TouchableOpacity>
            </ScrollView>
            {presets.length > 0 && (
              <Text style={styles.presetHint}>Tap the pencil on a preset to edit or delete it.</Text>
            )}
          </>
        )}

        {/* No preview card by design — Start goes straight into the runner,
            which has full swap/skip/remove tools the old read-only preview
            never did. Only an actual problem gets a message here. */}
        {generating ? (
          <PulseLoader caption="Building your session…" />
        ) : empty ? (
          <View style={styles.emptyRow}>
            <Ionicons name="alert-circle-outline" size={20} color={C.textSecondary} />
            <Text style={styles.emptyText}>
              No moves match your equipment for this target area. Try another area, or add equipment under More options.
            </Text>
          </View>
        ) : null}
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
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 120, gap: Spacing.md },

  lead: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.3, marginTop: Spacing.xs },
  coachWalking: { marginBottom: Spacing.xs },
  leadSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 20 },

  durationCard: {
    alignItems: 'center', backgroundColor: C.background, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm, paddingBottom: Spacing.xs, ...CardShadow,
  },
  durationBig: { fontFamily: C.fontDisplay, fontSize: 40, color: C.text, letterSpacing: -1 },
  durationUnit: { fontFamily: 'Inter_500Medium', fontSize: 16, color: C.textSecondary },
  sliderWrap: { alignSelf: 'stretch', width: '100%' },

  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  targetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  targetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  targetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  targetChipText: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  targetChipTextActive: { color: C.onPrimary },

  moreToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: Spacing.xs, marginTop: Spacing.xs,
  },
  moreToggleText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },

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
  presetRow: { gap: Spacing.xs, paddingRight: Spacing.lg, paddingVertical: 2 },
  // Used directly (as a single TouchableOpacity) by "All my gear," and as a
  // container (View wrapping two separate touch targets: select + edit) for
  // a saved preset — see presetChipMain/presetChipEdit.
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 200,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  presetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  presetChipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text, flexShrink: 1 },
  presetChipTextActive: { color: C.onPrimary },
  presetChipMain: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  presetChipEdit: { marginLeft: 6, paddingHorizontal: 2, paddingVertical: 2 },
  presetNew: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: C.primaryLine, borderStyle: 'dashed',
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  presetNewText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  presetHint: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.outline, lineHeight: 16 },

  emptyRow: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'flex-start',
  },
  emptyText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },

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
