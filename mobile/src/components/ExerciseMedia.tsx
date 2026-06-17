import { useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { getExerciseGifSource, getExerciseMedia } from '@/data/exerciseMedia'

const C = Colors.light

interface Props {
  exerciseId: string | null | undefined
  height?: number
  rounded?: boolean
  showNote?: boolean
  resolution?: 180 | 360 | 720
}

// Renders an exercise's form-guide GIF when we have a verified clip, otherwise a
// neutral illustration — we never show a demo that isn't the right movement.
export function ExerciseMedia({
  exerciseId,
  height = 180,
  rounded = true,
  showNote = true,
  resolution = 360,
}: Props) {
  const source = getExerciseGifSource(exerciseId, resolution)
  const media = getExerciseMedia(exerciseId)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const radius = rounded ? Radius.lg : 0

  if (!source || failed) {
    return (
      <View style={[styles.well, { height, borderRadius: radius }]}>
        <Ionicons name="barbell-outline" size={44} color={C.outlineVariant} />
        <Text style={styles.fallbackText}>Form video coming soon</Text>
      </View>
    )
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.imageWrap, { height, borderRadius: radius }]}>
        <Image
          source={source}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          transition={180}
          cachePolicy="memory-disk"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
        {!loaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={C.primary} />
          </View>
        )}
      </View>
      {showNote && media?.note ? (
        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={13} color={C.outline} />
          <Text style={styles.note}>{media.note}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  well: {
    backgroundColor: C.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  fallbackText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline },
  imageWrap: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.outlineVariant,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  note: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, lineHeight: 16 },
})
