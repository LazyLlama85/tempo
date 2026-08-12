import { useEffect, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity,
  StyleSheet, Linking, Animated, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { TempoSheet } from '@/components/TempoSheet'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { fetchExerciseId, gifSource } from '@/lib/exerciseGif'
import { getExerciseGifSource, getExerciseMedia } from '@/data/exerciseMedia'
import { exdbIdForExercise, fetchRemoteInstructions } from '@/lib/exerciseDb'


export interface FormExercise {
  id?: string
  name: string
  movement_pattern: string
  primary_muscles: string[]
  secondary_muscles: string[]
  required_equipment: string[]
  instructions: string[]
  video_url: string | null
}

interface Props {
  exercise: FormExercise | null
  onClose: () => void
}

export function ExerciseFormSheet({ exercise, onClose }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const visible = exercise !== null
  // The verified clip for this movement, by id: our own bundled GIF for the 8 the
  // remote library lacked, or the curated ExerciseDB clip for everything else.
  // Shown directly — far more reliable than a fuzzy name search.
  const curated = getExerciseGifSource(exercise?.id)
  const curatedNote = getExerciseMedia(exercise?.id)?.note ?? null
  // The curated/derived clip's <Image> had NO error handling at all — a single
  // failed request (RapidAPI rate limit, a transient network hiccup, an id the
  // image endpoint doesn't have) rendered nothing with no fallback, which reads
  // as "this exercise has no GIF" even though the vast majority genuinely have
  // one. Retry the exact same request once (remount via `key`), then fall back
  // to the illustration so a real gap and a transient blip don't look identical.
  const [curatedRetry, setCuratedRetry] = useState(0)
  const [curatedFailed, setCuratedFailed] = useState(false)
  useEffect(() => { setCuratedRetry(0); setCuratedFailed(false) }, [exercise?.id])
  const handleCuratedError = () => {
    setCuratedRetry((n) => {
      if (n < 1) return n + 1
      setCuratedFailed(true)
      return n
    })
  }
  const [gifId, setGifId] = useState<string | null>(null)
  const [gifLoading, setGifLoading] = useState(false)
  // Imported-library rows keep their steps in ExerciseDB, not the DB (the seed
  // stays small that way) — fetch them the first time the guide opens.
  const [remoteSteps, setRemoteSteps] = useState<string[]>([])
  const [stepsLoading, setStepsLoading] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const pulseAnim = useRef(new Animated.Value(0.4)).current
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    setRemoteSteps([])
    if (!exercise || exercise.instructions.length > 0) { setStepsLoading(false); return }
    const exdbId = exdbIdForExercise(exercise.id)
    if (!exdbId) { setStepsLoading(false); return }
    let cancelled = false
    setStepsLoading(true)
    fetchRemoteInstructions(exdbId, exercise.id).then(steps => {
      if (cancelled) return
      setRemoteSteps(steps)
      setStepsLoading(false)
    })
    return () => { cancelled = true }
  }, [exercise?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = exercise?.instructions.length ? exercise.instructions : remoteSteps

  useEffect(() => {
    if (!exercise) {
      setGifId(null)
      return
    }
    // We have a verified clip by id — skip the name lookup entirely.
    if (getExerciseGifSource(exercise.id)) {
      setGifId(null)
      setGifLoading(false)
      return
    }
    setGifLoading(true)
    fadeAnim.setValue(0)

    fetchExerciseId(exercise.name).then(id => {
      setGifId(id)
      setGifLoading(false)
      if (id) {
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }).start()
      }
    })
  }, [exercise?.name])

  useEffect(() => {
    pulseLoop.current?.stop()
    if (!gifLoading) { pulseAnim.setValue(0.4); return }
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    )
    pulseLoop.current.start()
    return () => pulseLoop.current?.stop()
  }, [gifLoading])

  return (
    // `scroll`: TempoSheet's own BottomSheetScrollView is the single top-level
    // scroll container (gorhom's non-scroll BottomSheetView has no bottom/height
    // in its default style, so a *nested* scroll view inside it never gets a
    // bounded viewport to scroll within — the whole form guide, including "Done"
    // below it, would render at full content height and anything past the 92%
    // snap point was clipped and unreachable for exercises with long
    // instructions). "Done" now lives as the last scrollable item instead of a
    // separately-pinned footer — reachable the same way the rest of the guide is.
    <TempoSheet visible={visible} onClose={onClose} snapPoints={['92%']} scroll>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        {exercise && (
          <>
              {/* Title */}
              <Text style={styles.eyebrow}>
                {exercise.movement_pattern.replace(/_/g, ' ').toUpperCase()} · FORM GUIDE
              </Text>
              <Text style={styles.title}>{exercise.name}</Text>

              {/* GIF hero */}
              <View style={styles.mediaContainer}>
                {/* Verified clip by id (local or curated) — shown directly */}
                {curated && !curatedFailed && (
                  <View style={styles.gifWrapper}>
                    <Image
                      key={curatedRetry}
                      source={curated}
                      style={styles.gifImage}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      onError={handleCuratedError}
                    />
                    {exercise.video_url && (
                      <TouchableOpacity
                        style={styles.playPill}
                        onPress={() => Linking.openURL(exercise.video_url!)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="play-circle" size={15} color="#fff" />
                        <Text style={styles.playPillText}>Watch video</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Loading skeleton */}
                {(!curated || curatedFailed) && gifLoading && (
                  <Animated.View style={[styles.skeleton, { opacity: pulseAnim }]}>
                    <View style={styles.skeletonIcon}>
                      <Ionicons name="barbell-outline" size={36} color={C.outlineVariant} />
                    </View>
                    <Text style={styles.skeletonText}>Loading form guide…</Text>
                  </Animated.View>
                )}

                {/* GIF with fade-in */}
                {(!curated || curatedFailed) && !gifLoading && gifId && (
                  <Animated.View style={[styles.gifWrapper, { opacity: fadeAnim }]}>
                    <Image
                      source={gifSource(gifId)}
                      style={styles.gifImage}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                    {exercise.video_url && (
                      <TouchableOpacity
                        style={styles.playPill}
                        onPress={() => Linking.openURL(exercise.video_url!)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="play-circle" size={15} color="#fff" />
                        <Text style={styles.playPillText}>Watch video</Text>
                      </TouchableOpacity>
                    )}
                  </Animated.View>
                )}

                {/* No GIF fallback */}
                {(!curated || curatedFailed) && !gifLoading && !gifId && (
                  <TouchableOpacity
                    style={styles.noGifFallback}
                    activeOpacity={exercise.video_url ? 0.8 : 1}
                    onPress={() => exercise.video_url && Linking.openURL(exercise.video_url)}
                    disabled={!exercise.video_url}
                  >
                    <Ionicons name="barbell-outline" size={44} color={C.outlineVariant} />
                    {exercise.video_url && (
                      <View style={styles.playPill}>
                        <Ionicons name="play-circle" size={15} color="#fff" />
                        <Text style={styles.playPillText}>Watch form guide</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {/* Caveat when the clip is a close variant (e.g. loaded version) */}
              {curated && !curatedFailed && curatedNote && (
                <View style={styles.noteRow}>
                  <Ionicons name="information-circle-outline" size={13} color={C.outline} />
                  <Text style={styles.noteText}>{curatedNote}</Text>
                </View>
              )}

              {/* Muscles worked */}
              <Text style={styles.sectionLabel}>MUSCLES WORKED</Text>
              <View style={styles.chipRow}>
                {exercise.primary_muscles.map(m => (
                  <View key={m} style={styles.musclePrimary}>
                    <View style={styles.muscleDot} />
                    <Text style={styles.musclePrimaryText}>{m}</Text>
                  </View>
                ))}
                {exercise.secondary_muscles.map(m => (
                  <View key={m} style={styles.muscleSecondary}>
                    <Text style={styles.muscleSecondaryText}>{m}</Text>
                  </View>
                ))}
              </View>

              {/* Step-by-step instructions */}
              {(steps.length > 0 || stepsLoading) && (
                <>
                  <Text style={styles.sectionLabel}>HOW TO DO IT</Text>
                  {stepsLoading ? (
                    <View style={styles.stepsLoadingRow}>
                      <ActivityIndicator size="small" color={C.primary} />
                      <Text style={styles.stepsLoadingText}>Loading steps…</Text>
                    </View>
                  ) : (
                    <View style={styles.stepList}>
                      {steps.map((step, i) => (
                        <View key={i} style={styles.stepRow}>
                          <View style={styles.stepNum}>
                            <Text style={styles.stepNumText}>{i + 1}</Text>
                          </View>
                          <Text style={styles.stepText}>{step}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}

              {/* Equipment */}
              {exercise.required_equipment.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>EQUIPMENT</Text>
                  <View style={styles.chipRow}>
                    {exercise.required_equipment.map(e => (
                      <View key={e} style={styles.equipChip}>
                        <Ionicons name="barbell-outline" size={11} color={C.textSecondary} />
                        <Text style={styles.equipChipText}>{e.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {/* Only real DB rows (not the odd caller building a FormExercise without
                  an id) have set_logs to chart. Reuses the existing exercise-progress
                  screen (est. 1RM trend + PR forecast) — this is just a new entry
                  point into it, not a second history view. */}
              {exercise.id && (
                <TouchableOpacity
                  style={styles.historyBtn}
                  onPress={() => {
                    const id = exercise.id!
                    const name = exercise.name
                    onClose()
                    router.push({ pathname: '/exercise-progress', params: { exerciseId: id, name } })
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`See ${exercise.name} training history`}
                >
                  <Ionicons name="stats-chart-outline" size={16} color={C.primary} />
                  <Text style={styles.historyBtnText}>See training history</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
                <Text style={styles.closeBtnText}>Done</Text>
              </TouchableOpacity>
          </>
        )}
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding,
    paddingBottom: Spacing.lg,
  },

  eyebrow: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  title: {
    fontFamily: C.fontDisplay, fontSize: 28, color: C.text,
    letterSpacing: -0.5, marginBottom: Spacing.xs,
  },

  // ── GIF hero ───────────────────────────────────────────────────────────────
  mediaContainer: {
    height: 230,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#F5F7FF',
    borderWidth: 1,
    borderColor: C.outlineVariant,
    marginBottom: Spacing.sm,
  },
  skeleton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  skeletonIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  skeletonText: {
    fontFamily: 'Inter_500Medium', fontSize: 13, color: C.outline,
  },
  gifWrapper: {
    flex: 1,
  },
  gifImage: {
    width: '100%',
    height: '100%',
  },
  noGifFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPill: {
    position: 'absolute', bottom: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(15,15,20,0.76)',
    borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  playPillText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#fff' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -2, marginBottom: 2 },
  noteText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, lineHeight: 16 },

  // ── Sections ───────────────────────────────────────────────────────────────
  sectionLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline,
    letterSpacing: 0.8, marginTop: Spacing.sm,
  },

  // Muscles
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  musclePrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#EEF3FF',
    borderRadius: Radius.full, paddingHorizontal: 11, paddingVertical: 6,
    borderWidth: 1, borderColor: '#D0DCFF',
  },
  muscleDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary,
  },
  musclePrimaryText: {
    fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary, textTransform: 'capitalize',
  },
  muscleSecondary: {
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.full, paddingHorizontal: 11, paddingVertical: 6,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  muscleSecondaryText: {
    fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize',
  },

  // Steps
  stepsLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  stepsLoadingText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.outline },
  stepList: { gap: 10 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0,
  },
  stepNumText: { fontFamily: C.fontDisplay, fontSize: 12, color: C.onPrimary },
  stepText: {
    flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14,
    color: C.textSecondary, lineHeight: 22,
  },

  // Equipment
  equipChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.full, paddingHorizontal: 11, paddingVertical: 6,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  equipChipText: {
    fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize',
  },

  // History link
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 46, borderRadius: Radius.lg, marginTop: Spacing.xs,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  historyBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },

  // Done button
  closeBtn: {
    height: 54, backgroundColor: C.primary, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  closeBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
