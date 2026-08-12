// Tempo — small exercise GIF preview for list rows (library, picker, builder), so
// a name in a list of near-identical variants ("Barbell Bench Press" vs "Close-Grip
// Bench Press") is recognizable before tapping, not just readable.
//
// Falls back to the generic movement icon both when no GIF is cached yet (only a
// fraction of the 1,300+ exercise library has been backfilled so far — see
// scripts/backfill-exercise-media.mjs) and when the cached URL actually fails to
// load (a not-yet-cached id still resolves to a URL that 404s) — "no clip beats a
// wrong clip" per data/exerciseMedia.ts.
//
// Fixed 2026-08-12, founder-reported ("GIFs take so long to load"): unlike
// ExerciseMedia (the big form-guide clip), this thumbnail never set a
// `cachePolicy`, so expo-image fell back to its default rather than persisting
// the decoded GIF to disk — every re-visit to the library/picker/builder was a
// full re-fetch from Supabase Storage of the same handful of exercises, over and
// over. These GIFs are un-resized originals from ExerciseDB (real fix for THAT
// is a backfill-pipeline change — re-encoding/resizing ~700 already-uploaded
// files — out of scope here), so caching what's already been paid for once is
// the safe, immediate win: `memory-disk`, matching ExerciseMedia's own policy.

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
          cachePolicy="memory-disk"
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
