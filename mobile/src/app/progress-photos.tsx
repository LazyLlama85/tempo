// Tempo — Progress Photos (modal).
//
// Every progress photo ever attached to a body-measurement entry, in order, so
// they don't just disappear after being taken (2026-07-17 founder report). The
// capture flow (Profile → Body Stats → Log Measurement) already stores one photo
// per entry in the private `progress-photos` Storage bucket; this is the first
// screen that reads them back as a timeline instead of a single same-session
// preview. Signed URLs are batch-resolved (one storage call, not one per photo).

import { useCallback, useRef, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { FadeInView } from '@/components/motion'
import { fetchMeasurements } from '@/lib/bodyMeasurements'
import { progressPhotoUrls } from '@/lib/progressPhotos'
import { useWeightUnit, unitLabel, displayWeight } from '@/lib/units'
import { PhotoCompareView, type ComparePhoto } from '@/components/PhotoCompareView'
import { track } from '@/lib/analytics'
import type { BodyMeasurement } from '@/types'

// react-native-view-shot / expo-sharing are native modules — lazy-require so a
// client that predates them (or a simulator without the module) degrades to a
// friendly message instead of crashing this screen at import (same pattern as
// components/ShareCardSheet.tsx).
type NativeShare = {
  captureRef: (ref: unknown, opts: Record<string, unknown>) => Promise<string>
  Sharing: { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: Record<string, unknown>) => Promise<void> }
}
function loadNativeShare(): NativeShare | null {
  try {
    return {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      captureRef: require('react-native-view-shot').captureRef,
      Sharing: require('expo-sharing'),
    }
  } catch {
    return null
  }
}

interface PhotoEntry {
  measurement: BodyMeasurement
  url: string
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toComparePhoto(e: PhotoEntry, unit: ReturnType<typeof useWeightUnit>): ComparePhoto {
  return {
    url: e.url,
    label: dateLabel(e.measurement.measured_at),
    sub: e.measurement.weight_lbs != null ? `${displayWeight(e.measurement.weight_lbs, unit)} ${unitLabel(unit)}` : undefined,
  }
}

export default function ProgressPhotosScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const unit = useWeightUnit()

  const [entries, setEntries] = useState<PhotoEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PhotoEntry | null>(null)

  // Compare mode (§26, L25): pick two tiles from the grid, then a drag-reveal
  // before/after — the most shareable artifact this app can produce.
  const [picking, setPicking] = useState(false)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [comparePair, setComparePair] = useState<[PhotoEntry, PhotoEntry] | null>(null)
  const [sharing, setSharing] = useState(false)
  const compareRef = useRef<View>(null)

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

  const exitPicking = () => { setPicking(false); setPickedIds([]) }

  const toggleCompareOpen = () => {
    if (picking) { exitPicking(); return }
    if (comparePair) { setComparePair(null); return }
    setPicking(true)
  }

  const onTileTap = (e: PhotoEntry) => {
    if (!picking) { setSelected(e); return }
    setPickedIds((prev) => {
      if (prev.includes(e.measurement.id)) return prev.filter((id) => id !== e.measurement.id)
      if (prev.length >= 2) return prev
      const next = [...prev, e.measurement.id]
      if (next.length === 2) {
        // measured_at descending (fetchMeasurements' own order) — always put
        // the earlier date on the left regardless of tap order.
        const [a, b] = next.map((id) => entries.find((x) => x.measurement.id === id)!)
        const pair: [PhotoEntry, PhotoEntry] = a.measurement.measured_at <= b.measurement.measured_at ? [a, b] : [b, a]
        setPicking(false)
        setComparePair(pair)
        track('progress_photo_compared')
      }
      return next
    })
  }

