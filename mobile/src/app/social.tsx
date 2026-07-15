// Tempo — Friends (modal).
//
// The social layer's home: search for people, send/answer friend requests, open
// friend profiles, redeem a shared-workout code, and set who can see your
// workouts / stats / activity. Backed by lib/social + supabase/add_social.sql.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { track } from '@/lib/analytics'
import { EmptyState } from '@/components/EmptyState'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale, FadeInView } from '@/components/motion'
import { FriendAvatar } from '@/components/FriendAvatar'
import { OptionSheet } from '@/components/OptionSheet'
import { TempoSheet } from '@/components/TempoSheet'
import * as haptics from '@/lib/haptics'
import {
  searchProfiles, fetchFriends, sendFriendRequest, acceptFriendRequest, removeFriendship,
  fetchPrivacy, updatePrivacy, fetchMyIdentity, fetchFriendFeed, fetchLeaderboardV2,
  toggleActivityReaction, fetchFriendEvents, describeFriendEvent,
  type FriendEntry, type SocialProfile, type PrivacyPrefs, type PrivacyLevel,
  type MyIdentity, type FeedItem, type LeaderboardV2Row, type FriendEventItem,
} from '@/lib/social'
import { LeaderboardBoard } from '@/components/LeaderboardBoard'
import { listMyGroups, createGroup, joinGroup, type GroupSummary } from '@/lib/groups'
import { listWorkoutInvites, respondWorkoutInvite, type WorkoutInvite } from '@/lib/scheduling'

// "2h ago" / "3d ago" for feed rows.
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${Math.max(1, min)}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

