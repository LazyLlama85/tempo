import { ScrollView, TouchableOpacity, View, Text, StyleSheet, Alert, Linking, Modal, TextInput, ActivityIndicator } from 'react-native'
import { useState, useEffect, useCallback } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { requestCalendarPermissions, getCalendarPermissionStatus } from '@/services/calendarService'
import { ACHIEVEMENTS, computeLevel, unlockedCount, type AchievementStats } from '@/lib/achievements'
import { AVATAR_PRESETS, parseAvatar, buildAvatarValue } from '@/lib/avatar'
import {
  getSavedSwaps, getAlternatives, saveSubstitution, removeSubstitution,
  type SavedSwap, type AltExercise,
} from '@/lib/substitutions'

const C = Colors.light

const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build Muscle',
  fat_loss: 'Lose Fat',
  strength: 'Gain Strength',
  general_fitness: 'General Fitness',
  athletic: 'Athletic Performance',
}

const EXP_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

const EQUIPMENT_OPTIONS: { id: string; label: string; icon: string }[] = [
  { id: 'bodyweight', label: 'Bodyweight', icon: 'body-outline' },
  { id: 'dumbbells', label: 'Dumbbells', icon: 'barbell-outline' },
  { id: 'barbell', label: 'Barbell', icon: 'barbell' },
  { id: 'resistance_bands', label: 'Resistance Bands', icon: 'pulse-outline' },
  { id: 'full_gym', label: 'Full Gym', icon: 'business-outline' },
]

function equipmentSummary(equipment: string[] | null | undefined): string {
  if (!equipment || !equipment.length) return 'Bodyweight only'
  if (equipment.includes('full_gym')) return 'Full Gym'
  return equipment
    .map(e => EQUIPMENT_OPTIONS.find(o => o.id === e)?.label ?? e)
    .join(', ')
}

const TIER_COLOR: Record<string, string> = {
  bronze: '#B45309',
  silver: '#64748B',
  gold: '#B8860B',
}

type SettingRowProps = { icon: string; label: string; value: string; onPress?: () => void }
function SettingRow({ icon, label, value, onPress }: SettingRowProps) {
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon as any} size={18} color={C.primary} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />}
    </TouchableOpacity>
  )
}

