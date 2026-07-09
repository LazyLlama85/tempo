// Tempo — Friends (modal).
//
// The social layer's home: search for people, send/answer friend requests, open
// friend profiles, redeem a shared-workout code, and set who can see your
// workouts / stats / activity. Backed by lib/social + supabase/add_social.sql.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native'
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
import { FriendAvatar } from '@/components/FriendAvatar'
import * as haptics from '@/lib/haptics'
import {
  searchProfiles, fetchFriends, sendFriendRequest, acceptFriendRequest, removeFriendship,
  fetchPrivacy, updatePrivacy,
  type FriendEntry, type SocialProfile, type PrivacyPrefs, type PrivacyLevel,
} from '@/lib/social'

const PRIVACY_ORDER: PrivacyLevel[] = ['public', 'friends', 'private']
const PRIVACY_LABEL: Record<PrivacyLevel, string> = { public: 'Public', friends: 'Friends only', private: 'Private' }
const PRIVACY_ICON: Record<PrivacyLevel, string> = { public: 'globe-outline', friends: 'people-outline', private: 'lock-closed-outline' }

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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    if (!userId) return
    fetchFriends(supabase, userId).then(setFriends).finally(() => setLoading(false))
    fetchPrivacy(supabase, userId).then(setPrivacy).catch(() => {})
  }, [userId])
  useFocusEffect(load)

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
      Alert.alert('Couldn’t send request', 'You may already have a pending request with this person.')
      return
    }
    load()
  }

  const handleAccept = async (f: FriendEntry) => {
    haptics.success()
    if (await acceptFriendRequest(supabase, f.friendshipId)) load()
  }

  const handleRemove = (f: FriendEntry) => {
    const verb = f.state === 'friend' ? 'Remove friend' : f.state === 'incoming' ? 'Decline request' : 'Cancel request'
    Alert.alert(`${verb}?`, f.display_name ?? 'This user', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb, style: 'destructive',
        onPress: async () => { haptics.tapMedium(); if (await removeFriendship(supabase, f.friendshipId)) load() },
      },
    ])
  }

  const redeemCode = () => {
    const c = code.trim().toLowerCase().replace(/^.*\/w\//, '') // paste a link or a code
    if (!c) return
    setCode('')
    router.push(`/shared-workout?code=${encodeURIComponent(c)}` as any)
  }

  const cyclePrivacy = async (key: keyof PrivacyPrefs) => {
    if (!privacy) return
    haptics.tapLight()
    const next = PRIVACY_ORDER[(PRIVACY_ORDER.indexOf(privacy[key]) + 1) % PRIVACY_ORDER.length]
    const updated = { ...privacy, [key]: next }
    setPrivacy(updated)
    if (!(await updatePrivacy(supabase, userId, { [key]: next }))) {
      setPrivacy(privacy) // revert on failure
      Alert.alert('Couldn’t save', 'Check your connection and try again.')
    }
  }

  const incoming = friends.filter((f) => f.state === 'incoming')
  const outgoing = friends.filter((f) => f.state === 'outgoing')
  const accepted = friends.filter((f) => f.state === 'friend')

  const personRow = (p: { user_id: string; display_name: string | null; avatar_url: string | null }, right: React.ReactNode, onPress?: () => void) => (
    <TouchableOpacity key={p.user_id} style={styles.personRow} activeOpacity={onPress ? 0.7 : 1} onPress={onPress} disabled={!onPress}>
      <FriendAvatar avatarUrl={p.avatar_url} size={40} />
      <Text style={styles.personName} numberOfLines={1}>{p.display_name ?? 'Tempo user'}</Text>
      {right}
    </TouchableOpacity>
  )

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Friends</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><PulseLoader caption="Loading your people…" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Search */}
          <View style={styles.searchBox}>
            <Ionicons name="search" size={17} color={C.outline} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search people by name"
              placeholderTextColor={C.outline}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={C.primary} />}
          </View>
          {query.trim().length >= 2 && !searching && (
            <View style={styles.card}>
              {results.length === 0 ? (
                <Text style={styles.emptyInline}>No one found — names match as typed.</Text>
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
                () => router.push(`/friend-profile?userId=${p.user_id}` as any),
              ))}
            </View>
          )}

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

          {/* Friends */}
          <Text style={styles.sectionLabel}>MY FRIENDS{accepted.length ? ` · ${accepted.length}` : ''}</Text>
          {accepted.length === 0 ? (
            <EmptyState
              kind="flash"
              title="No friends yet"
              body="Search a name above to send your first request. Friends can see each other's workouts and progress — as much or as little as you choose below."
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

          {/* Redeem a share */}
          <Text style={styles.sectionLabel}>GOT A SHARED WORKOUT?</Text>
          <View style={styles.codeRow}>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={setCode}
              placeholder="Paste a link or code"
              placeholderTextColor={C.outline}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={redeemCode}
              returnKeyType="go"
            />
            <PressableScale style={[styles.addBtn, { paddingVertical: 10 }]} onPress={redeemCode} scaleTo={0.92}>
              <Text style={styles.addBtnText}>Open</Text>
            </PressableScale>
          </View>

          {/* Privacy */}
          <Text style={styles.sectionLabel}>PRIVACY</Text>
          {privacy && (
            <View style={styles.card}>
              {([
                ['privacy_workouts', 'Workouts', 'Who can browse and save your saved workouts'],
                ['privacy_stats', 'Stats', 'Streak, totals and session history'],
                ['privacy_activity', 'Activity', 'Your recent completed sessions'],
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
          <Text style={styles.hint}>Tap a row to switch between Public, Friends only and Private. Private hides it from everyone, including friends.</Text>
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
  personName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
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