  const handleShare = async () => {
    if (!comparePair || sharing) return
    const native = loadNativeShare()
    if (!native) {
      Alert.alert('Update needed', 'Image sharing comes with the latest app build.')
      return
    }
    setSharing(true)
    try {
      const uri = await native.captureRef(compareRef, { format: 'png', quality: 1, result: 'tmpfile' })
      if (!(await native.Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', "Sharing isn't available on this device.")
        return
      }
      await native.Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your progress' })
    } catch {
      Alert.alert("Couldn't share", 'Something went wrong creating the image. Please try again.')
    } finally {
      setSharing(false)
    }
  }

  const headerTitle = comparePair ? 'Compare' : picking ? `Select 2 photos (${pickedIds.length}/2)` : 'Progress Photos'
  const closeAction = () => {
    if (comparePair) { setComparePair(null); return }
    if (picking) { exitPicking(); return }
    if (selected) { setSelected(null); return }
    router.back()
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={headerTitle}
        size="sm"
        leading={<DismissButton onPress={closeAction} kind={selected || comparePair || picking ? 'x' : 'back'} label="Close" />}
        right={
          !selected && !comparePair && entries.length >= 2 ? (
            <TouchableOpacity onPress={toggleCompareOpen} hitSlop={8} accessibilityRole="button" accessibilityLabel={picking ? 'Cancel compare' : 'Compare photos'}>
              <Text style={styles.compareLink}>{picking ? 'Cancel' : 'Compare'}</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      {comparePair ? (
        <ScrollView contentContainerStyle={styles.compareScroll}>
          <View ref={compareRef} collapsable={false} style={styles.compareCapture}>
            <PhotoCompareView before={toComparePhoto(comparePair[0], unit)} after={toComparePhoto(comparePair[1], unit)} />
          </View>
          <Text style={styles.compareHint}>Drag the handle to compare.</Text>
          <TouchableOpacity
            style={[styles.shareBtn, sharing && { opacity: 0.6 }]}
            onPress={handleShare}
            disabled={sharing}
            activeOpacity={0.85}
          >
            {sharing ? <ActivityIndicator color={C.onPrimary} /> : (
              <>
                <Ionicons name="share-outline" size={18} color={C.onPrimary} />
                <Text style={styles.shareBtnText}>Share</Text>
              </>
            )}
          </TouchableOpacity>
          <View style={{ height: Math.max(insets.bottom, Spacing.md) }} />
        </ScrollView>
      ) : selected ? (
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
          {picking && (
            <Text style={styles.pickHint}>Tap an earlier photo, then a later one — earliest becomes "before".</Text>
          )}
          {entries.map((e, i) => {
            const pickIndex = pickedIds.indexOf(e.measurement.id)
            const picked = pickIndex >= 0
            return (
              <FadeInView key={e.measurement.id} delay={Math.min(i * 40, 400)} style={styles.tileWrap}>
                <TouchableOpacity activeOpacity={0.85} onPress={() => onTileTap(e)}>
                  <Image source={{ uri: e.url }} style={[styles.tile, picked && styles.tilePicked]} contentFit="cover" />
                  {picked && (
                    <View style={styles.pickBadge}>
                      <Text style={styles.pickBadgeText}>{pickIndex + 1}</Text>
                    </View>
                  )}
                  <Text style={styles.tileDate} numberOfLines={1}>{dateLabel(e.measurement.measured_at)}</Text>
                  {e.measurement.weight_lbs != null && (
                    <Text style={styles.tileWeight}>{displayWeight(e.measurement.weight_lbs, unit)} {unitLabel(unit)}</Text>
                  )}
                </TouchableOpacity>
              </FadeInView>
            )
          })}
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

  compareLink: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: C.primary },
  pickHint: { width: '100%', fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, marginBottom: Spacing.xs, lineHeight: 18 },
  tilePicked: { borderWidth: 2.5, borderColor: C.primary },
  pickBadge: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  pickBadgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: C.onPrimary },

  compareScroll: { padding: Spacing.containerPadding, alignItems: 'center' },
  compareCapture: { width: '100%' },
  compareHint: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, marginTop: Spacing.sm, textAlign: 'center' },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    height: 52, width: '100%', backgroundColor: C.primary, borderRadius: Radius.lg, marginTop: Spacing.lg,
  },
  shareBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
