import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'

const C = Colors.light

// Structural prop type so this component doesn't couple to the session screen's
// internal ExerciseRow — anything with these fields works.
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {exercise && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              {/* Title */}
              <Text style={styles.eyebrow}>{exercise.movement_pattern.toUpperCase()} · FORM GUIDE</Text>
              <Text style={styles.title}>{exercise.name}</Text>

              {/* Form media well (image placeholder; opens video if available) */}
              <TouchableOpacity
                style={styles.mediaWell}
                activeOpacity={exercise.video_url ? 0.8 : 1}
                onPress={() => exercise.video_url && Linking.openURL(exercise.video_url)}
                disabled={!exercise.video_url}
              >
                <Ionicons name="barbell-outline" size={48} color={C.outlineVariant} />
                {exercise.video_url && (
                  <View style={styles.playPill}>
                    <Ionicons name="play" size={13} color="#fff" />
                    <Text style={styles.playPillText}>Watch form guide</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Muscles worked */}
              <Text style={styles.sectionLabel}>MUSCLES WORKED</Text>
              <View style={styles.chipRow}>
                {exercise.primary_muscles.map(m => (
                  <View key={m} style={styles.musclePrimary}>
                    <Text style={styles.musclePrimaryText}>{m}</Text>
                  </View>
                ))}
                {exercise.secondary_muscles.map(m => (
                  <View key={m} style={styles.muscleSecondary}>
                    <Text style={styles.muscleSecondaryText}>{m}</Text>
                  </View>
                ))}
              </View>

              {/* Instructions */}
              {exercise.instructions.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>HOW TO DO IT</Text>
                  <View style={{ gap: Spacing.sm }}>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(27,27,28,0.45)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '88%',
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding,
    paddingBottom: Spacing.lg,
  },
  handle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.md },
  scroll: { gap: Spacing.sm, paddingBottom: Spacing.md },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, color: C.text, letterSpacing: -0.4, marginBottom: Spacing.xs },
  mediaWell: {
    height: 160, borderRadius: Radius.lg, backgroundColor: C.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  playPill: {
    position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(27,27,28,0.72)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6,
  },
  playPillText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#fff' },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  musclePrimary: { backgroundColor: '#EFF4FF', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  musclePrimaryText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary, textTransform: 'capitalize' },
  muscleSecondary: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  muscleSecondaryText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize' },
  stepRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  stepNum: { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.onPrimary },
  stepText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21 },
  equipChip: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  equipChipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize' },
  closeBtn: { height: 52, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  closeBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
