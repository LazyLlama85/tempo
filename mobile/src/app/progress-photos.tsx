// Tempo — Progress Photos (modal).
//
// Every progress photo ever attached to a body-measurement entry, in order, so
// they don't just disappear after being taken (2026-07-17 founder report). The
// capture flow (Profile → Body Stats → Log Measurement) already stores one photo
// per entry in the private `progress-photos` Storage bucket; this is the first
// screen that reads them back as a timeline instead of a single same-session
// preview. Signed URLs are batch-resolved (one storage call, not one per photo).

import { useCallback, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Image } from 'expo-image'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { FadeInView } from '@/components/motion'
import { fetchMeasurements } from '@/lib/bodyMeasurements'
import { progressPhotoUrls } from '@/lib/progressPhotos'
import { useWeightUnit, unitLabel, displayWeight } from '@/lib/units'
import type { BodyMeasurement } from '@/types'

interface PhotoEntry {
  measurement: BodyMeasurement
  url: string
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProgressPhotosScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const unit = useWeightUnit()

  const [entries, setEntries] = useState<PhotoEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PhotoEntry | null>(null)

  const load = useCallback(() => {
    if (!userId) return
    setLoading(true)
    fetchMeasurements(supabase, userId)
      .then(async (all) => {
        const withPhoto = all.filter((m) => !!m.photo_url)
        const urls = await progressPhotoUrls(supabase, withPhoto.map((m) => m.photo_url as string))
        setEntries(
          withPhoto
            .filter((m) => urls[m.photo_url as string])
            .map((m) => ({ measurement: m, url: urls[m.photo_url as string] })),
        )
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [userId])

  useFocusEffect(useCallback(() => { load() }, [load]))

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Progress Photos"
        size="sm"
        leading={<DismissButton onPress={() => selected ? setSelected(null) : router.back()} kind={selected ? 'x' : 'back'} label="Close" />}
      />

      {selected ? (
        <View style={styles.viewer}>
          <Image source={{ uri: selected.url }} style={styles.viewerImage} contentFit="contain" />
          <View style={styles.viewerCaption}>
            <Text style={styles.viewerDate}>{dateLabel(selected.measurement.measured_at)}</Text>
            {selected.measurement.weight_lbs != null && (
              <Text style={styles.viewerWeight}>{displayWeight(selected.measurement.weight_lbs, unit)} {unitLabel(unit)}</Text>
            )}
          </View>
        </View>
      ) : loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your photos…" /></View>
      ) : entries.length === 0 ? (
        <EmptyState
          kind="chart"
          title="No progress photos yet"
          body="Attach a photo the next time you log a measurement from Profile → Body Stats, and it'll show up here, in order."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {entries.map((e, i) => (
            <FadeInView key={e.measurement.id} delay={Math.min(i * 40, 400)} style={styles.tileWrap}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => setSelected(e)}>
                <Image source={{ uri: e.url }} style={styles.tile} contentFit="cover" />
                <Text style={styles.tileDate} numberOfLines={1}>{dateLabel(e.measurement.measured_at)}</Text>
                {e.measurement.weight_lbs != null && (
                  <Text style={styles.tileWeight}>{displayWeight(e.measurement.weight_lbs, unit)} {unitLabel(unit)}</Text>
                )}
              </TouchableOpacity>
            </FadeInView>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const TILE_GAP = 10
const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP,
    padding: Spacing.containerPadding, paddingBottom: Spacing.xl,
  },
  tileWrap: { width: '31%' },
  tile: { width: '100%', aspectRatio: 3 / 4, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow },
  tileDate: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.text, marginTop: 4 },
  tileWeight: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: C.textSecondary },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  viewerImage: { width: '100%', flex: 1, borderRadius: Radius.lg },
  viewerCaption: { alignItems: 'center', paddingVertical: Spacing.md },
  viewerDate: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  viewerWeight: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary, marginTop: 2 },
})
