// Tempo — My Splits (modal).
//
// The Program / Split layer's home: list the user's splits, see which is active, and
// create / activate / edit / duplicate / delete them. Activating a split lays its
// week onto the calendar (see lib/splitSchedule.activateSplit).

import { useCallback, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert, Share } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale, FadeInView } from '@/components/motion'
import { OptionSheet, type OptionSheetItem } from '@/components/OptionSheet'
import { WEEKDAY_LABELS, fetchSplits, deleteSplit, duplicateSplit, isAutoSplit } from '@/lib/splits'
import { activateSplit, activateAutoPlan } from '@/lib/splitSchedule'
import { createSplitShare, shareUrl } from '@/lib/social'
import * as haptics from '@/lib/haptics'
import type { Split } from '@/types'

export default function MySplitsScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [splits, setSplits] = useState<Split[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!userId) return
    fetchSplits(supabase, userId).then(setSplits).finally(() => setLoading(false))
  }, [userId])
  useFocusEffect(load)

  const activate = async (s: Split) => {
    if (busy) return
    setBusy(true)
    // The auto (program) split regenerates the periodized plan; a custom split lays
    // its own week onto the calendar.
    const result = isAutoSplit(s)
      ? (await activateAutoPlan(supabase, userId, profile)) ? 'activated' : 'failed'
      : await activateSplit(supabase, userId, s, profile)
    setBusy(false)
    if (result === 'failed') {
      Alert.alert('Could not activate', 'Check your connection and try again.')
      return
    }
    haptics.success()
    load()
    if (result === 'activated_pending') {
      // The split IS active but this week's sessions couldn't be written (likely
      // offline) — "try again" would be a lie; the next online app open lays them down.
      Alert.alert('Activated', `“${s.name}” is now your schedule. ${BRAND_NAME} couldn’t reach the server to build this week’s sessions — they’ll appear next time you open the app online.`)
      return
    }
    Alert.alert('Activated', isAutoSplit(s)
      ? 'Your auto-generated program is back on — this week is on the calendar.'
      : `“${s.name}” is now your schedule. Your week is on the calendar.`)
  }

  // Split actions live in a bottom sheet, not Alert.alert — Android caps alerts at
  // 3 buttons, which made Edit/Delete unreachable there.
  const [sheetSplit, setSheetSplit] = useState<Split | null>(null)

  const sheetOptions = (s: Split): OptionSheetItem[] => {
    if (isAutoSplit(s)) {
      // The program mirror is managed by Tempo: activate or fork it, but it can't be
      // hand-edited or deleted (that's what a custom split is for).
      return [
        ...(s.is_active ? [] : [{ key: 'activate', label: 'Set as active', sub: 'Switch back to your auto-generated program', icon: 'play-circle-outline' }]),
        { key: 'duplicate', label: 'Duplicate as custom', sub: 'Make an editable copy of this program', icon: 'copy-outline' },
        { key: 'share', label: 'Share program', sub: 'Friends can import the whole week', icon: 'share-outline' },
      ]
    }
    return [
      ...(s.is_active ? [] : [{ key: 'activate', label: 'Set as active', sub: 'Lay this week onto your calendar', icon: 'play-circle-outline' }]),
      { key: 'edit', label: 'Edit split', icon: 'create-outline' },
      { key: 'duplicate', label: 'Duplicate', icon: 'copy-outline' },
      { key: 'share', label: 'Share split', sub: 'Friends can import the whole week', icon: 'share-outline' },
      { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true },
    ]
  }

  // Share = snapshot the whole weekly program under a short code.
  const shareSplit = async (s: Split) => {
    const share = await createSplitShare(supabase, userId, profile?.display_name ?? null, s)
    if (!share) { Alert.alert('Couldn’t create link', 'Check your connection and try again.'); return }
    Share.share({
      message: `Try my "${s.name}" program on ${BRAND_NAME}: ${shareUrl(share.code)}\n\nOr paste this code in ${BRAND_NAME} → Friends: ${share.code}`,
    }).catch(() => {})
  }

  const onSheetSelect = async (key: string) => {
    const s = sheetSplit
    setSheetSplit(null)
    if (!s) return
    if (key === 'activate') activate(s)
    else if (key === 'edit') router.push(`/split-editor?splitId=${s.id}`)
    else if (key === 'duplicate') { await duplicateSplit(supabase, userId, s); load() }
    else if (key === 'share') shareSplit(s)
    else if (key === 'delete') confirmDelete(s)
  }

  const confirmDelete = (s: Split) =>
    Alert.alert('Delete split?', `“${s.name}” will be removed. Already-scheduled sessions stay on your calendar.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { if (await deleteSplit(supabase, s.id)) load() } },
    ])

  const dayChips = (s: Split) =>
    s.days.slice().sort((a, b) => a.weekday - b.weekday).map((d) => ({
      key: d.weekday, wd: WEEKDAY_LABELS[d.weekday - 1], rest: d.rest, label: d.rest ? 'Rest' : d.label,
    }))

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="My Splits"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your splits…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.intro}>
            A split is your weekly schedule. Your auto-generated program lives here too —
            switch between it and your own splits any time. Only one is active at a time.
          </Text>
          <PressableScale style={styles.bigBtn} onPress={() => router.push('/split-editor')}>
            <Ionicons name="add" size={20} color={C.onPrimary} />
            <Text style={styles.bigBtnText}>Create a new split</Text>
          </PressableScale>

          {splits.length === 0 ? (
            <EmptyState kind="calendar" title="No splits yet" body="A split is your weekly schedule — Push Pull Legs, Upper/Lower, or your own. Build one and activate it to lay your week onto the calendar." />
          ) : (
            splits.map((s, i) => (
              <FadeInView key={s.id} delay={Math.min(i * 50, 250)}>
              <TouchableOpacity style={[styles.splitCard, s.is_active && styles.splitCardActive]} onPress={() => setSheetSplit(s)} activeOpacity={0.8}>
                <View style={styles.splitHead}>
                  <View style={styles.nameWrap}>
                    <Text style={styles.splitName} numberOfLines={1}>{s.name}</Text>
                    {isAutoSplit(s) ? (
                      <View style={styles.autoBadge}>
                        <Ionicons name="sparkles" size={10} color={C.primary} />
                        <Text style={styles.autoBadgeText}>BY TEMPO</Text>
                      </View>
                    ) : (
                      <View style={styles.customBadge}>
                        <Ionicons name="person" size={10} color={C.textSecondary} />
                        <Text style={styles.customBadgeText}>YOURS</Text>
                      </View>
                    )}
                  </View>
                  {s.is_active
                    ? <View style={styles.activeBadge}><Ionicons name="checkmark-circle" size={13} color={C.success} /><Text style={styles.activeBadgeText}>ACTIVE</Text></View>
                    : <Ionicons name="ellipsis-horizontal" size={18} color={C.outline} />}
                </View>
                <View style={styles.weekRow}>
                  {dayChips(s).map((c) => (
                    <View key={c.key} style={[styles.wChip, !c.rest && styles.wChipOn]}>
                      <Text style={[styles.wChipDay, !c.rest && styles.wChipDayOn]}>{c.wd[0]}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.splitSub} numberOfLines={1}>
                  {s.days.filter((d) => !d.rest).length} training day{s.days.filter((d) => !d.rest).length === 1 ? '' : 's'} / week
                </Text>
              </TouchableOpacity>
              </FadeInView>
            ))
          )}
        </ScrollView>
      )}

      <OptionSheet
        visible={sheetSplit !== null}
        title={sheetSplit?.name ?? ''}
        subtitle={sheetSplit?.is_active
          ? (sheetSplit && isAutoSplit(sheetSplit)
            ? `Your active auto-generated program. ${BRAND_NAME} keeps it progressing week to week.`
            : 'This is your active schedule.')
          : undefined}
        options={sheetSplit ? sheetOptions(sheetSplit) : []}
        onSelect={onSheetSelect}
        onClose={() => setSheetSplit(null)}
      />

      {/* Activation does real work (retire old schedule, materialize, auto-place
          times) — show it, so taps don't feel dead and can't double-fire. */}
      {busy && (
        <View style={styles.busyOverlay}>
          <PulseLoader caption="Setting up your schedule…" />
        </View>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, marginTop: Spacing.xs },
  bigBtn: { height: 54, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: C.primary, marginTop: Spacing.xs },
  bigBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, paddingVertical: Spacing.sm },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  autoBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  autoBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.primary, letterSpacing: 0.5 },
  customBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  customBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.textSecondary, letterSpacing: 0.5 },
  splitCard: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md, gap: Spacing.sm, ...CardShadow },
  splitCardActive: { borderColor: C.primary },
  splitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitName: { flex: 1, fontFamily: C.fontDisplay, fontSize: 17, color: C.text, letterSpacing: -0.2 },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.successSoft, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  activeBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.success, letterSpacing: 0.5 },
  weekRow: { flexDirection: 'row', gap: 5 },
  wChip: { flex: 1, height: 30, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  wChipOn: { backgroundColor: C.primarySoft },
  wChipDay: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline },
  wChipDayOn: { color: C.primary },
  splitSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary },
  busyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface + 'E6',
  },
})
