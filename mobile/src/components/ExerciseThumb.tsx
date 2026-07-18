// Tempo — small exercise GIF preview for list rows (library, picker, builder), so
// a name in a list of near-identical variants ("Barbell Bench Press" vs "Close-Grip
// Bench Press") is recognizable before tapping, not just readable.
//
// Falls back to the generic movement icon both when no GIF is cached yet (only a
// fraction of the 1,300+ exercise library has been backfilled so far — see
// scripts/backfill-exercise-media.mjs) and when the cached URL actually fails to
// load (a not-yet-cached id still resolves to a URL that 404s) — "no clip beats a
// wrong clip" per data/exerciseMedia.ts.

import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Radius, type Palette } from '@/constants/theme'
import { getExerciseGifSource } from '@/data/exerciseMedia'

interface Props {
  exerciseId: string
  isCustom?: boolean
  size?: number
  C: Palette
}

export function ExerciseThumb({ exerciseId, isCustom, size = 40, C }: Props) {
  const [failed, setFailed] = useState(false)
  const source = failed ? null : getExerciseGifSource(exerciseId)
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow },
      ]}
    >
      {source ? (
        <Image
          source={source}
          style={{ width: size, height: size }}
          contentFit="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons name={isCustom ? 'construct-outline' : 'barbell-outline'} size={size * 0.45} color={C.primary} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
})