function fmtTime12(t: string): string {
  const [h, m] = t.split(':')
  const hh = parseInt(h, 10)
  return `${hh % 12 || 12}:${m ?? '00'} ${hh >= 12 ? 'PM' : 'AM'}`
}
function inviteWhen(dateStr: string, startTime: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime12(startTime)}`
}

const PRIVACY_ORDER: PrivacyLevel[] = ['public', 'friends', 'private']
const PRIVACY_LABEL: Record<PrivacyLevel, string> = { public: 'Public', friends: 'Friends only', private: 'Private' }
const PRIVACY_ICON: Record<PrivacyLevel, string> = { public: 'globe-outline', friends: 'people-outline', private: 'lock-closed-outline' }

// The activity feed merges friends' completed sessions (reactable) with lighter
// milestone events (streaks, badges), newest first.
type ActivityItem =
  | { kind: 'completed'; at: string; c: FeedItem }
  | { kind: 'event'; at: string; e: FriendEventItem }

export default function SocialScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SocialProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())
  const [code, setCode] = useState('')
  const [privacy, setPrivacy] = useState<PrivacyPrefs | null>(null)
  const [identity, setIdentity] = useState<MyIdentity | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [events, setEvents] = useState<FriendEventItem[]>([])
  const [board, setBoard] = useState<LeaderboardV2Row[]>([])
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [groupName, setGroupName] = useState('')
  const [groupCode, setGroupCode] = useState('')
  const [invites, setInvites] = useState<WorkoutInvite[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [groupSheetOpen, setGroupSheetOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState<FriendEntry | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    if (!userId) return
    fetchFriends(supabase, userId).then(setFriends).finally(() => setLoading(false))
    fetchPrivacy(supabase, userId).then(setPrivacy).catch(() => {})
    fetchMyIdentity(supabase, userId).then(setIdentity).catch(() => {})
    fetchFriendFeed(supabase).then(setFeed).catch(() => {})
    fetchFriendEvents(supabase).then(setEvents).catch(() => {})
    fetchLeaderboardV2(supabase).then(setBoard).catch(() => {})
    listMyGroups(supabase).then(setGroups).catch(() => {})
    listWorkoutInvites(supabase).then(setInvites).catch(() => {})
  }, [userId])
  useFocusEffect(load)

  // "Nice work" reaction — optimistic flip, reconciled with the server's count.
  // Keyed by workout_id; a row without one (old feed shape / pre-migration) has no
  // reaction control at all, so this is only ever called with a real id.
  const onReact = useCallback(async (item: FeedItem) => {
    const id = item.workout_id
    if (!id) return
    haptics.tapLight()
    const wasReacted = !!item.i_reacted
    const optimistic = (item.reaction_count ?? 0) + (wasReacted ? -1 : 1)
    setFeed((prev) => prev.map((f) =>
      f.workout_id === id ? { ...f, i_reacted: !wasReacted, reaction_count: Math.max(0, optimistic) } : f,
    ))
    const res = await toggleActivityReaction(supabase, id)
    setFeed((prev) => prev.map((f) => {
      if (f.workout_id !== id) return f
      // Success → trust the server's numbers; failure → revert to the prior state.
      return res
        ? { ...f, i_reacted: res.reacted, reaction_count: res.count }
        : { ...f, i_reacted: wasReacted, reaction_count: item.reaction_count ?? 0 }
    }))
    if (res) track('activity_reacted', { reacted: res.reacted })
  }, [])

  const shareMyCode = () => {
    if (!identity?.friend_code) return
    haptics.tapLight()
    Share.share({
      message: `Add me on Tempo! My friend code is ${identity.friend_code}${identity.username ? ` (@${identity.username})` : ''} — paste it in Friends → search.`,
    }).catch(() => {})
  }
  const copyMyCode = async () => {
    if (!identity?.friend_code) return
    haptics.tapLight()
    await Clipboard.setStringAsync(identity.friend_code).catch(() => {})
    Alert.alert('Copied', `${identity.friend_code} is on your clipboard.`)
  }

  // Debounced live search — results appear as you type, no search button.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(() => {
      searchProfiles(supabase, q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 350)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [query])

  const knownIds = new Set(friends.map((f) => f.user_id))

  const handleAdd = async (p: SocialProfile) => {
    haptics.tapLight()
    setSentTo((prev) => new Set(prev).add(p.user_id))
    const ok = await sendFriendRequest(supabase, userId, p.user_id)
    if (!ok) {
      setSentTo((prev) => { const n = new Set(prev); n.delete(p.user_id); return n })
      Alert.alert("Couldn't send request", 'You may already have a pending request with this person.')
      return
    }
    track('friend_request_sent')
    load()
  }

  const handleAccept = async (f: FriendEntry) => {
    haptics.success()
    if (await acceptFriendRequest(supabase, f.friendshipId)) {
      track('friend_request_accepted')
      load()
    }
  }

  const handleRemove = (f: FriendEntry) => setRemoveConfirm(f)

  const doRemoveFriendship = async () => {
    const f = removeConfirm
    setRemoveConfirm(null)
    if (!f) return
    haptics.tapMedium()
    if (await removeFriendship(supabase, f.friendshipId)) load()
  }

  const redeemCode = () => {
    const c = code.trim().toLowerCase().replace(/^.*\/w\//, '') // paste a link or a code
    if (!c) return
    setCode('')
    router.push(`/shared-workout?code=${encodeURIComponent(c)}` as any)
  }

  const onCreateGroup = async () => {
    const name = groupName.trim()
    if (!name) return
    haptics.tapLight()
    setGroupName('')
    const g = await createGroup(supabase, name)
    if (g) { track('group_created'); load(); router.push(`/group-detail?id=${g.id}` as any) }
    else Alert.alert("Couldn't create group", 'Please try again.')
  }
  const onJoinGroup = async () => {
    const c = groupCode.trim()
    if (!c) return
    haptics.tapLight()
    setGroupCode('')
    const gid = await joinGroup(supabase, c)
    if (gid) { track('group_joined'); load(); router.push(`/group-detail?id=${gid}` as any) }
    else Alert.alert('Group not found', 'Double-check the code and try again.')
  }

  const onRespondInvite = async (inv: WorkoutInvite, action: 'accept' | 'decline') => {
    haptics.tapMedium()
    const ok = await respondWorkoutInvite(supabase, inv.id, action)
    if (ok) {
      track('workout_invite_responded', { action })
      load()
      if (action === 'accept') {
        Alert.alert('Scheduled!', `Your ${inv.focus} with ${inv.display_name ?? 'your friend'} is on both your calendars.`)
      }
    } else Alert.alert("Couldn't respond", 'Please try again.')
  }

  const cyclePrivacy = async (key: keyof PrivacyPrefs) => {
    if (!privacy) return
    haptics.tapLight()
    const next = PRIVACY_ORDER[(PRIVACY_ORDER.indexOf(privacy[key]) + 1) % PRIVACY_ORDER.length]
    const updated = { ...privacy, [key]: next }
    setPrivacy(updated)
    if (!(await updatePrivacy(supabase, userId, { [key]: next }))) {
      setPrivacy(privacy) // revert on failure
      Alert.alert("Couldn't save", 'Check your connection and try again.')
    }
  }

  const incoming = friends.filter((f) => f.state === 'incoming')
  const outgoing = friends.filter((f) => f.state === 'outgoing')
  const accepted = friends.filter((f) => f.state === 'friend')
  const activity: ActivityItem[] = [
    ...feed.map((c) => ({ kind: 'completed' as const, at: c.completed_at, c })),
    ...events.map((e) => ({ kind: 'event' as const, at: e.created_at, e })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12)

  // Name + @username: the handle is what disambiguates two people with the
  // same display name.
  const personRow = (p: { user_id: string; display_name: string | null; avatar_url: string | null; username?: string | null }, right: React.ReactNode, onPress?: () => void) => (
    <TouchableOpacity key={p.user_id} style={styles.personRow} activeOpacity={onPress ? 0.7 : 1} onPress={onPress} disabled={!onPress}>
      <FriendAvatar avatarUrl={p.avatar_url} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.personName} numberOfLines={1}>{p.display_name ?? 'Tempo user'}</Text>
        {!!p.username && <Text style={styles.personHandle} numberOfLines={1}>@{p.username}</Text>}
      </View>
      {right}
    </TouchableOpacity>
  )

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Friends"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
        right={
          <TouchableOpacity onPress={() => setAddOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add friends">
            <Ionicons name="person-add" size={22} color={C.text} />
          </TouchableOpacity>
        }
      />

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your people…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Incoming requests */}
          {incoming.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>REQUESTS</Text>
              <View style={styles.card}>
                {incoming.map((f) => personRow(
                  f,
                  <View style={styles.reqActions}>
                    <PressableScale style={styles.addBtn} onPress={() => handleAccept(f)} scaleTo={0.9}>
                      <Text style={styles.addBtnText}>Accept</Text>
                    </PressableScale>
                    <TouchableOpacity onPress={() => handleRemove(f)} hitSlop={6}>
                      <Ionicons name="close-circle" size={22} color={C.outline} />
                    </TouchableOpacity>
                  </View>,
                ))}
              </View>
            </>
          )}

          {/* Workout invites — train-together requests (accept schedules it for both) */}
          {invites.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>WORKOUT INVITES</Text>
              <View style={styles.card}>
                {invites.map((inv, i) => (
                  <View key={inv.id}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.personRow}>
                      <FriendAvatar avatarUrl={inv.avatar_url} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {inv.direction === 'incoming'
                            ? `${inv.display_name ?? 'A friend'} invited you`
                            : `You invited ${inv.display_name ?? 'a friend'}`}
                        </Text>
                        <Text style={styles.personHandle} numberOfLines={1}>
                          {inv.focus} · {inviteWhen(inv.proposed_date, inv.proposed_start)}
                        </Text>
                      </View>
                      {inv.direction === 'incoming' && inv.status === 'pending' ? (
                        <View style={styles.reqActions}>
                          <PressableScale style={styles.addBtn} onPress={() => onRespondInvite(inv, 'accept')} scaleTo={0.9}>
                            <Text style={styles.addBtnText}>Accept</Text>
                          </PressableScale>
                          <TouchableOpacity onPress={() => onRespondInvite(inv, 'decline')} hitSlop={6} accessibilityRole="button" accessibilityLabel="Decline invite">
                            <Ionicons name="close-circle" size={22} color={C.outline} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <Text style={styles.mutedTag}>{inv.status === 'countered' ? 'Countered' : 'Pending'}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Leaderboards — Weekly Consistency · Streak · Tempo Score (shared board). */}
          {board.length > 1 && (
            <>
              <Text style={styles.sectionLabel}>LEADERBOARD</Text>
              <LeaderboardBoard
                rows={board}
                currentUserId={userId}
                onOpenProfile={(id) => router.push(`/friend-profile?userId=${id}` as any)}
              />
            </>
          )}

          {/* Activity feed — friends' completions (reactable) + milestones (streaks, badges) */}
          {activity.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>FRIEND ACTIVITY</Text>
              <View style={styles.card}>
                {activity.map((a, i) => (
                  <View key={a.kind === 'completed' ? `c-${a.c.user_id}-${a.c.completed_at}` : `e-${a.e.user_id}-${a.e.kind}-${a.e.created_at}`}>
                    {i > 0 && <View style={styles.divider} />}
                    {a.kind === 'completed' ? (
                      <View style={styles.feedRow}>
                        <TouchableOpacity
                          style={styles.feedMain}
                          activeOpacity={0.7}
                          onPress={() => router.push(`/friend-profile?userId=${a.c.user_id}` as any)}
                        >
                          <FriendAvatar avatarUrl={a.c.avatar_url} size={34} />
                          <Text style={styles.feedText} numberOfLines={2}>
                            <Text style={styles.feedName}>{a.c.display_name ?? `@${a.c.username}`}</Text>
                            {' completed '}
                            <Text style={styles.feedName}>{a.c.focus}</Text>
                          </Text>
                        </TouchableOpacity>
                        <View style={styles.feedRight}>
                          <Text style={styles.feedTime}>{timeAgo(a.c.completed_at)}</Text>
                          {!!a.c.workout_id && (
                            <TouchableOpacity
                              style={[styles.reactBtn, a.c.i_reacted && styles.reactBtnOn]}
                              onPress={() => onReact(a.c)}
                              activeOpacity={0.7}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={a.c.i_reacted ? 'Remove your reaction' : 'React: nice work'}
                            >
                              <Ionicons
                                name={a.c.i_reacted ? 'flame' : 'flame-outline'}
                                size={15}
                                color={a.c.i_reacted ? C.ember : C.textSecondary}
                              />
                              {(a.c.reaction_count ?? 0) > 0 && (
                                <Text style={[styles.reactCount, a.c.i_reacted && { color: C.ember }]}>
                                  {a.c.reaction_count}
                                </Text>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.feedRow}
                        activeOpacity={0.7}
                        onPress={() => router.push(`/friend-profile?userId=${a.e.user_id}` as any)}
                      >
                        <View style={styles.feedMain}>
                          <FriendAvatar avatarUrl={a.e.avatar_url} size={34} />
                          <Text style={styles.feedText} numberOfLines={2}>
                            <Text style={styles.feedName}>{a.e.display_name ?? `@${a.e.username}`}</Text>
                            {' '}{describeFriendEvent(a.e)}
                          </Text>
                        </View>
                        <Text style={styles.feedTime}>{timeAgo(a.e.created_at)}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Groups — private circles, each with its own leaderboards */}
          <Text style={styles.sectionLabel}>GROUPS</Text>
          {groups.length > 0 && (
            <View style={styles.card}>
              {groups.map((g, i) => (
                <View key={g.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity
                    style={styles.personRow}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/group-detail?id=${g.id}` as any)}
                  >
                    <View style={styles.groupIcon}><Ionicons name="people-circle" size={24} color={C.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personName} numberOfLines={1}>{g.name}</Text>
                      <Text style={styles.personHandle}>{g.member_count} member{g.member_count === 1 ? '' : 's'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.actionRow} onPress={() => setGroupSheetOpen(true)} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={20} color={C.primary} />
            <Text style={styles.actionRowText}>New group or join by code</Text>
          </TouchableOpacity>

          {/* Friends */}
          <Text style={styles.sectionLabel}>MY FRIENDS{accepted.length ? ` · ${accepted.length}` : ''}</Text>
          {accepted.length === 0 ? (
            <EmptyState
              kind="flash"
              title="No friends yet"
              body="Tap ＋ in the top right to search for people or share your friend code. Friends can see each other's workouts and progress — as much or as little as you choose."
            />
          ) : (
            <View style={styles.card}>
              {accepted.map((f, i) => (
                <FadeInView key={f.friendshipId} delay={Math.min(i * 40, 200)}>
                  {personRow(
                    f,
                    <View style={styles.reqActions}>
                      <TouchableOpacity onPress={() => handleRemove(f)} hitSlop={6}>
                        <Ionicons name="ellipsis-horizontal" size={18} color={C.outline} />
                      </TouchableOpacity>
                      <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />
                    </View>,
                    () => router.push(`/friend-profile?userId=${f.user_id}` as any),
                  )}
                </FadeInView>
              ))}
            </View>
          )}
          {outgoing.length > 0 && (
            <Text style={styles.pendingNote}>
              {outgoing.length} request{outgoing.length === 1 ? '' : 's'} pending — waiting on them to accept.
            </Text>
          )}

          {/* Settings — privacy + who-can-see, tucked into a sheet to keep this clean */}
          <TouchableOpacity style={[styles.actionRow, { marginTop: Spacing.md }]} onPress={() => setPrivacyOpen(true)} activeOpacity={0.7}>
            <Ionicons name="lock-closed-outline" size={19} color={C.primary} />
            <Text style={styles.actionRowText}>Privacy & sharing</Text>
            <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Add friends — search, your friend code, redeem a shared workout */}
      <TempoSheet visible={addOpen} onClose={() => setAddOpen(false)} snapPoints={['85%']} scroll>
        <View style={styles.sheetPad}>
          <Text style={styles.sheetTitle}>Add friends</Text>
          {identity?.friend_code && (
            <View style={styles.identityCard}>
              <View style={{ flex: 1 }}>
                {!!identity.username && <Text style={styles.identityHandle}>@{identity.username}</Text>}
                <Text style={styles.identityLabel}>YOUR FRIEND CODE</Text>
                <Text style={styles.identityCode}>{identity.friend_code}</Text>
              </View>
              <View style={styles.identityActions}>
                <PressableScale style={styles.identityBtn} onPress={copyMyCode} scaleTo={0.9} accessibilityLabel="Copy friend code">
                  <Ionicons name="copy-outline" size={17} color={C.primary} />
                </PressableScale>
                <PressableScale style={styles.identityBtn} onPress={shareMyCode} scaleTo={0.9} accessibilityLabel="Share friend code">
                  <Ionicons name="share-outline" size={17} color={C.primary} />
                </PressableScale>
              </View>
            </View>
          )}
          <View style={[styles.searchBox, { marginTop: Spacing.md }]}>
            <Ionicons name="search" size={17} color={C.outline} />
            <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Name, @username, or friend code" placeholderTextColor={C.outline} autoCapitalize="none" autoCorrect={false} />
            {searching && <ActivityIndicator size="small" color={C.primary} />}
          </View>
          {query.trim().length >= 2 && !searching && (
            <View style={[styles.card, { marginTop: Spacing.xs }]}>
              {results.length === 0 ? (
                <Text style={styles.emptyInline}>No one found. Try their @username or 6-letter friend code — those always match exactly.</Text>
              ) : results.map((p) => personRow(
                p,
                knownIds.has(p.user_id) ? (
                  <Text style={styles.mutedTag}>{friends.find((f) => f.user_id === p.user_id)?.state === 'friend' ? 'Friends' : 'Pending'}</Text>
                ) : sentTo.has(p.user_id) ? (
                  <Text style={styles.mutedTag}>Sent ✓</Text>
                ) : (
                  <PressableScale style={styles.addBtn} onPress={() => handleAdd(p)} scaleTo={0.9}>
                    <Ionicons name="person-add" size={14} color={C.onPrimary} />
                    <Text style={styles.addBtnText}>Add</Text>
                  </PressableScale>
                ),
              ))}
            </View>
          )}
          <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>GOT A SHARED WORKOUT?</Text>
          <View style={styles.codeRow}>
            <TextInput style={styles.codeInput} value={code} onChangeText={setCode} placeholder="Paste a link or code" placeholderTextColor={C.outline} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => { setAddOpen(false); redeemCode() }} returnKeyType="go" />
            <PressableScale style={[styles.addBtn, { paddingVertical: 10 }]} onPress={() => { setAddOpen(false); redeemCode() }} scaleTo={0.92}>
              <Text style={styles.addBtnText}>Open</Text>
            </PressableScale>
          </View>
        </View>
      </TempoSheet>

      {/* Groups — create / join by code */}
      <TempoSheet visible={groupSheetOpen} onClose={() => setGroupSheetOpen(false)} snapPoints={['58%']} scroll>
        <View style={styles.sheetPad}>
          <Text style={styles.sheetTitle}>Groups</Text>
          <Text style={styles.sheetHint}>Create a private group or join one with its code — each gets its own leaderboards.</Text>
          <Text style={styles.sectionLabel}>NEW GROUP</Text>
          <View style={styles.codeRow}>
            <TextInput style={styles.codeInput} value={groupName} onChangeText={setGroupName} placeholder="Group name" placeholderTextColor={C.outline} maxLength={40} returnKeyType="done" onSubmitEditing={() => { setGroupSheetOpen(false); onCreateGroup() }} />
            <PressableScale style={[styles.addBtn, { paddingVertical: 10 }]} onPress={() => { setGroupSheetOpen(false); onCreateGroup() }} scaleTo={0.92}>
              <Text style={styles.addBtnText}>Create</Text>
            </PressableScale>
          </View>
          <Text style={[styles.sectionLabel, { marginTop: Spacing.md }]}>JOIN A GROUP</Text>
          <View style={styles.codeRow}>
            <TextInput style={styles.codeInput} value={groupCode} onChangeText={setGroupCode} placeholder="Group code" placeholderTextColor={C.outline} autoCapitalize="characters" autoCorrect={false} returnKeyType="go" onSubmitEditing={() => { setGroupSheetOpen(false); onJoinGroup() }} />
            <PressableScale style={[styles.addBtn, { paddingVertical: 10 }]} onPress={() => { setGroupSheetOpen(false); onJoinGroup() }} scaleTo={0.92}>
              <Text style={styles.addBtnText}>Join</Text>
            </PressableScale>
          </View>
        </View>
      </TempoSheet>

      {/* Privacy & sharing */}
      <TempoSheet visible={privacyOpen} onClose={() => setPrivacyOpen(false)} snapPoints={['72%']} scroll>
        <View style={styles.sheetPad}>
          <Text style={styles.sheetTitle}>Privacy & sharing</Text>
          <Text style={styles.sheetHint}>Tap a row to switch between Public, Friends only and Private. Private hides it from everyone, including friends.</Text>
          {privacy && (
            <View style={[styles.card, { marginTop: Spacing.sm }]}>
              {([
                ['privacy_workouts', 'Workouts', 'Who can browse and save your saved workouts'],
                ['privacy_stats', 'Stats', 'Streak, totals and session history'],
                ['privacy_activity', 'Activity', 'Your recent completed sessions'],
                ['privacy_availability', 'Availability', 'Free times, so friends can plan workouts with you'],
              ] as [keyof PrivacyPrefs, string, string][]).map(([key, label, sub], i) => (
                <View key={key}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity style={styles.privacyRow} onPress={() => cyclePrivacy(key)} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personName}>{label}</Text>
                      <Text style={styles.privacySub}>{sub}</Text>
                    </View>
                    <View style={styles.privacyChip}>
                      <Ionicons name={PRIVACY_ICON[privacy[key]] as any} size={13} color={C.primary} />
                      <Text style={styles.privacyChipText}>{PRIVACY_LABEL[privacy[key]]}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      </TempoSheet>

      <OptionSheet
        visible={removeConfirm !== null}
        title={removeConfirm
          ? `${removeConfirm.state === 'friend' ? 'Remove friend' : removeConfirm.state === 'incoming' ? 'Decline request' : 'Cancel request'}?`
          : ''}
        subtitle={removeConfirm?.display_name ?? 'This user'}
        options={removeConfirm ? [{
          key: 'confirm',
          label: removeConfirm.state === 'friend' ? 'Remove friend' : removeConfirm.state === 'incoming' ? 'Decline request' : 'Cancel request',
          icon: 'person-remove-outline',
          destructive: true,
        }] : []}
        onSelect={doRemoveFriendship}
        onClose={() => setRemoveConfirm(null)}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.xs },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    height: 48, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md, marginTop: Spacing.xs,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  card: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden', ...CardShadow },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  personName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  personHandle: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  groupIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  actionRowText: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: C.text },
  sheetPad: { padding: Spacing.lg, gap: Spacing.xs },
  sheetTitle: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3, marginBottom: 2 },
  sheetHint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: Spacing.xs },
  identityCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primarySoft, borderRadius: Radius.xl, padding: Spacing.md, marginTop: Spacing.sm,
  },
  identityHandle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  identityLabel: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: C.primary, letterSpacing: 0.6, marginTop: 4 },
  identityCode: { fontFamily: C.fontNumeric, fontSize: 22, color: C.text, letterSpacing: 3 },
  identityActions: { flexDirection: 'row', gap: Spacing.sm },
  identityBtn: {
    width: 38, height: 38, borderRadius: Radius.full, backgroundColor: C.background,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.outlineVariant,
  },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  feedMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  feedText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 18 },
  feedName: { fontFamily: 'Inter_700Bold', color: C.text },
  feedRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  feedTime: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: C.outline },
  reactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: Radius.full,
    backgroundColor: C.surfaceContainerLow,
  },
  reactBtnOn: { backgroundColor: C.emberSoft },
  reactCount: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  boardTabs: { flexDirection: 'row', gap: 4, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, padding: 3, marginTop: Spacing.sm },
  boardTab: { flex: 1, paddingVertical: 8, borderRadius: Radius.full, alignItems: 'center' },
  boardTabOn: { backgroundColor: C.primary },
  boardTabText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.textSecondary },
  boardTabTextOn: { color: C.onPrimary },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  leaderRowMe: { backgroundColor: C.primarySoft },
  leaderRank: { width: 22, fontFamily: C.fontDisplay, fontSize: 15, color: C.outline, textAlign: 'center' },
  medal: { width: 22, fontSize: 16, textAlign: 'center' },
  leaderName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  leaderCount: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },
  leaderMetricWrap: { alignItems: 'flex-end', minWidth: 48 },
  leaderMetric: { fontFamily: C.fontNumeric, fontSize: 15, color: C.text },
  leaderMetricSub: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: C.textSecondary, marginTop: -1 },
  mutedTag: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primary, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
  },
  addBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.onPrimary },
  reqActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  emptyInline: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, padding: Spacing.md },
  pendingNote: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: Spacing.xs },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  codeInput: {
    flex: 1, height: 46, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text,
  },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: Spacing.md },
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  privacySub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  privacyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primarySoft, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  privacyChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: Spacing.xs },
})
