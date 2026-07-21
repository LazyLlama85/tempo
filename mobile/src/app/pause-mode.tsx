// Tempo — Pause / vacation mode (PRODUCT_AUDIT.html §26, L21).
//
// "I'm away for 10 days." Picks a return date and shifts the whole future plan
// to make room for it — every scheduled session, its calendar event, and its
// reminder all move together (lib/pauseMode.ts). No streak break, no wall of
// "missed" sessions, no drift: the mesocycle just resumes where it left off.
// Free, uncapped — this is core-loop reliability, not a Pro feature.

import { useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { pausePlan, resumePlan, describePauseUntil } from '@/lib/pauseMode'
import { invalidateTrainingData } from '@/lib/queryInvalidation'
import { track } from '@/lib/analytics'

type DurId = 'week' | 'tenDays' | 'twoWeeks' | 'month'
const DURATIONS: { id: DurId; label: string; days: number }[] = [
  { id: 'week', label: '1 week', days: 7 },
  { id: 'tenDays', label: '10 days', days: 10 },
  { id: 'twoWeeks', label: '2 weeks', days: 14 },
  { id: 'month', label: '1 month', days: 30 },
]

export default function PauseModeScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const { profile, session, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const pausedUntil = profile?.paused_until ?? null
  const active = !!pausedUntil

  const [dur, setDur] = useState<DurId>('week')
  const [saving, setSaving] = useState(false)

  const refreshAfterChange = async () => {
    await refreshProfile()
    invalidateTrainingData(queryClient)
  }

  const handlePause = async () => {
    if (!userId || saving) return
    setSaving(true)
    const days = DURATIONS.find(d => d.id === dur)!.days
    const res = await pausePlan(supabase, userId, days)
    setSaving(false)
    if (!res.ok) { Alert.alert('Could not pause', 'Please try again.'); return }
    track('pause_mode_started', { days })
    await refreshAfterChange()
    router.back()
  }

  const handleResume = async () => {
    if (!userId || saving || !pausedUntil) return
    setSaving(true)
    const res = await resumePlan(supabase, userId, pausedUntil)
    setSaving(false)
    if (!res.ok) { Alert.alert('Could not resume', 'Please try again.'); return }
    track('pause_mode_resumed')
    await refreshAfterChange()
    router.back()
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Pause My Plan"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.heroIcon}>
          <Ionicons name="pause" size={22} color={C.primary} />
        </View>

        {active ? (
          <>
            <Text style={styles.intro}>
              Your plan is paused. Every upcoming session moved to make room — nothing is
              overdue, nothing broke your streak, and it'll pick back up right where it left off.
            </Text>
            <View style={styles.activeCard}>
              <Ionicons name="checkmark-circle" size={18} color={C.success} />
              <Text style={styles.activeText}>Paused until {describePauseUntil(pausedUntil!)}.</Text>
            </View>
          </>
        ) : (
          <Text style={styles.intro}>
            Going away? Pause your plan and Tempo shifts every upcoming session forward to make
            room — no missed sessions, no broken streak. It resumes automatically the day you're
            back, or tap "Resume now" anytime before then.
          </Text>
        )}

        {!active && (
          <>
            <Text style={styles.sectionLabel}>HOW LONG?</Text>
            <View style={styles.durWrap}>
              {DURATIONS.map(d => {
                const on = dur === d.id
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.durChip, on && styles.durChipOn]}
                    onPress={() => setDur(d.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.durChipText, on && styles.durChipTextOn]}>{d.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <Text style={styles.hint}>
              Back to your normal plan {describePauseUntil(
                (() => { const d = new Date(); d.setDate(d.getDate() + DURATIONS.find(x => x.id === dur)!.days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })(),
              )}.
            </Text>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.sm }]}>
        {active ? (
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleResume}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color={C.onPrimary} /> : (
              <Text style={styles.saveBtnText}>Resume now</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handlePause}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color={C.onPrimary} /> : (
              <Text style={styles.saveBtnText}>Pause my plan</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  heroIcon: {
    width: 48, height: 48, borderRadius: Radius.lg, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs,
  },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21 },
  activeCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.successSoft, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs,
  },
  activeText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.success },

  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  durWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  durChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: C.outlineVariant, backgroundColor: C.background,
  },
  durChipOn: { borderColor: C.primary, backgroundColor: C.primarySoft },
  durChipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  durChipTextOn: { color: C.primary },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  saveBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