export default function ProfileScreen() {
  const router = useRouter()
  const { profile, session, signOut, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { stats, isLoading: statsLoading } = useProgressStats(userId)
  const [calendarStatus, setCalendarStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null)

  const avatar = parseAvatar(profile?.avatar_url)
  const level = computeLevel(stats.totalWorkouts)
  const achStats: AchievementStats = {
    totalWorkouts: stats.totalWorkouts,
    streak: stats.streak,
    totalVolumeNum: stats.totalVolumeNum,
    benchMax: stats.benchMax,
  }
  const unlocked = unlockedCount(achStats)

  // Edit-profile modal
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [avatarId, setAvatarId] = useState(AVATAR_PRESETS[0].id)
  const [saving, setSaving] = useState(false)

  // Equipment modal
  const [equipModal, setEquipModal] = useState(false)
  const [equipSel, setEquipSel] = useState<string[]>([])
  const [equipSaving, setEquipSaving] = useState(false)

  // Saved exercise swaps + editor
  const [swaps, setSwaps] = useState<SavedSwap[]>([])
  const [swapModal, setSwapModal] = useState<SavedSwap | null>(null)
  const [alts, setAlts] = useState<AltExercise[]>([])
  const [altsLoading, setAltsLoading] = useState(false)
  const [swapBusy, setSwapBusy] = useState(false)

  useEffect(() => {
    getCalendarPermissionStatus().then(setCalendarStatus)
  }, [])

  const loadSwaps = useCallback(() => {
    if (userId) getSavedSwaps(supabase, userId).then(setSwaps)
  }, [userId])
  // Refresh on focus so a swap just made in a workout shows up here immediately.
  useFocusEffect(loadSwaps)

  const openSwap = async (swap: SavedSwap) => {
    setSwapModal(swap)
    setAltsLoading(true)
    const list = await getAlternatives(supabase, userId, swap.originalId)
    setAlts(list)
    setAltsLoading(false)
  }

  const changeSwapTo = async (altId: string) => {
    if (!swapModal || swapBusy) return
    setSwapBusy(true)
    await saveSubstitution(supabase, userId, swapModal.originalId, altId)
    setSwapBusy(false)
    setSwapModal(null)
    loadSwaps()
  }

  const resetSwap = async () => {
    if (!swapModal || swapBusy) return
    setSwapBusy(true)
    await removeSubstitution(supabase, userId, swapModal.originalId)
    setSwapBusy(false)
    setSwapModal(null)
    loadSwaps()
  }

  const openEdit = () => {
    setNameInput(profile?.display_name ?? '')
    const match = AVATAR_PRESETS.find(p => p.icon === avatar.icon && p.color === avatar.color)
    setAvatarId(match?.id ?? AVATAR_PRESETS[0].id)
    setEditing(true)
  }

  const saveProfile = async () => {
    if (!userId || saving) return
    setSaving(true)
    const preset = AVATAR_PRESETS.find(p => p.id === avatarId) ?? AVATAR_PRESETS[0]
    try {
      await supabase
        .from('user_profiles')
        .update({
          display_name: nameInput.trim() || null,
          avatar_url: buildAvatarValue(preset.icon, preset.color),
        })
        .eq('user_id', userId)
      await refreshProfile()
      setEditing(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const openEquip = () => {
    setEquipSel(profile?.equipment ?? ['bodyweight'])
    setEquipModal(true)
  }

  const toggleEquip = (id: string) => {
    setEquipSel(prev => (prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]))
  }

  const saveEquipment = async () => {
    if (!userId || equipSaving) return
    setEquipSaving(true)
    // Always keep at least bodyweight so plans/quick workouts never have nothing to pull from.
    const next = equipSel.length ? equipSel : ['bodyweight']
    try {
      await supabase.from('user_profiles').update({ equipment: next }).eq('user_id', userId)
      await refreshProfile()
      setEquipModal(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setEquipSaving(false)
    }
  }

  const handleCalendarIntegration = async () => {
    if (calendarStatus === 'granted') {
      Alert.alert('Calendar Connected', 'Add workouts to your device calendar from the Schedule tab.')
    } else if (calendarStatus === 'denied') {
      Alert.alert('Permission Denied', 'Allow Tempo to access your calendar in Settings.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ])
    } else {
      const granted = await requestCalendarPermissions()
      const newStatus = granted ? 'granted' : 'denied'
      setCalendarStatus(newStatus)
      if (granted) Alert.alert('Calendar Connected', 'Add workouts to your device calendar from the Schedule tab.')
    }
  }

  const statValue = (v: string | number) => (statsLoading ? '—' : String(v))

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerLogo}>TEMPO</Text>
        <TouchableOpacity onPress={openEdit} hitSlop={8}>
          <Ionicons name="create-outline" size={22} color={C.text} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Hero (gaming-style header banner) ───────────────────────────── */}
        <View style={[styles.hero, { backgroundColor: avatar.color }]}>
          <View style={styles.heroTopRow}>
            <View style={styles.levelChip}>
              <Ionicons name="star" size={12} color="#fff" />
              <Text style={styles.levelChipText}>LVL {level.level} · {level.title.toUpperCase()}</Text>
            </View>
            <TouchableOpacity onPress={openEdit} hitSlop={8}>
              <Ionicons name="pencil" size={16} color="rgba(255,255,255,0.9)" />
            </TouchableOpacity>
          </View>

          <View style={styles.heroAvatarWrap}>
            <View style={styles.avatarLarge}>
              {avatar.imageUri ? (
                <Image source={{ uri: avatar.imageUri }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <Ionicons name={avatar.icon as any} size={38} color={avatar.color} />
              )}
            </View>
          </View>

          <Text style={styles.displayName}>{profile?.display_name ?? 'Athlete'}</Text>
          <Text style={styles.heroSub}>
            {profile?.goal ? GOAL_LABELS[profile.goal] : 'Set your goal'}
            {profile?.experience ? ` · ${EXP_LABELS[profile.experience]}` : ''}
          </Text>

          {/* Level progress */}
          <View style={styles.levelBarTrack}>
            <View style={[styles.levelBarFill, { width: `${Math.round((level.intoLevel / level.perLevel) * 100)}%` as `${number}%` }]} />
          </View>
          <Text style={styles.levelHint}>
            {level.toNext} more workout{level.toNext !== 1 ? 's' : ''} to Level {level.level + 1}
          </Text>
        </View>

        {/* ── Stat grid ───────────────────────────────────────────────────── */}
        <View style={styles.statGrid}>
          <TouchableOpacity style={styles.statTile} onPress={() => router.push('/(tabs)/progress')} activeOpacity={0.8}>
            <Ionicons name="barbell-outline" size={18} color={C.primary} />
            <Text style={styles.statValue}>{statValue(stats.totalWorkouts)}</Text>
            <Text style={styles.statLabel}>WORKOUTS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statTile} onPress={() => router.push('/(tabs)/progress')} activeOpacity={0.8}>
            <Ionicons name="flame-outline" size={18} color={C.primary} />
            <Text style={styles.statValue}>{statsLoading ? '—' : `${stats.streak}`}</Text>
            <Text style={styles.statLabel}>DAY STREAK</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statTile} onPress={() => router.push('/(tabs)/progress')} activeOpacity={0.8}>
            <Ionicons name="trophy-outline" size={18} color={C.primary} />
            <Text style={styles.statValue}>{statValue(stats.totalVolume)}</Text>
            <Text style={styles.statLabel}>LBS LIFTED</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statTile} onPress={() => router.push('/(tabs)/progress')} activeOpacity={0.8}>
            <Ionicons name="ribbon-outline" size={18} color={C.primary} />
            <Text style={styles.statValue}>{statsLoading ? '—' : `${unlocked}/${ACHIEVEMENTS.length}`}</Text>
            <Text style={styles.statLabel}>BADGES</Text>
          </TouchableOpacity>
        </View>

        {/* ── Achievements ────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            <Text style={styles.sectionMeta}>{unlocked} of {ACHIEVEMENTS.length}</Text>
          </View>
          <View style={styles.badgeGrid}>
            {ACHIEVEMENTS.map((a) => {
              const on = a.isUnlocked(achStats)
              const prog = a.progress(achStats)
              const tint = on ? TIER_COLOR[a.tier] : C.outline
              return (
                <View key={a.key} style={[styles.badge, !on && styles.badgeLocked]}>
                  <View style={[styles.badgeIcon, { backgroundColor: on ? tint + '22' : C.surfaceContainerHigh }]}>
                    <Ionicons name={a.icon as any} size={24} color={tint} />
                    {!on && <View style={styles.lockDot}><Ionicons name="lock-closed" size={9} color={C.outline} /></View>}
                  </View>
                  <Text style={[styles.badgeLabel, !on && { color: C.outline }]} numberOfLines={1}>{a.label}</Text>
                  <Text style={styles.badgeDesc} numberOfLines={2}>{a.description}</Text>
                  {!on && prog.target > 1 && (
                    <Text style={styles.badgeProg}>{Math.round(prog.current).toLocaleString()}/{prog.target.toLocaleString()}</Text>
                  )}
                </View>
              )
            })}
          </View>
        </View>

        {/* ── Personal records ────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Personal Records</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/progress')}>
              <Text style={styles.sectionLink}>View all</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.card}>
            {stats.prs.length > 0 ? stats.prs.slice(0, 4).map((pr, i) => (
              <View key={pr.name}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity style={styles.prRow} onPress={() => router.push('/(tabs)/progress')} activeOpacity={0.7}>
                  <View style={styles.prIcon}><Ionicons name="barbell-outline" size={18} color={C.primary} /></View>
                  <Text style={styles.prName} numberOfLines={1}>{pr.name}</Text>
                  <Text style={styles.prValue}>{pr.maxWeight} <Text style={styles.prUnit}>lbs</Text></Text>
                </TouchableOpacity>
              </View>
            )) : (
              <Text style={styles.emptyHint}>Log a few sets and your records will show up here.</Text>
            )}
          </View>
        </View>

        {/* ── Exercise swaps (saved substitution preferences) ─────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Exercise Swaps</Text>
            {swaps.length > 0 && <Text style={styles.sectionMeta}>{swaps.length} saved</Text>}
          </View>
          <View style={styles.card}>
            {swaps.length > 0 ? swaps.map((s, i) => (
              <View key={s.originalId}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity style={styles.swapRow} onPress={() => openSwap(s)} activeOpacity={0.7}>
                  <View style={styles.swapIcon}><Ionicons name="swap-horizontal" size={18} color={C.primary} /></View>
                  <View style={styles.swapInfo}>
                    <Text style={styles.swapFrom} numberOfLines={1}>{s.originalName}</Text>
                    <Text style={styles.swapTo} numberOfLines={1}>→ {s.substituteName}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />
                </TouchableOpacity>
              </View>
            )) : (
              <Text style={styles.emptyHint}>
                No saved swaps yet. Tap “Swap” on any exercise during a workout and Tempo will remember
                it here — then reuse it automatically every time that exercise comes up.
              </Text>
            )}
          </View>
        </View>

        {/* ── My Plan ─────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Plan</Text>
          <View style={styles.card}>
            <SettingRow icon="trophy-outline" label="PRIMARY GOAL" value={profile?.goal ? GOAL_LABELS[profile.goal] : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="barbell-outline" label="EXPERIENCE" value={profile?.experience ? EXP_LABELS[profile.experience] : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="calendar-outline" label="DAYS PER WEEK" value={profile?.days_per_week ? `${profile.days_per_week} days` : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="fitness-outline" label="EQUIPMENT" value={equipmentSummary(profile?.equipment)} onPress={openEquip} />
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.changePlanRow}
              onPress={() =>
                Alert.alert('Change Plan', 'This will replace your current plan.', [
                  { text: 'Cancel' },
                  { text: 'Continue', onPress: () => router.push('/onboarding/goal') },
                ])
              }
            >
              <Text style={styles.changePlanText}>Change Plan</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Integrations + Account ──────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.card}>
            <SettingRow
              icon="calendar-outline"
              label="DEVICE CALENDAR"
              value={calendarStatus === 'granted' ? 'Connected' : calendarStatus === 'denied' ? 'Permission denied' : 'Not connected'}
              onPress={handleCalendarIntegration}
            />
            <View style={styles.divider} />
            <SettingRow icon="sparkles-outline" label="SMART SCHEDULER" value="Auto-schedule in Google Calendar" onPress={() => router.push('/smart-scheduler')} />
            <View style={styles.divider} />
            <SettingRow icon="notifications-outline" label="NOTIFICATIONS" value="On" onPress={() => Linking.openSettings()} />
            <View style={styles.divider} />
            <SettingRow icon="shield-outline" label="PRIVACY" value="tempo.app/privacy" onPress={() => Alert.alert('Privacy Policy', 'Review our privacy policy at tempo.app/privacy.')} />
          </View>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={signOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Edit profile modal ────────────────────────────────────────────── */}
      <Modal visible={editing} animationType="slide" transparent onRequestClose={() => setEditing(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setEditing(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <Text style={styles.modalLabel}>DISPLAY NAME</Text>
            <TextInput
              style={styles.modalInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Your name"
              placeholderTextColor={C.outline}
              maxLength={24}
            />

            <Text style={styles.modalLabel}>AVATAR</Text>
            <View style={styles.avatarPickRow}>
              {AVATAR_PRESETS.map((p) => {
                const sel = p.id === avatarId
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.avatarPick, { backgroundColor: p.color }, sel && styles.avatarPickSel]}
                    onPress={() => setAvatarId(p.id)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={p.icon as any} size={22} color="#fff" />
                    {sel && (
                      <View style={styles.avatarPickCheck}>
                        <Ionicons name="checkmark-circle" size={18} color={C.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={saveProfile} disabled={saving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Equipment modal ───────────────────────────────────────────────── */}
      <Modal visible={equipModal} animationType="slide" transparent onRequestClose={() => setEquipModal(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setEquipModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Your Equipment</Text>
            <Text style={styles.modalHint}>Update this anytime — traveling, home week, or a new gym. It instantly tunes your swaps and Quick Workouts.</Text>

            <View style={{ gap: Spacing.xs, marginTop: Spacing.sm }}>
              {EQUIPMENT_OPTIONS.map((o) => {
                const sel = equipSel.includes(o.id)
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={[styles.equipRow, sel && styles.equipRowSel]}
                    onPress={() => toggleEquip(o.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.equipIcon, sel && { backgroundColor: C.primary }]}>
                      <Ionicons name={o.icon as any} size={18} color={sel ? '#fff' : C.primary} />
                    </View>
                    <Text style={[styles.equipLabel, sel && { color: C.primary }]}>{o.label}</Text>
                    <Ionicons
                      name={sel ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={sel ? C.primary : C.outlineVariant}
                    />
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity style={[styles.saveBtn, equipSaving && { opacity: 0.6 }]} onPress={saveEquipment} disabled={equipSaving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{equipSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Swap editor modal ─────────────────────────────────────────────── */}
      <Modal visible={swapModal !== null} animationType="slide" transparent onRequestClose={() => setSwapModal(null)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSwapModal(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Swap {swapModal?.originalName}</Text>
            <Text style={styles.modalHint}>
              Currently doing <Text style={{ color: C.primary, fontFamily: 'Inter_700Bold' }}>{swapModal?.substituteName}</Text> instead.
              Pick a different alternative, or go back to the original.
            </Text>

            {altsLoading ? (
              <View style={{ paddingVertical: Spacing.xl }}><ActivityIndicator color={C.primary} /></View>
            ) : (
              <ScrollView style={{ maxHeight: 300, marginTop: Spacing.sm }} showsVerticalScrollIndicator={false}>
                <View style={{ gap: Spacing.xs }}>
                  {alts.map((a) => {
                    const current = a.id === swapModal?.substituteId
                    return (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.altRow, current && styles.altRowSel]}
                        onPress={() => changeSwapTo(a.id)}
                        disabled={swapBusy}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.altName, current && { color: C.primary }]} numberOfLines={1}>{a.name}</Text>
                        {a.curated && !current && <Text style={styles.altTag}>SUGGESTED</Text>}
                        {current && <Ionicons name="checkmark-circle" size={20} color={C.primary} />}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </ScrollView>
            )}

            <TouchableOpacity style={[styles.resetBtn, swapBusy && { opacity: 0.6 }]} onPress={resetSwap} disabled={swapBusy} activeOpacity={0.85}>
              <Ionicons name="arrow-undo-outline" size={16} color={C.text} />
              <Text style={styles.resetBtnText}>Use original ({swapModal?.originalName})</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md },
  headerLogo: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.primary, letterSpacing: 2 },
  scroll: { paddingBottom: 120, gap: Spacing.lg },

  // Hero
  hero: {
    marginHorizontal: Spacing.containerPadding,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: 6,
    ...CardShadow,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  levelChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  levelChipText: { fontFamily: 'Inter_800ExtraBold', fontSize: 11, color: '#fff', letterSpacing: 0.5 },
  heroAvatarWrap: { marginTop: Spacing.xs },
  avatarLarge: { width: 84, height: 84, borderRadius: Radius.full, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  displayName: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: '#fff', letterSpacing: -0.3, marginTop: 4 },
  heroSub: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  levelBarTrack: { height: 7, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: Radius.full, marginTop: Spacing.sm },
  levelBarFill: { height: 7, backgroundColor: '#fff', borderRadius: Radius.full },
  levelHint: { fontFamily: 'Inter_500Medium', fontSize: 12, color: 'rgba(255,255,255,0.85)' },

  // Stat grid
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.containerPadding },
  statTile: {
    flexGrow: 1, flexBasis: '47%', backgroundColor: C.background, borderRadius: Radius.lg,
    padding: Spacing.md, gap: 4, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow,
  },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },

  // Sections
  section: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, letterSpacing: -0.1 },
  sectionMeta: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline },
  sectionLink: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },

  // Achievements
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  badge: {
    flexGrow: 1, flexBasis: '30%', maxWidth: '32%', backgroundColor: C.background, borderRadius: Radius.lg,
    padding: Spacing.sm, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.outlineVariant,
  },
  badgeLocked: { backgroundColor: C.surfaceContainerLow },
  badgeIcon: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  lockDot: { position: 'absolute', bottom: -2, right: -2, backgroundColor: C.background, borderRadius: Radius.full, padding: 2 },
  badgeLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.text, textAlign: 'center' },
  badgeDesc: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textSecondary, textAlign: 'center', lineHeight: 13 },
  badgeProg: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary },

  // PRs
  card: { backgroundColor: C.background, borderRadius: Radius.xl, ...CardShadow, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden' },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  prIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  prName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  prValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.text, letterSpacing: -0.3 },
  prUnit: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary },
  emptyHint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, padding: Spacing.md, lineHeight: 19 },

  // Exercise swaps
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  swapIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  swapInfo: { flex: 1 },
  swapFrom: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  swapTo: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.primary, marginTop: 1 },
  altRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  altRowSel: { borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  altName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  altTag: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.primary, letterSpacing: 0.5, backgroundColor: C.primarySoft, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.full, overflow: 'hidden' },
  resetBtn: {
    height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, marginTop: Spacing.md,
  },
  resetBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },

  // Setting rows
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
  settingIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  settingInfo: { flex: 1 },
  settingLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  settingValue: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text, marginTop: 1 },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: 64 },
  changePlanRow: { padding: Spacing.md },
  changePlanText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.primary },

  signOutBtn: { marginHorizontal: Spacing.containerPadding, height: 52, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  signOutText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.error },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(27,27,28,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  modalHandle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.xs },
  modalTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.3 },
  modalHint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, marginTop: 2 },
  equipRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  equipRowSel: { borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  equipIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  equipLabel: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  modalLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.sm },
  modalInput: {
    height: 48, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text,
  },
  avatarPickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  avatarPick: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarPickSel: { borderWidth: 3, borderColor: C.text },
  avatarPickCheck: { position: 'absolute', bottom: -3, right: -3, backgroundColor: '#fff', borderRadius: Radius.full },
  saveBtn: { height: 52, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
