// Tempo — shared-workout landing (modal).
//
// Deep-link / code-redemption target for a shared workout: shows the snapshot
// ("Push (Jacob's) — created by Jacob") with its exercise list, then imports it
// into the viewer's library on Save. Reached via tempo://shared-workout?code=X,
// the /w/[code] link route, or the paste-a-code box on the Friends screen.

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native'
import { PulseLoader } from '@/components/brand'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale, FadeInView, PopIn } from '@/components/motion'
import { EmptyState } from '@/components/EmptyState'
import * as haptics from '@/lib/haptics'
import { fetchWorkoutShare, importWorkoutShare, possessive, type WorkoutShare } from '@/lib/social'

export default function SharedWorkoutScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { code } = useLocalSearchParams<{ code?: string }>()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [share, setShare] = useState<WorkoutShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    if (!code || !userId) { setLoading(false); return }
    fetchWorkoutShare(supabase, code)
      .then(setShare)
      .finally(() => setLoading(false))
  }, [code, userId])

  const handleSave = async () => {
    if (!share || saving || savedId) return
    setSaving(true)
    const { id, dropped } = await importWorkoutShare(supabase, userId, share)
    setSaving(false)
    if (!id) {
      Alert.alert('Couldn’t save', 'This workout couldn’t be imported — it may only contain exercises that aren’t available to you.')
      return
    }
    haptics.success()
    setSavedId(id)
    if (dropped > 0) {
      Alert.alert('Saved (mostly)', `${dropped} exercise${dropped === 1 ? ' was' : 's were'} custom to the sharer and couldn’t come along. Everything else is in My Workouts.`)
    }
  }

  const title = share ? (share.owner_name ? `${share.name} (${possessive(share.owner_name)})` : share.name) : ''

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shared Workout</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Opening workout…" /></View>
      ) : !share ? (
        <View style={styles.center}>
          <EmptyState
            kind="flash"
            title="Workout not found"
            body="This share link or code doesn't match anything — it may have been deleted, or the code was mistyped."
          />
        </View>
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <FadeInView style={styles.hero}>
              <View style={styles.shareBadge}>
                <Ionicons name="gift-outline" size={12} color={C.primary} />
                <Text style={styles.shareBadgeText}>SHARED WITH YOU</Text>
              </View>
              <Text style={styles.title}>{title}</Text>
              {!!share.owner_name && <Text style={styles.byline}>Created by {share.owner_name}</Text>}
              <Text style={styles.meta}>{share.exercises.length} exercise{share.exercises.length === 1 ? '' : 's'} · ~{share.est_duration_min} min</Text>
            </FadeInView>

            <FadeInView delay={70} style={styles.card}>
              {share.exercises.map((ex, i) => {
                const cfg = share.config?.find((c) => c.exercise_id === ex.id)
                return (
                  <View key={`${ex.id}-${i}`} style={[styles.exRow, i > 0 && styles.exRowDivider]}>
                    <Text style={styles.exNum}>{i + 1}</Text>
                    <Text style={styles.exName} numberOfLines={1}>{ex.name}</Text>
                    {cfg && <Text style={styles.exSets}>{cfg.sets} × {cfg.rep_high}</Text>}
                  </View>
                )
              })}
            </FadeInView>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.sm }]}>
            {savedId ? (
              <PopIn style={[styles.saveBtn, { backgroundColor: C.success }]}>
                <Ionicons name="checkmark-circle" size={18} color={C.onPrimary} />
                <Text style={styles.saveBtnText}>In My Workouts</Text>
              </PopIn>
            ) : (
              <PressableScale style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color={C.onPrimary} /> : (
                  <>
                    <Ionicons name="download-outline" size={18} color={C.onPrimary} />
                    <Text style={styles.saveBtnText}>Save Workout</Text>
                  </>
                )}
              </PressableScale>
            )}
            {savedId && (
              <PressableScale style={styles.openBtn} onPress={() => router.replace('/my-workouts' as any)}>
                <Text style={styles.openBtnText}>Open My Workouts</Text>
              </PressableScale>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { gap: 4, paddingTop: Spacing.sm },
  shareBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: C.primarySoft, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  shareBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.5 },
  title: { fontFamily: C.fontDisplay, fontSize: 26, color: C.text, letterSpacing: -0.4, marginTop: 4 },
  byline: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary },
  card: {
    backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, ...CardShadow,
  },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  exRowDivider: { borderTopWidth: 1, borderTopColor: C.surfaceContainerHigh },
  exNum: { fontFamily: C.fontDisplay, fontSize: 14, color: C.outline, width: 20, textAlign: 'center' },
  exName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  exSets: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  footer: {
    gap: Spacing.sm, paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm,
    borderTopWidth: 0.5, borderTopColor: C.outlineVariant, backgroundColor: C.surface,
  },
  saveBtn: {
    height: 54, borderRadius: Radius.lg, backgroundColor: C.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
  },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  openBtn: { alignItems: 'center', paddingVertical: Spacing.xs },
  openBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
})
