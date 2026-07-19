// Tempo — a friend's profile (modal).
//
// Stats (streak, totals) and recent activity per their privacy settings, plus
// their browsable workouts (RLS-gated). Any workout can be saved into your own
// library as an attributed copy — "Push (Jacob's)" — that never touches theirs.

import { useEffect, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale, FadeInView } from '@/components/motion'
import { FriendAvatar } from '@/components/FriendAvatar'
import { BadgeShelf } from '@/components/BadgeShelf'
import { OptionSheet } from '@/components/OptionSheet'
import { ScheduleTogetherSheet } from '@/components/ScheduleTogetherSheet'
import * as haptics from '@/lib/haptics'
import {
  fetchFriendOverview, fetchFriendTemplates, copyTemplateToLibrary,
  type FriendOverview,
} from '@/lib/social'
import { useWeightUnit, displayVolume, unitLabel } from '@/lib/units'
import type { WorkoutTemplate } from '@/types'

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build muscle', fat_loss: 'Lose fat', strength: 'Gain strength',
  general_fitness: 'General fitness', athletic: 'Athletic performance',
}

function memberSince(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function FriendProfileScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { userId: targetId } = useLocalSearchParams<{ userId?: string }>()
  const { session } = useAuthStore()
  const myId = session?.user.id ?? ''

  const [overview, setOverview] = useState<FriendOverview | null>(null)
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetTemplate, setSheetTemplate] = useState<WorkoutTemplate | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const unit = useWeightUnit()

  useEffect(() => {
    if (!targetId || !myId) return
    Promise.all([
      fetchFriendOverview(supabase, targetId),
      fetchFriendTemplates(supabase, targetId),
    ])
      .then(([o, t]) => { setOverview(o); setTemplates(t) })
      .finally(() => setLoading(false))
  }, [targetId, myId])

  const saveCopy = async (t: WorkoutTemplate) => {
    setSheetTemplate(null)
    const id = await copyTemplateToLibrary(supabase, myId, t, overview?.display_name ?? null)
    if (id) {
      haptics.success()
      setSavedIds((prev) => new Set(prev).add(t.id))
      Alert.alert('Saved to My Workouts', 'Your copy is yours to edit — the original stays untouched.')
    } else {
      Alert.alert('Couldn’t save', 'This workout only uses exercises you don’t have access to, or the save failed. Try again.')
    }
  }

  const name = overview?.display_name ?? 'Tempo user'

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Profile"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Back" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading profile…" /></View>
      ) : !overview ? (
        <View style={styles.center}><Text style={styles.emptyText}>This profile isn’t available.</Text></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <FadeInView style={styles.hero}>
            <FriendAvatar avatarUrl={overview.avatar_url} size={72} />
            <Text style={styles.name}>{name}</Text>
            {!!overview.username && <Text style={styles.handle}>@{overview.username}</Text>}
            {!!memberSince(overview.member_since) && (
              <Text style={styles.memberSince}>Training with Tempo since {memberSince(overview.member_since)}</Text>
            )}
          </FadeInView>

          {targetId !== myId && (
            <PressableScale style={styles.scheduleBtn} onPress={() => setScheduleOpen(true)} scaleTo={0.97}>
              <Ionicons name="calendar" size={16} color={C.onPrimary} />
              <Text style={styles.scheduleBtnText}>Schedule together</Text>
            </PressableScale>
          )}

          {/* Stats */}
          {overview.stats_visible ? (
            <>
              <FadeInView delay={60} style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{overview.streak ?? 0}</Text>
                  <Text style={styles.statLabel}>STREAK</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{overview.longest_streak ?? 0}</Text>
                  <Text style={styles.statLabel}>LONGEST</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{overview.workouts_this_week ?? 0}</Text>
                  <Text style={styles.statLabel}>THIS WEEK</Text>
                </View>
              </FadeInView>
              <FadeInView delay={100} style={styles.card}>
                {([
                  ['barbell-outline', 'Total workouts', String(overview.total_workouts ?? 0)],
                  ['layers-outline', 'Sets logged', String(overview.total_sets ?? 0)],
                  ['trending-up-outline', 'Volume lifted', overview.total_volume_lbs
                    ? `${displayVolume(overview.total_volume_lbs, unit)} ${unitLabel(unit)}`
                    : '—'],
                  ['body-outline', 'Favorite muscle', overview.favorite_muscle
                    ? overview.favorite_muscle[0].toUpperCase() + overview.favorite_muscle.slice(1)
                    : '—'],
                  ['flag-outline', 'Goal', overview.goal ? (GOAL_LABELS[overview.goal] ?? '—') : '—'],
                  ['calendar-outline', 'This month', `${overview.workouts_this_month ?? 0} workouts`],
                ] as [string, string, string][]).map(([icon, label, value], i) => (
                  <View key={label}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.detailRow}>
                      <Ionicons name={icon as any} size={16} color={C.primary} />
                      <Text style={styles.detailLabel}>{label}</Text>
                      <Text style={styles.detailValue}>{value}</Text>
                    </View>
                  </View>
                ))}
              </FadeInView>
              {(overview.earned_badges?.length ?? 0) > 0 && (
                <FadeInView delay={130}>
                  <Text style={styles.sectionLabel}>BADGES</Text>
                  <View style={[styles.card, { padding: Spacing.md }]}>
                    <BadgeShelf earned={overview.earned_badges ?? []} showLocked={false} />
                  </View>
                </FadeInView>
              )}
            </>
          ) : (
            <View style={styles.privateNote}>
              <Ionicons name="lock-closed-outline" size={14} color={C.textSecondary} />
              <Text style={styles.privateNoteText}>Stats are private.</Text>
            </View>
          )}

          {/* Recent activity */}
          <Text style={styles.sectionLabel}>RECENT ACTIVITY</Text>
          {overview.activity_visible ? (
            (overview.recent?.length ?? 0) === 0 ? (
              <Text style={styles.emptyInline}>No completed sessions yet.</Text>
            ) : (
              <View style={styles.card}>
                {overview.recent!.map((r, i) => (
                  <View key={`${r.date}-${i}`}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.activityRow}>
                      <View style={styles.activityIcon}><Ionicons name="checkmark" size={14} color={C.success} /></View>
                      <Text style={styles.activityFocus} numberOfLines={1}>{r.focus}</Text>
                      <Text style={styles.activityDate}>
                        {new Date(`${r.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )
          ) : (
            <View style={styles.privateNote}>
              <Ionicons name="lock-closed-outline" size={14} color={C.textSecondary} />
              <Text style={styles.privateNoteText}>Activity is private.</Text>
            </View>
          )}

          {/* Workouts */}
          <Text style={styles.sectionLabel}>WORKOUTS{templates.length ? ` · ${templates.length}` : ''}</Text>
          {templates.length === 0 ? (
            <View style={styles.privateNote}>
              <Ionicons name="lock-closed-outline" size={14} color={C.textSecondary} />
              <Text style={styles.privateNoteText}>No workouts to show — they may be private.</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {templates.map((t, i) => (
                <View key={t.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity style={styles.tplRow} onPress={() => setSheetTemplate(t)} activeOpacity={0.7}>
                    <View style={styles.tplIcon}><Ionicons name="barbell-outline" size={18} color={C.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityFocus} numberOfLines={1}>{t.name}</Text>
                      <Text style={styles.tplMeta}>{t.exercise_ids.length} exercise{t.exercise_ids.length === 1 ? '' : 's'} · ~{t.est_duration_min} min</Text>
                    </View>
                    {savedIds.has(t.id)
                      ? <Text style={styles.savedTag}>Saved ✓</Text>
                      : <Ionicons name="download-outline" size={18} color={C.outline} />}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <OptionSheet
        visible={sheetTemplate !== null}
        title={sheetTemplate?.name ?? ''}
        subtitle={sheetTemplate ? `By ${name} · ${sheetTemplate.exercise_ids.length} exercises · ~${sheetTemplate.est_duration_min} min` : undefined}
        options={[
          { key: 'save', label: 'Save to My Workouts', sub: 'Your own editable copy, credited to them', icon: 'download-outline' },
        ]}
        onSelect={(key) => { if (key === 'save' && sheetTemplate) saveCopy(sheetTemplate) }}
        onClose={() => setSheetTemplate(null)}
      />

      <ScheduleTogetherSheet
        visible={scheduleOpen}
        friendId={targetId ?? ''}
        friendName={name}
        onClose={() => setScheduleOpen(false)}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.xs },
  hero: { alignItems: 'center', gap: 3, paddingVertical: Spacing.md },
  name: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.3, marginTop: Spacing.xs },
  handle: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.textSecondary },
  memberSince: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, marginTop: 2 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  detailLabel: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.textSecondary },
  detailValue: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: {
    flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow,
  },
  statValue: { fontFamily: C.fontNumeric, fontSize: 22, color: C.text },
  statLabel: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: C.outline, letterSpacing: 0.5 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  card: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden', ...CardShadow },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: Spacing.md },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  activityIcon: { width: 26, height: 26, borderRadius: Radius.full, backgroundColor: C.successSoft, alignItems: 'center', justifyContent: 'center' },
  activityFocus: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14.5, color: C.text },
  activityDate: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },
  tplRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  tplIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  tplMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  savedTag: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.success },
  privateNote: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: C.surfaceContainerLow },
  privateNoteText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary },
  emptyInline: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, paddingVertical: Spacing.xs },
  emptyText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.textSecondary },
  scheduleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, backgroundColor: C.primary, borderRadius: Radius.lg, marginTop: Spacing.md },
  scheduleBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
