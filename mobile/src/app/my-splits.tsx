// Tempo — My Splits (modal).
//
// The Program / Split layer's home: list the user's splits, see which is active, and
// create / activate / edit / duplicate / delete them. Activating a split lays its
// week onto the calendar (see lib/splitSchedule.activateSplit).

import { useCallback, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { PulseLoader } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale, FadeInView } from '@/components/motion'
import { WEEKDAY_LABELS, fetchSplits, deleteSplit, duplicateSplit, isAutoSplit } from '@/lib/splits'
import { activateSplit, activateAutoPlan } from '@/lib/splitSchedule'
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
    const ok = isAutoSplit(s)
      ? await activateAutoPlan(supabase, userId, profile)
      : await activateSplit(supabase, userId, s, profile)
    setBusy(false)
    if (ok) {
      load()
      Alert.alert('Activated', isAutoSplit(s)
        ? 'Your auto-generated program is back on — this week is on the calendar.'
        : `“${s.name}” is now your schedule. Your week is on the calendar.`)
    } else Alert.alert('Could not activate', 'Please try again.')
  }

  const actions = (s: Split) => {
    if (isAutoSplit(s)) {
      // The program mirror is managed by Tempo: activate or fork it, but it can't be
      // hand-edited or deleted (that's what a custom split is for).
      Alert.alert(s.name, s.is_active
        ? 'This is your active auto-generated program. Tempo keeps it progressing week to week.'
        : 'Your auto-generated program. Activate it to switch back from a custom split.', [
        ...(s.is_active ? [] : [{ text: 'Set as active', onPress: () => activate(s) }]),
        { text: 'Duplicate as custom', onPress: async () => { await duplicateSplit(supabase, userId, s); load() } },
        { text: 'Cancel', style: 'cancel' },
      ])
      return
    }
    Alert.alert(s.name, s.is_active ? 'This is your active schedule.' : undefined, [
      ...(s.is_active ? [] : [{ text: 'Set as active', onPress: () => activate(s) }]),
      { text: 'Edit', onPress: () => router.push(`/split-editor?splitId=${s.id}` as any) },
      { text: 'Duplicate', onPress: async () => { await duplicateSplit(supabase, userId, s); load() } },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(s) },
      { text: 'Cancel', style: 'cancel' },
    ])
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}><Ionicons name="chevron-down" size={26} color={C.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>My Splits</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your splits…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.intro}>
            A split is your weekly schedule. Your auto-generated program lives here too —
            switch between it and your own splits any time. Only one is active at a time.
          </Text>
          <PressableScale style={styles.bigBtn} onPress={() => router.push('/split-editor' as any)}>
            <Ionicons name="add" size={20} color={C.onPrimary} />
            <Text style={styles.bigBtnText}>Create a new split</Text>
          </PressableScale>

          {splits.length === 0 ? (
            <EmptyState kind="calendar" title="No splits yet" body="A split is your weekly schedule — Push Pull Legs, Upper/Lower, or your own. Build one and activate it to lay your week onto the calendar." />
          ) : (
            splits.map((s, i) => (
              <FadeInView key={s.id} delay={Math.min(i * 50, 250)}>
              <TouchableOpacity style={[styles.splitCard, s.is_active && styles.splitCardActive]} onPress={() => actions(s)} activeOpacity={0.8}>
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
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
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
})
