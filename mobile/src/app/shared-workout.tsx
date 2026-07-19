// Tempo — shared-workout / shared-split landing (modal).
//
// Deep-link / code-redemption target for a share: shows the snapshot
// ("Push (Jacob's) — created by Jacob") with metadata chips and either its
// exercise list (kind='workout') or its weekly day breakdown (kind='split'),
// then imports it into the viewer's account on Save. Reached via
// tempo://shared-workout?code=X, the /w/[code] link route, or the paste-a-code
// box on the Friends screen.

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale, FadeInView, PopIn } from '@/components/motion'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBanner } from '@/components/ErrorBanner'
import * as haptics from '@/lib/haptics'
import { WEEKDAY_LABELS } from '@/lib/splits'
import {
  fetchWorkoutShare, importWorkoutShare, importSplitShare, possessive,
  equipmentSummaryLabel, type WorkoutShare,
} from '@/lib/social'

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
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (!code || !userId) { setLoading(false); return }
    setLoading(true)
    setLoadError(false)
    fetchWorkoutShare(supabase, code)
      .then(setShare)
      // A thrown read failure (network/RLS) is NOT the same as "no share
      // matches this code" — collapsing them used to tell the user a
      // perfectly good link "may have been deleted" over a transient
      // connection hiccup.
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [code, userId, retryTick])

  const isSplit = share?.kind === 'split'

  const handleSave = async () => {
    if (!share || saving || savedId) return
    setSaving(true)
    const { id, dropped } = isSplit
      ? await importSplitShare(supabase, userId, share)
      : await importWorkoutShare(supabase, userId, share)
    setSaving(false)
    if (!id) {
      Alert.alert('Couldn’t save', `This ${isSplit ? 'program' : 'workout'} couldn’t be imported — it may only contain exercises that aren’t available to you.`)
      return
    }
    haptics.success()
    setSavedId(id)
    if (dropped > 0) {
      Alert.alert('Saved (mostly)', `${dropped} exercise${dropped === 1 ? ' was' : 's were'} custom to the sharer and couldn’t come along. Everything else is saved.`)
    }
  }

  const title = share ? (share.owner_name ? `${share.name} (${possessive(share.owner_name)})` : share.name) : ''

  // Split day breakdown (kind='split').
  const trainingDays = (share?.days ?? []).filter((d) => !d.rest && (d.exercise_ids?.length ?? 0) > 0)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={isSplit ? 'Shared Program' : 'Shared Workout'}
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Opening…" /></View>
      ) : loadError ? (
        <View style={[styles.center, { paddingHorizontal: Spacing.lg }]}>
          <ErrorBanner
            message="Couldn't load this share. Check your connection and try again."
            onRetry={() => setRetryTick(t => t + 1)}
          />
        </View>
      ) : !share ? (
        <View style={styles.center}>
          <EmptyState
            kind="flash"
            title="Not found"
            body="This share link or code doesn't match anything — it may have been deleted, or the code was mistyped."
          />
        </View>
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <FadeInView style={styles.hero}>
              <View style={styles.shareBadge}>
                <Ionicons name={isSplit ? 'repeat-outline' : 'gift-outline'} size={12} color={C.primary} />
                <Text style={styles.shareBadgeText}>{isSplit ? 'SHARED PROGRAM' : 'SHARED WITH YOU'}</Text>
              </View>
              <Text style={styles.title}>{title}</Text>
              {!!share.owner_name && <Text style={styles.byline}>Created by {share.owner_name}</Text>}
            </FadeInView>

            {/* Metadata chips — creator context at a glance */}
            <FadeInView delay={40} style={styles.chipRow}>
              <MetaChip C={C} styles={styles} icon="fitness-outline"
                label={isSplit ? `${trainingDays.length} day${trainingDays.length === 1 ? '' : 's'}/week` : `${share.exercises.length} exercise${share.exercises.length === 1 ? '' : 's'}`} />
              <MetaChip C={C} styles={styles} icon="time-outline" label={`~${share.est_duration_min} min`} />
              <MetaChip C={C} styles={styles} icon="barbell-outline" label={equipmentSummaryLabel(share.equipment)} />
            </FadeInView>

            {isSplit ? (
              <FadeInView delay={70} style={styles.card}>
                {(share.days ?? [])
                  .slice()
                  .sort((a, b) => a.weekday - b.weekday)
                  .map((d, i) => (
                    <View key={d.weekday} style={[styles.dayRow, i > 0 && styles.exRowDivider]}>
                      <View style={[styles.dayPill, !d.rest && (d.exercise_ids?.length ?? 0) > 0 && styles.dayPillOn]}>
                        <Text style={[styles.dayPillText, !d.rest && (d.exercise_ids?.length ?? 0) > 0 && styles.dayPillTextOn]}>
                          {WEEKDAY_LABELS[d.weekday - 1]}
                        </Text>
                      </View>
                      <Text style={[styles.dayLabel, d.rest && { color: C.textSecondary }]} numberOfLines={1}>
                        {d.rest || !(d.exercise_ids?.length) ? 'Rest' : d.label}
                      </Text>
                      {!d.rest && (d.exercise_ids?.length ?? 0) > 0 && (
                        <Text style={styles.exSets}>{d.exercise_ids!.length} ex</Text>
                      )}
                    </View>
                  ))}
              </FadeInView>
            ) : (
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
            )}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.sm }]}>
            {savedId ? (
              <PopIn style={[styles.saveBtn, { backgroundColor: C.success }]}>
                <Ionicons name="checkmark-circle" size={18} color={C.onPrimary} />
                <Text style={styles.saveBtnText}>{isSplit ? 'Saved to My Splits' : 'In My Workouts'}</Text>
              </PopIn>
            ) : (
              <PressableScale style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color={C.onPrimary} /> : (
                  <>
                    <Ionicons name="download-outline" size={18} color={C.onPrimary} />
                    <Text style={styles.saveBtnText}>{isSplit ? 'Save Program' : 'Save Workout'}</Text>
                  </>
                )}
              </PressableScale>
            )}
            {savedId && (
              <PressableScale style={styles.openBtn} onPress={() => router.replace((isSplit ? '/my-splits' : '/my-workouts') as any)}>
                <Text style={styles.openBtnText}>{isSplit ? 'Open My Splits' : 'Open My Workouts'}</Text>
              </PressableScale>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

function MetaChip({ C, styles, icon, label }: { C: Palette; styles: any; icon: string; label: string }) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon as any} size={13} color={C.primary} />
      <Text style={styles.metaChipText} numberOfLines={1}>{label}</Text>
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
  },
  metaChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },
  card: {
    backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, ...CardShadow,
  },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  exRowDivider: { borderTopWidth: 1, borderTopColor: C.surfaceContainerHigh },
  exNum: { fontFamily: C.fontDisplay, fontSize: 14, color: C.outline, width: 20, textAlign: 'center' },
  exName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  exSets: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  dayPill: { width: 40, height: 28, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  dayPillOn: { backgroundColor: C.primarySoft },
  dayPillText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  dayPillTextOn: { color: C.primary },
  dayLabel: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
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
