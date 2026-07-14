// Tempo — the shared 3-tab leaderboard (Weekly Consistency / Streak / Tempo Score).
// Used by both the Friends screen and group screens so they rank identically.
// Consistency-first: a steady beginner can top a flaky advanced lifter.

import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { FriendAvatar } from '@/components/FriendAvatar'
import * as haptics from '@/lib/haptics'
import { sortLeaderboard, type LeaderboardV2Row, type LeaderboardMetric } from '@/lib/social'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useThemedStyles } from '@/theme'

interface Props {
  rows: LeaderboardV2Row[]
  currentUserId: string
  onOpenProfile: (userId: string) => void
  /** Max rows shown (default 12). */
  limit?: number
}

const TABS: [LeaderboardMetric, string][] = [
  ['weekly', 'This Week'],
  ['streak', 'Streak'],
  ['tempo', 'Tempo Score'],
]

export function LeaderboardBoard({ rows, currentUserId, onOpenProfile, limit = 12 }: Props) {
  const styles = useThemedStyles(makeStyles)
  const [tab, setTab] = useState<LeaderboardMetric>('weekly')
  const sorted = sortLeaderboard(rows, tab)

  return (
    <>
      <View style={styles.tabs}>
        {TABS.map(([key, label]) => {
          const on = tab === key
          return (
            <TouchableOpacity
              key={key}
              style={[styles.tab, on && styles.tabOn]}
              onPress={() => { haptics.tapLight(); setTab(key) }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <View style={styles.card}>
        {sorted.slice(0, limit).map((row, i) => {
          const isMe = row.user_id === currentUserId
          const hasValue = tab === 'streak' ? row.current_streak > 0
            : tab === 'tempo' ? row.tempo_score > 0
              : row.completed_this_week > 0
          const medal = i < 3 && hasValue ? ['🥇', '🥈', '🥉'][i] : null
          return (
            <View key={row.user_id}>
              {i > 0 && <View style={styles.divider} />}
              <TouchableOpacity
                style={[styles.row, isMe && styles.rowMe]}
                activeOpacity={isMe ? 1 : 0.7}
                disabled={isMe}
                onPress={() => onOpenProfile(row.user_id)}
              >
                {medal ? <Text style={styles.medal}>{medal}</Text> : <Text style={styles.rank}>{i + 1}</Text>}
                <FriendAvatar avatarUrl={row.avatar_url} size={30} />
                <Text style={styles.name} numberOfLines={1}>
                  {isMe ? 'You' : (row.display_name ?? `@${row.username}`)}
                </Text>
                <View style={styles.metricWrap}>
                  {tab === 'weekly' && <>
                    <Text style={styles.metric}>{row.completed_this_week}/{row.scheduled_this_week}</Text>
                    <Text style={styles.metricSub}>{row.completion_pct}%</Text>
                  </>}
                  {tab === 'streak' && <>
                    <Text style={styles.metric}>🔥 {row.current_streak}</Text>
                    <Text style={styles.metricSub}>day{row.current_streak === 1 ? '' : 's'}</Text>
                  </>}
                  {tab === 'tempo' && <>
                    <Text style={styles.metric}>{row.tempo_score}</Text>
                    <Text style={styles.metricSub}>pts</Text>
                  </>}
                </View>
              </TouchableOpacity>
            </View>
          )
        })}
      </View>
      {tab === 'tempo' && (
        <Text style={styles.hint}>
          Tempo Score rewards consistency over strength — finishing what you plan, hitting your weekly goal, and keeping a streak. A steady beginner can outscore a flaky pro.
        </Text>
      )}
    </>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, padding: 3, marginTop: Spacing.sm },
  tab: { flex: 1, paddingVertical: 8, borderRadius: Radius.full, alignItems: 'center' },
  tabOn: { backgroundColor: C.primary },
  tabText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.textSecondary },
  tabTextOn: { color: C.onPrimary },
  card: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden', marginTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  rowMe: { backgroundColor: C.primarySoft },
  rank: { width: 22, fontFamily: C.fontDisplay, fontSize: 15, color: C.outline, textAlign: 'center' },
  medal: { width: 22, fontSize: 16, textAlign: 'center' },
  name: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  metricWrap: { alignItems: 'flex-end', minWidth: 48 },
  metric: { fontFamily: C.fontNumeric, fontSize: 15, color: C.text },
  metricSub: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: C.textSecondary, marginTop: -1 },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: Spacing.md },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: Spacing.xs },
})
