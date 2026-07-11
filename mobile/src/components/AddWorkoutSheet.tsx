// Tempo — Add Workout (bottom sheet).
//
// The calendar's "schedule something" entry point. Pick how to add a workout to a
// chosen day: build a new one, reuse a saved workout, or start from a template. All
// three route into the workout builder (which owns the date/time + scheduling), with
// the tapped calendar day pre-filled.

import { useCallback, useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TempoSheet } from '@/components/TempoSheet'
import { TempoPulse } from '@/components/brand'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { fetchTemplates } from '@/lib/workoutBuilder'
import { WORKOUT_PRESETS } from '@/lib/starterTemplates'
import type { WorkoutTemplate } from '@/types'

interface Props {
  visible: boolean
  userId: string
  client: SupabaseClient
  date: string            // 'YYYY-MM-DD' — the day to schedule on
  onClose: () => void
}

export function AddWorkoutSheet({ visible, userId, client, date, onClose }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    if (!userId) return
    setLoading(true)
    fetchTemplates(client, userId).then(setTemplates).finally(() => setLoading(false))
  }, [client, userId])

  // Refresh saved workouts each time the sheet opens (a just-built one shows up).
  useEffect(() => { if (visible) load() }, [visible, load])

  const go = (params: Record<string, string>) => {
    // Close the sheet first, then navigate on the next tick. Pushing a screen while
    // this RN Modal is still mounted can leave the target screen blank / not loading.
    onClose()
    setTimeout(() => router.push({ pathname: '/workout-builder', params: { date, ...params } } as any), 80)
  }

  const niceDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    // `scroll`: content is one flat scrollable flow (not a BottomSheetScrollView
    // nested inside TempoSheet's own non-scrolling BottomSheetView) — gorhom's
    // BottomSheetView has no bottom/height in its default style, so a fixed
    // snapPoints sheet with a *nested* scroll view never gets a bounded height to
    // scroll within: the list just renders at full content height and anything
    // past the 88% snap point is clipped with no way to reach it (saved workouts /
    // templates below the fold). Folding the header into the scroll content (as
    // TempoSheet's other working `scroll` sheets already do) fixes that.
    <TempoSheet visible={visible} onClose={onClose} snapPoints={['88%']} scroll>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Add a workout</Text>
            <Text style={styles.subtitle}>{niceDate}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={C.textSecondary} /></TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.primaryRow} onPress={() => go({})} activeOpacity={0.85}>
          <View style={styles.iconWrap}><Ionicons name="add" size={20} color={C.onPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.primaryRowTitle}>Build a new workout</Text>
            <Text style={styles.primaryRowSub}>Pick exercises and schedule it</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.onPrimary} />
        </TouchableOpacity>

        <Text style={styles.section}>YOUR SAVED WORKOUTS</Text>
        {loading ? (
          <View style={{ paddingVertical: Spacing.md, alignItems: 'center' }}><TempoPulse size={26} /></View>
        ) : templates.length === 0 ? (
          <Text style={styles.empty}>No saved workouts yet. Build one and it'll show up here.</Text>
        ) : (
          <View style={styles.card}>
            {templates.map((t, i) => (
              <View key={t.id}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity style={styles.row} onPress={() => go({ templateId: t.id })} activeOpacity={0.7}>
                  <View style={styles.rowIcon}><Ionicons name="barbell-outline" size={18} color={C.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{t.name}</Text>
                    <Text style={styles.rowMeta}>{t.exercise_ids.length} exercise{t.exercise_ids.length === 1 ? '' : 's'} · ~{t.est_duration_min} min</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.outline} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.section}>TEMPLATES</Text>
        <View style={styles.card}>
          {WORKOUT_PRESETS.map((p, i) => (
            <View key={p.id}>
              {i > 0 && <View style={styles.divider} />}
              <TouchableOpacity style={styles.row} onPress={() => go({ presetId: p.id })} activeOpacity={0.7}>
                <View style={styles.rowIcon}><Ionicons name="sparkles" size={16} color={C.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowMeta}>{p.exercises.length} exercises</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.outline} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { padding: Spacing.lg, gap: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, marginTop: 1 },
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: C.primary, borderRadius: Radius.lg, padding: Spacing.md },
  iconWrap: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  primaryRowTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  primaryRowSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  section: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  card: { backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  rowIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  rowMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
})
