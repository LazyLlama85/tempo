// Tempo — a group (modal). Its shared invite code, the three leaderboards scoped
// to the group's members (Weekly / Streak / Tempo Score), and leave/delete.
// Backed by lib/groups + supabase/add_social_groups.sql.

import { useCallback, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, Share, Alert } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { LeaderboardBoard } from '@/components/LeaderboardBoard'
import { OptionSheet } from '@/components/OptionSheet'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { listMyGroups, leaveGroup, fetchGroupLeaderboard, type GroupSummary } from '@/lib/groups'
import type { LeaderboardV2Row } from '@/lib/social'
import * as haptics from '@/lib/haptics'

export default function GroupDetailScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const groupId = String(id ?? '')
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [group, setGroup] = useState<GroupSummary | null>(null)
  const [rows, setRows] = useState<LeaderboardV2Row[] | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)

  useFocusEffect(
    useCallback(() => {
      if (!groupId) return
      listMyGroups(supabase).then((gs) => setGroup(gs.find((g) => g.id === groupId) ?? null)).catch(() => {})
      fetchGroupLeaderboard(supabase, groupId).then(setRows).catch(() => setRows([]))
    }, [groupId]),
  )

  const isOwner = !!group && group.owner_id === userId

  const shareCode = () => {
    if (!group) return
    haptics.tapLight()
    Share.share({
      message: `Join my Tempo group "${group.name}"! Group code: ${group.invite_code} — paste it in Friends → Groups → Join.`,
    }).catch(() => {})
  }
  const copyCode = async () => {
    if (!group) return
    haptics.tapLight()
    await Clipboard.setStringAsync(group.invite_code).catch(() => {})
    Alert.alert('Copied', `${group.invite_code} is on your clipboard.`)
  }
  const doLeave = async () => {
    setLeaveOpen(false)
    if (!groupId) return
    haptics.tapMedium()
    if (await leaveGroup(supabase, groupId)) router.back()
    else Alert.alert('Couldn’t leave', 'Please try again.')
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={group?.name ?? 'Group'}
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />
      {rows === null ? (
        <View style={styles.center}><PulseLoader caption="Loading group…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {!!group && (
            <View style={styles.codeCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.codeLabel}>GROUP CODE</Text>
                <Text style={styles.code}>{group.invite_code}</Text>
                <Text style={styles.codeHint}>Share it so friends can join.</Text>
              </View>
              <View style={styles.codeActions}>
                <PressableScale style={styles.codeBtn} onPress={copyCode} scaleTo={0.9} accessibilityLabel="Copy group code">
                  <Ionicons name="copy-outline" size={17} color={C.primary} />
                </PressableScale>
                <PressableScale style={styles.codeBtn} onPress={shareCode} scaleTo={0.9} accessibilityLabel="Share group code">
                  <Ionicons name="share-outline" size={17} color={C.primary} />
                </PressableScale>
              </View>
            </View>
          )}

          <Text style={styles.sectionLabel}>LEADERBOARD · {rows.length} member{rows.length === 1 ? '' : 's'}</Text>
          {rows.length > 0 ? (
            <LeaderboardBoard
              rows={rows}
              currentUserId={userId}
              onOpenProfile={(uid) => router.push(`/friend-profile?userId=${uid}` as any)}
            />
          ) : (
            <Text style={styles.empty}>No members yet — share the code to get your group going.</Text>
          )}

          <PressableScale style={styles.leaveBtn} onPress={() => setLeaveOpen(true)} scaleTo={0.97}>
            <Text style={styles.leaveText}>{isOwner ? 'Delete group' : 'Leave group'}</Text>
          </PressableScale>
        </ScrollView>
      )}

      <OptionSheet
        visible={leaveOpen}
        title={isOwner ? 'Delete this group?' : 'Leave this group?'}
        subtitle={isOwner
          ? 'You own this group — leaving deletes it and its leaderboards for everyone.'
          : 'You can rejoin later with the code.'}
        options={[{ key: 'leave', label: isOwner ? 'Delete group' : 'Leave group', icon: 'exit-outline', destructive: true }]}
        onSelect={doLeave}
        onClose={() => setLeaveOpen(false)}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.xs },
  codeCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primarySoft, borderRadius: Radius.xl, padding: Spacing.md, marginTop: Spacing.sm,
  },
  codeLabel: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: C.primary, letterSpacing: 0.6 },
  code: { fontFamily: C.fontNumeric, fontSize: 26, color: C.text, letterSpacing: 3, marginTop: 2 },
  codeHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 2 },
  codeActions: { flexDirection: 'row', gap: Spacing.sm },
  codeBtn: {
    width: 38, height: 38, borderRadius: Radius.full, backgroundColor: C.background,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.outlineVariant,
  },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, padding: Spacing.md, lineHeight: 19 },
  leaveBtn: { height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg, backgroundColor: C.surfaceContainerLow, marginTop: Spacing.lg },
  leaveText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.error },
})
