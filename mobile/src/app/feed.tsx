// Tempo — Feed (modal). A real notification center, not a live status mirror.
//
// Redesigned 2026-07-22 from a bottom sheet that recomputed "today's eligible
// context items" on every open (so a still-eligible item like Goal ETA
// reappeared with identical content every single day) into an actual message
// history: server-sent retention pushes (notification_log, previously never
// read by the client at all — see ARCHITECTURE.md) merged with a local,
// cooldown-gated log of context-derived nudges (lib/feedLog.ts), sorted
// newest-first with real timestamps and read/unread state, like an inbox.

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { getFeedLog, getLastReadAt, markRead, isUnread, type FeedItem } from '@/lib/feedLog'
import { fetchSocialNotifCount } from '@/lib/social'
import { setSeenSocialCount } from '@/lib/feedSeen'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

// Icons for retention-push types (retention-push/index.ts's `type` union).
const PUSH_ICON: Record<string, IoniconName> = {
  missed_workout: 'refresh',
  streak_at_risk: 'flame',
  free_time_gap: 'time-outline',
  reactivation: 'sparkles',
  partner_reminder: 'people-outline',
  friend_competition: 'trophy-outline',
  weekly_report: 'stats-chart',
}

// Same mapping as _layout.tsx's push-tap listener (data.screen -> a real
// route) — retention-push writes these exact bare values, not routes.
function routeForScreen(screen: string | undefined): string | null {
  switch (screen) {
    case 'quick-workout': return '/quick-workout'
    case 'plan': return '/(tabs)/plan'
    case 'home': return '/(tabs)'
    case 'weekly-report': return '/weekly-report'
    case 'social': return '/social'
    default: return null
  }
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : d < 7 ? `${d}d ago` : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Row extends FeedItem {
  unread: boolean
}

export default function FeedScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [rows, setRows] = useState<Row[]>([])
  const [socialCount, setSocialCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (isRefresh: boolean) => {
    if (!userId) { setLoading(false); return }
    if (isRefresh) setRefreshing(true)
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const [{ data: sent }, count] = await Promise.all([
        supabase
          .from('notification_log')
          .select('id, type, title, body, data, sent_at')
          .eq('user_id', userId)
          .eq('status', 'sent')
          .gte('sent_at', since)
          .order('sent_at', { ascending: false })
          .limit(50),
        fetchSocialNotifCount(supabase, userId).catch(() => 0),
      ])
      setSocialCount(count)
      // Viewing the Feed acknowledges the current pending count, same as the
      // old sheet's openFeed() did — only a real increase counts as new again.
      setSeenSocialCount(userId, count)

      const pushItems: FeedItem[] = ((sent ?? []) as {
        id: string; type: string; title: string; body: string
        data: { screen?: string } | null; sent_at: string
      }[]).map(n => ({
        id: `push:${n.id}`,
        icon: PUSH_ICON[n.type] ?? 'notifications-outline',
        title: n.title,
        body: n.body,
        screen: n.data?.screen,
        createdAt: new Date(n.sent_at).getTime(),
      }))

      const localItems = getFeedLog(userId)
      const lastReadAt = getLastReadAt(userId)
      const merged = [...pushItems, ...localItems].sort((a, b) => b.createdAt - a.createdAt)
      setRows(merged.map(item => ({ ...item, unread: isUnread(item, lastReadAt) })))

      // Viewing the Feed is "reading" it, same as opening a messages app —
      // marks everything currently visible read so the badge clears.
      markRead(userId, merged.map(i => i.id))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load(false) }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRow = (row: Row) => {
    // Context items (lib/feedLog.ts) already store a real route (e.g.
    // '/calendar-setup'); push-derived items store retention-push's bare
    // `screen` value (e.g. 'plan'), which needs the same mapping
    // _layout.tsx's push-tap listener uses.
    const dest = row.screen?.startsWith('/') ? row.screen : routeForScreen(row.screen)
    router.push((dest ?? '/(tabs)') as any)
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Feed"
        size="sm"
        leading={<DismissButton kind="x" onPress={() => router.back()} label="Close" />}
      />

      {loading ? (
        <PulseLoader caption="Loading your feed…" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.primary} />}
        >
          {socialCount > 0 && (
            <TouchableOpacity style={styles.row} onPress={() => router.push('/social' as any)} activeOpacity={0.7}>
              <View style={[styles.iconWrap, { backgroundColor: C.primarySoft }]}>
                <Ionicons name="people" size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Friends & invites</Text>
                <Text style={styles.rowBody} numberOfLines={2}>
                  {socialCount} pending request{socialCount === 1 ? '' : 's'} waiting on you.
                </Text>
              </View>
              <View style={styles.unreadDot} />
            </TouchableOpacity>
          )}

          {rows.length === 0 && socialCount === 0 ? (
            <EmptyState
              kind="chart"
              title="You're all caught up"
              body="Nothing new right now — check back after your next workout or when something needs your attention."
            />
          ) : (
            rows.map(row => (
              <TouchableOpacity key={row.id} style={styles.row} onPress={() => openRow(row)} activeOpacity={0.7}>
                <View style={styles.iconWrap}>
                  <Ionicons name={row.icon as IoniconName} size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{row.title}</Text>
                    <Text style={styles.rowTime}>{timeAgo(row.createdAt)}</Text>
                  </View>
                  {!!row.body && <Text style={styles.rowBody} numberOfLines={2}>{row.body}</Text>}
                </View>
                {row.unread && <View style={styles.unreadDot} />}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.xs },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rowTitle: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14.5, color: C.text },
  rowTime: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline },
  rowBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginTop: 5 },
})
