// Arclo — Blocked accounts (App Store Guideline 1.2).
//
// A block that cannot be undone is a support ticket waiting to happen, and
// Apple looks for the management surface as well as the action itself. Reached
// from Settings -> Account -> Blocked accounts. Deliberately plain: this is a
// screen people visit rarely and want to leave quickly.

import { useCallback, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { ScreenHeader, DismissButton, PulseLoader } from '@/components/brand'
import { FriendAvatar } from '@/components/FriendAvatar'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import * as haptics from '@/lib/haptics'
import { listBlockedUsers, unblockUser, describeUser, type BlockedUser } from '@/lib/moderation'
import { BRAND_NAME } from '@/constants/brand'

export default function BlockedUsersScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()

  const [rows, setRows] = useState<BlockedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Refetch on focus: blocking happens on another screen, so a stale list here
  // would show someone as un-blocked who isn't (or the reverse).
  useFocusEffect(
    useCallback(() => {
      let alive = true
      listBlockedUsers(supabase)
        .then((r) => { if (alive) setRows(r) })
        .finally(() => { if (alive) setLoading(false) })
      return () => { alive = false }
    }, []),
  )

  const confirmUnblock = (u: BlockedUser) => {
    const name = describeUser(u)
    Alert.alert(
      `Unblock ${name}?`,
      'You will be able to see each other again. This does not restore any friendship you had before.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setBusyId(u.user_id)
            const ok = await unblockUser(supabase, u.user_id)
            setBusyId(null)
            if (ok) {
              haptics.success()
              setRows((prev) => prev.filter((r) => r.user_id !== u.user_id))
            } else {
              Alert.alert('Couldn’t unblock', 'Check your connection and try again.')
            }
          },
        },
      ],
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Blocked accounts"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Back" />}
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading…" /></View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="hand-left-outline" size={30} color={C.outlineVariant} />
          <Text style={styles.emptyTitle}>You haven’t blocked anyone</Text>
          <Text style={styles.emptyBody}>
            You can block someone from their profile — open them from the feed, a leaderboard,
            or a group, then tap the ··· button.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>
            You and these people can’t see each other anywhere in {BRAND_NAME}.
          </Text>
          <View style={styles.card}>
            {rows.map((u) => (
              <View key={u.user_id} style={styles.row}>
                <FriendAvatar avatarUrl={u.avatar_url} size={38} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>{describeUser(u)}</Text>
                  {!!u.username && <Text style={styles.rowHandle} numberOfLines={1}>@{u.username}</Text>}
                </View>
                <TouchableOpacity
                  style={styles.unblockBtn}
                  onPress={() => confirmUnblock(u)}
                  disabled={busyId === u.user_id}
                  activeOpacity={0.7}
                >
                  <Text style={styles.unblockText}>
                    {busyId === u.user_id ? 'Working…' : 'Unblock'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, marginTop: Spacing.xs },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing['2xl'] },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 20, marginBottom: Spacing.md },
  card: { backgroundColor: C.surface, borderRadius: Radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.outlineVariant },
  rowInfo: { flex: 1 },
  rowName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: C.text },
  rowHandle: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  unblockBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.outlineVariant },
  unblockText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: C.primary },
})
