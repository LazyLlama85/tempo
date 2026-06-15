import { useEffect, useRef, useState } from 'react'
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Linking, Animated,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { fetchExerciseId, gifSource } from '@/lib/exerciseGif'

const C = Colors.light

export interface FormExercise {
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
  const visible = exercise !== null
  const [gifId, setGifId] = useState<string | null>(null)
  const [gifLoading, setGifLoading] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const pulseAnim = useRef(new Animated.Value(0.4)).current
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (!exercise) {
      setGifId(null)
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {exercise && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scroll}
              bounces={false}
            >
              {/* Title */}
              <Text style={styles.eyebrow}>
                {exercise.movement_pattern.replace(/_/g, ' ').toUpperCase()} · FORM GUIDE
              </Text>
              <Text style={styles.title}>{exercise.name}</Text>

              {/* GIF hero */}
              <View style={styles.mediaContainer}>
                {/* Loading skeleton */}
                {gifLoading && (
                  <Animated.View style={[styles.skeleton, { opacity: pulseAnim }]}>
                    <View style={styles.skeletonIcon}>
                      <Ionicons name="barbell-outline" size={36} color={C.outlineVariant} />
                    </View>
                    <Text style={styles.skeletonText}>Loading form guide…</Text>
                  </Animated.View>
                )}

                {/* GIF with fade-in */}
                {!gifLoading && gifId && (
                  <Animated.View style={[styles.gifWrapper, { opacity: fadeAnim }]}>
                    <Image
                      source={gifSource(gifId)}
                      style={styles.gifImage}
                      contentFit="contain"
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
                {!gifLoading && !gifId && (
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
              {exercise.instructions.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>HOW TO DO IT</Text>
                  <View style={styles.stepList}>
                    {exercise.instructions.map((step, i) => (
                      <View key={i} style={styles.stepRow}>
                        <View style={styles.stepNum}>
                          <Text style={styles.stepNumText}>{i + 1}</Text>
                        </View>
                        <Text style={styles.stepText}>{step}</Text>
                      </View>
                    ))}
                  </View>
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
            </ScrollView>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,12,0.6)',
    justifyContent: 'flex-end',
  },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding,
    paddingBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 20,
  },
  handle: {
    width: 36, height: 4, borderRadius: Radius.full,
    backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.lg,
  },
  scroll: { gap: Spacing.sm, paddingBottom: Spacing.md },

  eyebrow: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text,
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
  stepList: { gap: 10 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0,
  },
  stepNumText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: C.onPrimary },
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

  // Done button
  closeBtn: {
    height: 54, backgroundColor: C.primary, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  closeBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
