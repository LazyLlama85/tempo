import { ScrollView, TouchableOpacity, View, Text, StyleSheet, Alert, Linking, TextInput, ActivityIndicator } from 'react-native'
import { TempoSheet } from '@/components/TempoSheet'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow, Elevation, BottomTabInset } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { ScreenHeader, HeaderActions, PulseLoader } from '@/components/brand'
import { ScreenTransition } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readinessFromHistory } from '@/lib/fitnessInsights'
import { InsightsGrid, type InsightTile } from '@/components/ProfileCards'
import { computeLevel } from '@/lib/achievements'
import { ACTIVATION_SESSIONS } from '@/lib/activation'
import { badgeStatsFromSessions, computeEarnedBadges, fetchStoredBadges, unviewedBadgeCount } from '@/lib/badges'
import { AVATAR_PRESETS, CUSTOM_AVATAR_ID, parseAvatar, buildAvatarValue, uploadAvatar } from '@/lib/avatar'
import {
  getSavedSwaps, getAlternatives, saveSubstitution, removeSubstitution,
  type SavedSwap, type AltExercise,
} from '@/lib/substitutions'
import { describeTravelEquipment, describeTravelUntil } from '@/lib/travelMode'
import {
  fetchMeasurements, logMeasurement, computeWeightTrend, computeMetricTrend,
} from '@/lib/bodyMeasurements'
import {
  useUnitStore, unitLabel, displayWeight, inputToLbs, formatWeightDelta,
} from '@/lib/units'
import { useProAccess } from '@/stores/entitlements'
import { ProGate } from '@/components/ProGate'
import { restampFuturePlanForExperience } from '@/lib/generatePlan'
import { invalidateTrainingData } from '@/lib/queryInvalidation'
import { pickAndUploadProgressPhoto, progressPhotoUrl } from '@/lib/progressPhotos'
import { updateUsername } from '@/lib/social'
import { OptionSheet } from '@/components/OptionSheet'
import { SaveProgressSheet } from '@/components/SaveProgressSheet'
import { track } from '@/lib/analytics'
import type { TravelMode, BodyMeasurement } from '@/types'


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
  { id: 'bodyweight', label: 'No equipment', icon: 'walk-outline' },
  { id: 'pull_up_bar', label: 'Pull-up & dip bar', icon: 'body-outline' },
  { id: 'dumbbells', label: 'Dumbbells', icon: 'barbell-outline' },
  { id: 'barbell', label: 'Barbell', icon: 'barbell' },
  { id: 'kettlebell', label: 'Kettlebells', icon: 'fitness-outline' },
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

// Body areas the Quick Workout engine knows how to program around (see
// injuriesToRestrictions in lib/quickWorkout.ts — these keywords map to avoided
// muscles/patterns). The stored value is the lowercase id.
const INJURY_OPTIONS: { id: string; label: string; icon: string }[] = [
  { id: 'knee', label: 'Knees', icon: 'walk-outline' },
  { id: 'back', label: 'Lower back', icon: 'body-outline' },
  { id: 'shoulder', label: 'Shoulders', icon: 'barbell-outline' },
  { id: 'elbow', label: 'Elbows', icon: 'fitness-outline' },
  { id: 'wrist', label: 'Wrists', icon: 'hand-left-outline' },
  { id: 'hip', label: 'Hips', icon: 'accessibility-outline' },
  { id: 'hamstring', label: 'Hamstrings', icon: 'walk-outline' },
  { id: 'ankle', label: 'Ankles / calves', icon: 'footsteps-outline' },
]

function injurySummary(injuries: string[] | null | undefined): string {
  if (!injuries || !injuries.length) return 'None — train everything'
  return injuries
    .map(i => INJURY_OPTIONS.find(o => o.id === i)?.label ?? i)
    .join(', ')
}

// Travel-mode status for the settings row — "Off" when none or the end date passed.
function travelSummary(tm: TravelMode | null | undefined): string {
  if (!tm?.equipment?.length) return 'Off'
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (tm.until && tm.until < today) return 'Off'
  return `${describeTravelEquipment(tm.equipment)} · ${describeTravelUntil(tm.until)}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function availabilitySummary(tod: string | null | undefined, flex: string | null | undefined): string {
  return `${tod ? cap(tod) : 'Any time'} · ${flex ? cap(flex) : 'Balanced'}`
}

type SettingRowProps = { icon: string; label: string; value: string; onPress?: () => void }
function SettingRow({ icon, label, value, onPress }: SettingRowProps) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
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
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // Bottom sheets must clear the home indicator on notched devices.
  const sheetPad = { paddingBottom: Math.max(insets.bottom, Spacing.lg) }
  const { profile, session, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const queryClient = useQueryClient()
  const { stats, workouts, logTimes } = useProgressStats(userId)

  // Consistency badges (lib/badges): derived from my session history + any stored
  // competitive/social badges. Stored keys refresh on focus so a just-awarded
  // Weekly Winner shows up.
  const [storedBadges, setStoredBadges] = useState<string[]>([])
  useFocusEffect(
    useCallback(() => {
      if (userId) fetchStoredBadges(supabase, userId).then(setStoredBadges).catch(() => {})
    }, [userId]),
  )
  const earnedBadges = useMemo(
    () => computeEarnedBadges(
      badgeStatsFromSessions(workouts, profile?.days_per_week ?? 3, new Date().toISOString().slice(0, 10), {
        totalWorkouts: stats.totalWorkouts, totalVolume: stats.totalVolumeNum,
      }),
      new Set(storedBadges),
    ),
    [workouts, profile?.days_per_week, storedBadges, stats.totalWorkouts, stats.totalVolumeNum],
  )
  // The header count is UNVIEWED badges (new since you last opened the trophy case).
  const newBadges = unviewedBadgeCount(earnedBadges, userId)

  // Incoming friend requests — a badge on the header Friends button, so a
  // request can't sit invisible inside the Friends screen forever.
  const [pendingRequests, setPendingRequests] = useState(0)
  const [pendingInvites, setPendingInvites] = useState(0)
  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('addressee_id', userId)
        .eq('status', 'pending')
        .then(({ count }) => setPendingRequests(count ?? 0))
      // Incoming workout invites count toward the same Friends badge.
      supabase
        .from('workout_invites')
        .select('id', { count: 'exact', head: true })
        .eq('to_user', userId)
        .eq('status', 'pending')
        .then(({ count }) => setPendingInvites(count ?? 0), () => {})
    }, [userId]),
  )
  // One "social" indicator on the Friends button: requests + incoming invites.
  const socialNotifs = pendingRequests + pendingInvites
  // Progressive disclosure (B3.2): no network exists yet, so surfacing Friends/
  // Groups before the core loop is proven is pure overwhelm. Gated on the same
  // live, already-fetched `stats.totalWorkouts` the level/badges above use — never
  // the fire-once activation *flag*, which wouldn't retroactively unlock this for
  // an already-engaged existing user. A real pending signal (an actual friend
  // request or invite) always shows regardless — hiding a genuine notification
  // would be a regression, not progressive disclosure.
  const activated = stats.totalWorkouts >= ACTIVATION_SESSIONS

  const avatar = parseAvatar(profile?.avatar_url)
  const level = computeLevel(stats.totalWorkouts)

  // Profile insights (premium redesign) — a history-based readiness + progress stats.
  const readiness = useMemo(() => readinessFromHistory(workouts, logTimes, new Date()), [workouts, logTimes])

  const insightTiles: InsightTile[] = [
    { icon: 'checkmark-done', label: 'Workouts', value: String(stats.totalWorkouts), tint: C.primary },
    { icon: 'flame', label: 'Day streak', value: String(stats.streak), tint: C.ember },
    { icon: 'pulse', label: 'Consistency', value: `${stats.consistency_pct ?? 0}%`, tint: C.success },
    { icon: 'trophy', label: 'PRs', value: String(stats.prs?.length ?? 0), tint: C.gold },
    { icon: 'barbell', label: 'Volume', value: stats.totalVolume ?? '0', tint: C.primaryBright },
    { icon: 'heart', label: 'Readiness', value: String(readiness.score), tint: readiness.score >= 80 ? C.readyHigh : readiness.score >= 55 ? C.readyMed : C.readyLow },
  ]

  // Edit-profile modal
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [avatarId, setAvatarId] = useState(AVATAR_PRESETS[0].id)
  const [saving, setSaving] = useState(false)

  // Equipment modal
  const [equipModal, setEquipModal] = useState(false)
  const [equipSel, setEquipSel] = useState<string[]>([])
  const [equipSaving, setEquipSaving] = useState(false)

  // Goal / Experience / Days Per Week — single-field edits. Goal/Experience also
  // re-stamp the active Tempo-GENERATED plan (restampFuturePlanForExperience
  // no-ops for a split-driven user — "a split-driven user has no active plan to
  // re-stamp"). Days Per Week deliberately does NOT trigger any regeneration or
  // touch `splits` at all — it's just saved. A user on their own custom split
  // must never be silently switched onto a Tempo-generated plan just because they
  // tweaked this number; a real reshape of a Tempo plan's schedule still requires
  // the explicit "Change Plan" action below.
  const [goalSheet, setGoalSheet] = useState(false)
  const [expSheet, setExpSheet] = useState(false)
  const [daysSheet, setDaysSheet] = useState(false)
  const [fieldSaving, setFieldSaving] = useState(false)

  // Saved exercise swaps + editor
  const [swaps, setSwaps] = useState<SavedSwap[]>([])
  const [swapModal, setSwapModal] = useState<SavedSwap | null>(null)
  const [alts, setAlts] = useState<AltExercise[]>([])
  const [altsLoading, setAltsLoading] = useState(false)
  const [swapBusy, setSwapBusy] = useState(false)

  // Body measurement history + log-entry modal
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([])
  const [bodyModal, setBodyModal] = useState(false)
  const [weightInput, setWeightInput] = useState('')
  const [bodyFatInput, setBodyFatInput] = useState('')
  const [waistInput, setWaistInput] = useState('')
  const [bodySaving, setBodySaving] = useState(false)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // Injuries / limitations modal
  const [injuryModal, setInjuryModal] = useState(false)
  const [injurySel, setInjurySel] = useState<string[]>([])
  const [injurySaving, setInjurySaving] = useState(false)

  // Weight display unit (lb/kg) — a device preference; storage stays lbs.
  // (The lb/kg TOGGLE moved to Settings; the value itself is still read here
  // for Body Stats + the measurement-log modal.)
  const unit = useUnitStore((s) => s.unit)

  // Straggler confirm migrated off native Alert.alert onto the branded OptionSheet.
  const [changePlanSheet, setChangePlanSheet] = useState(false)

  const loadSwaps = useCallback(() => {
    if (userId) getSavedSwaps(supabase, userId).then(setSwaps)
  }, [userId])
  // Refresh on focus so a swap just made in a workout shows up here immediately.
  useFocusEffect(loadSwaps)

  const loadMeasurements = useCallback(() => {
    if (userId) fetchMeasurements(supabase, userId, 120).then(setMeasurements).catch(() => {})
  }, [userId])
  useFocusEffect(loadMeasurements)

  // 4-week regression: weekly trend, smoothed current weight, and total change.
  const trend = computeWeightTrend(measurements)
  // Optional body-composition trends (only render when the user has logged them).
  const bodyFatTrend = computeMetricTrend(measurements, 'body_fat_pct')
  const waistTrend = computeMetricTrend(measurements, 'waist_in')

  // Guests can permanently lose their history on a reinstall/new phone — give them
  // a standalone, discoverable way to attach an Apple/Google account (§1.1). The
  // card disappears the moment the session is no longer anonymous.
  const isGuest = !!session?.user.is_anonymous

  // Tempo Pro (§10) — the PRO badge on the hero card. The Subscription/Tester
  // Tools rows using the rest of this store moved to Settings.
  const { isPro } = useProAccess()
  const [saveSheetVisible, setSaveSheetVisible] = useState(false)
  const openSaveProgress = () => { track('guest_save_prompt_shown', { context: 'profile' }); setSaveSheetVisible(true) }

  const openInjuries = () => {
    setInjurySel(profile?.injuries ?? [])
    setInjuryModal(true)
  }
  const toggleInjury = (id: string) =>
    setInjurySel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const saveInjuries = async () => {
    if (!userId || injurySaving) return
    setInjurySaving(true)
    try {
      await supabase.from('user_profiles').update({ injuries: injurySel }).eq('user_id', userId)
      await refreshProfile()
      setInjuryModal(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setInjurySaving(false)
    }
  }

  // Reset the log-entry modal (inputs + any attached photo) before opening it.
  const openBody = () => {
    setWeightInput(''); setBodyFatInput(''); setWaistInput('')
    setPhotoPath(null); setPhotoPreview(null)
    setBodyModal(true)
  }

  const handleAvatarPress = async () => {
    if (avatarUploading || !userId) return
    setAvatarUploading(true)
    const res = await uploadAvatar(supabase, userId)
    setAvatarUploading(false)
    if (res.status === 'ok') {
      try {
        await supabase.from('user_profiles').update({ avatar_url: res.url }).eq('user_id', userId)
        await refreshProfile()
        // So the Edit Profile grid (if open) immediately shows the photo tile as
        // selected instead of whatever preset was picked before.
        setAvatarId(CUSTOM_AVATAR_ID)
      } catch {
        Alert.alert('Couldn’t save', 'Your photo uploaded but saving it to your profile failed. Please try again.')
      }
    } else if (res.status === 'denied') {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to set a profile picture.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ])
    } else if (res.status === 'error') {
      Alert.alert('Upload failed', 'Could not upload that photo. Please try again.')
    }
  }

  const attachPhoto = async () => {
    if (photoBusy || !userId) return
    setPhotoBusy(true)
    const res = await pickAndUploadProgressPhoto(supabase, userId)
    setPhotoBusy(false)
    if (res.status === 'ok') {
      setPhotoPath(res.path)
      progressPhotoUrl(supabase, res.path).then(setPhotoPreview)
    } else if (res.status === 'denied') {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to attach a progress photo.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ])
    } else if (res.status === 'error') {
      Alert.alert('Upload failed', 'Could not upload that photo. Please try again.')
    }
  }

  const saveBodyEntry = async () => {
    if (!userId || bodySaving) return
    const weight = parseFloat(weightInput)
    const bf = parseFloat(bodyFatInput)
    const waist = parseFloat(waistInput)
    // Allow an entry with just a photo (no numbers) too.
    if (![weight, bf, waist].some(Number.isFinite) && !photoPath) { setBodyModal(false); return }
    setBodySaving(true)
    try {
      await logMeasurement(supabase, userId, {
        // Input is in the display unit; storage is always lbs.
        weight_lbs: Number.isFinite(weight) ? inputToLbs(weightInput, unit) : null,
        body_fat_pct: Number.isFinite(bf) ? bf : null,
        waist_in: Number.isFinite(waist) ? waist : null,
        photo_url: photoPath,
      })
      setWeightInput(''); setBodyFatInput(''); setWaistInput('')
      setPhotoPath(null); setPhotoPreview(null)
      setBodyModal(false)
      loadMeasurements()
      refreshProfile()  // keep the cached profile weight current
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setBodySaving(false)
    }
  }

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
    setUsernameInput(profile?.username ?? '')
    // A real photo takes precedence — show the photo tile selected, not whichever
    // preset's icon/color happen to be left behind in avatar_url's sentinel form.
    if (avatar.imageUri) {
      setAvatarId(CUSTOM_AVATAR_ID)
    } else {
      const match = AVATAR_PRESETS.find(p => p.icon === avatar.icon && p.color === avatar.color)
      setAvatarId(match?.id ?? AVATAR_PRESETS[0].id)
    }
    setEditing(true)
  }

  const saveProfile = async () => {
    if (!userId || saving) return
    setSaving(true)
    // A custom photo is already persisted the moment it's uploaded (handleAvatarPress)
    // — Save only needs to (re-)write avatar_url when a PRESET is the active choice,
    // so it never clobbers an uploaded photo with whatever preset was selected before.
    const preset = avatarId === CUSTOM_AVATAR_ID ? null : (AVATAR_PRESETS.find(p => p.id === avatarId) ?? AVATAR_PRESETS[0])
    try {
      // Username first — it can fail validation/uniqueness independently, and
      // the user should hear about exactly that instead of a generic error.
      const desired = usernameInput.trim().toLowerCase().replace(/^@/, '')
      if (desired && desired !== (profile?.username ?? '')) {
        const res = await updateUsername(supabase, userId, desired)
        if (res === 'invalid') {
          Alert.alert('Invalid username', '3–20 characters, lowercase letters, numbers and _ only.')
          setSaving(false)
          return
        }
        if (res === 'taken') {
          Alert.alert('Username taken', `@${desired} already belongs to someone else — try another.`)
          setSaving(false)
          return
        }
        if (res === 'failed') throw new Error('username update failed')
      }
      await supabase
        .from('user_profiles')
        .update({
          display_name: nameInput.trim() || null,
          ...(preset ? { avatar_url: buildAvatarValue(preset.icon, preset.color) } : {}),
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

  const saveTrainingField = async (field: 'goal' | 'experience', value: string) => {
    if (!userId || fieldSaving) return
    setFieldSaving(true)
    try {
      await supabase.from('user_profiles').update({ [field]: value }).eq('user_id', userId)
      await refreshProfile()
      await restampFuturePlanForExperience(supabase, userId)
      invalidateTrainingData(queryClient)
      setGoalSheet(false)
      setExpSheet(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setFieldSaving(false)
    }
  }

  // Days Per Week — deliberately just a field save. No restamp, no split touch:
  // this number is descriptive metadata for stats/badges/heuristics elsewhere, not
  // the source of truth for either a Tempo plan's actual schedule or a custom
  // split's day count. Reshaping a Tempo-generated plan's schedule still requires
  // the explicit "Change Plan" action.
  const saveDaysPerWeek = async (value: string) => {
    if (!userId || fieldSaving) return
    setFieldSaving(true)
    try {
      await supabase.from('user_profiles').update({ days_per_week: parseInt(value, 10) }).eq('user_id', userId)
      await refreshProfile()
      setDaysSheet(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setFieldSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
      <ScreenHeader
        right={
          <HeaderActions>
            {/* Hidden pre-activation (audit §05 First-Week residual): an empty
                badge case is overwhelm, not value, for a day-1 user. Same gate
                as Friends below — `newBadges > 0` keeps it visible for anyone
                who's already earned one, even before hitting ACTIVATION_SESSIONS,
                so nobody who's already earned a badge ever loses access to it. */}
            {(activated || newBadges > 0) && (
            <TouchableOpacity
              onPress={() => router.push('/badges' as any)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={newBadges > 0 ? `Badges — ${newBadges} new` : 'Badges'}
            >
              <Ionicons name="ribbon-outline" size={22} color={C.text} />
              {newBadges > 0 && (
                <View style={styles.badgeCount}>
                  <Text style={styles.friendBadgeText}>{newBadges > 9 ? '9+' : newBadges}</Text>
                </View>
              )}
            </TouchableOpacity>
            )}
            {(activated || socialNotifs > 0) && (
              <TouchableOpacity
                onPress={() => router.push('/social' as any)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={socialNotifs > 0 ? `Friends — ${socialNotifs} new` : 'Friends'}
              >
                <Ionicons name="people-outline" size={22} color={C.text} />
                {socialNotifs > 0 && (
                  <View style={styles.friendBadge}>
                    <Text style={styles.friendBadgeText}>{socialNotifs > 9 ? '9+' : socialNotifs}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push('/settings' as any)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={22} color={C.text} />
            </TouchableOpacity>
          </HeaderActions>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Profile card — dark, modular: header · XP · stats grid ───────── */}
        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <TouchableOpacity style={styles.heroAvatarWrap} onPress={handleAvatarPress} disabled={avatarUploading} activeOpacity={0.85}>
              <View style={[styles.avatarLarge, { backgroundColor: avatar.color }]}>
                {avatarUploading ? (
                  <ActivityIndicator color="#fff" />
                ) : avatar.imageUri ? (
                  <Image source={{ uri: avatar.imageUri }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Ionicons name={avatar.icon as any} size={30} color="#fff" />
                )}
              </View>
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={12} color={avatar.color} />
              </View>
            </TouchableOpacity>

            <View style={styles.heroHeaderInfo}>
              <View style={styles.heroNameRow}>
                <Text style={styles.displayName} numberOfLines={1}>{profile?.display_name ?? 'Athlete'}</Text>
                {isPro && (
                  <View style={styles.proBadge}>
                    <Ionicons name="flash" size={10} color="#1b1400" />
                    <Text style={styles.proBadgeText}>PRO</Text>
                  </View>
                )}
              </View>
              {!!profile?.username && <Text style={styles.username} numberOfLines={1}>@{profile.username}</Text>}
              <View style={styles.levelChip}>
                <Ionicons name="star" size={11} color={C.primary} />
                <Text style={styles.levelChipText}>LVL {level.level} · {level.title.toUpperCase()}</Text>
              </View>
            </View>

            <TouchableOpacity onPress={openEdit} style={styles.heroEditBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit profile">
              <Ionicons name="pencil" size={15} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* XP progress */}
          <View style={styles.levelBarTrack}>
            <View style={[styles.levelBarFill, { width: `${Math.round((level.intoLevel / level.perLevel) * 100)}%` as `${number}%` }]} />
          </View>
          <Text style={styles.levelHint}>
            {level.toNext} more workout{level.toNext !== 1 ? 's' : ''} to Level {level.level + 1}
            {profile?.goal ? `  ·  ${GOAL_LABELS[profile.goal]}` : ''}
          </Text>

          {/* Secondary stats grid */}
          <View style={styles.heroStatsGrid}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: C.ember }]}>{stats.streak}</Text>
              <Text style={styles.heroStatLabel}>Day streak</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{stats.totalWorkouts}</Text>
              <Text style={styles.heroStatLabel}>Workouts</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: C.success }]}>{stats.consistency_pct ?? 0}%</Text>
              <Text style={styles.heroStatLabel}>Consistency</Text>
            </View>
          </View>
        </View>

        {/* ── Tempo insights ───────────────────────────────────────────────── */}
        <View style={styles.identitySection}>
          <InsightsGrid tiles={insightTiles} delay={100} />
        </View>

        {/* ── Save your progress (guest → permanent account, §1.1) ────────────
            Standalone entry point — deliberately NOT nested in calendar settings. */}
        {isGuest && (
          <TouchableOpacity style={styles.saveCard} onPress={openSaveProgress} activeOpacity={0.85}>
            <View style={styles.saveIcon}>
              <Ionicons name="shield-checkmark" size={22} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.saveTitle}>Save your progress</Text>
              <Text style={styles.saveBody}>You’re training as a guest. Sign in so this history is never lost — even on a new phone.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.primary} />
          </TouchableOpacity>
        )}

        {/* ── Body stats (weight trend over time) ─────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Body Stats</Text>
            <View style={{ flexDirection: 'row', gap: Spacing.md }}>
              <TouchableOpacity onPress={() => router.push('/(tabs)/progress')}>
                <Text style={styles.sectionLink}>View trend</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/progress-photos' as any)}>
                <Text style={styles.sectionLink}>Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openBody}>
                <Text style={styles.sectionLink}>Log entry</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.card}>
            {trend.currentAvg != null ? (
              <>
              <View style={styles.bodyRow}>
                <View style={styles.bodyCell}>
                  <Text style={styles.bodyCellLabel}>CURRENT (7-DAY AVG)</Text>
                  <Text style={styles.bodyCellValue}>
                    {displayWeight(trend.currentAvg, unit)} <Text style={styles.bodyCellUnit}>{unitLabel(unit)}</Text>
                  </Text>
                </View>
                <View style={styles.bodyCellDivider} />
                <View style={styles.bodyCell}>
                  <Text style={styles.bodyCellLabel}>WEEKLY TREND</Text>
                  <Text style={[styles.bodyCellValue, trend.lbsPerWeek != null && trend.lbsPerWeek < 0 && { color: C.primary }]}>
                    {trend.lbsPerWeek != null ? `${formatWeightDelta(trend.lbsPerWeek, unit)}/wk` : '—'}
                  </Text>
                  {trend.totalChange != null && (
                    <Text style={styles.bodyCellSub}>
                      {formatWeightDelta(trend.totalChange, unit)} over {trend.samples} weigh-ins
                    </Text>
                  )}
                </View>
              </View>
              {(bodyFatTrend.latest != null || waistTrend.latest != null) && (
                <View style={styles.bodyMetricRow}>
                  {bodyFatTrend.latest != null && (
                    <Text style={styles.bodyMetric}>
                      Body fat <Text style={styles.bodyMetricVal}>{bodyFatTrend.latest}%</Text>
                      {bodyFatTrend.perWeek != null ? `  ${bodyFatTrend.perWeek > 0 ? '+' : ''}${bodyFatTrend.perWeek}/wk` : ''}
                    </Text>
                  )}
                  {waistTrend.latest != null && (
                    <Text style={styles.bodyMetric}>
                      Waist <Text style={styles.bodyMetricVal}>{waistTrend.latest}"</Text>
                      {waistTrend.perWeek != null ? `  ${waistTrend.perWeek > 0 ? '+' : ''}${waistTrend.perWeek}/wk` : ''}
                    </Text>
                  )}
                </View>
              )}
              </>
            ) : (
              <Text style={styles.emptyHint}>
                Log your weight to start tracking trends. Tempo smooths daily noise and shows your real
                weekly rate — the feedback loop that tells you if your plan is working.
              </Text>
            )}
          </View>
        </View>

        {/* Saved exercise swaps — only shown once the user actually has some, so it
            isn't a prominent empty category at the top. Management stays fully intact. */}
        {swaps.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Exercise Swaps</Text>
            <Text style={styles.sectionMeta}>{swaps.length} saved</Text>
          </View>
          <View style={styles.card}>
            {swaps.map((s, i) => (
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
            ))}
          </View>
        </View>
        )}

        {/* ── Right Now (temporary / personal adjustments) ──────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Right Now</Text>
          <Text style={styles.sectionSubtitle}>Temporary adjustments Tempo applies to your upcoming workouts.</Text>
          <View style={styles.card}>
            <ProGate feature="travel_mode" compact>
              <SettingRow
                icon="airplane-outline"
                label="TRAVEL MODE"
                value={travelSummary(profile?.travel_mode)}
                onPress={() => router.push('/travel-mode')}
              />
            </ProGate>
            <View style={styles.divider} />
            <SettingRow icon="medkit-outline" label="INJURIES & LIMITATIONS" value={injurySummary(profile?.injuries)} onPress={openInjuries} />
          </View>
        </View>

        {/* ── Training ────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Training</Text>
          <View style={styles.card}>
            <SettingRow icon="construct-outline" label="MY WORKOUTS" value="Build, save & schedule" onPress={() => router.push('/my-workouts' as any)} />
            <View style={styles.divider} />
            <SettingRow icon="repeat-outline" label="MY SPLITS" value="Your weekly schedule" onPress={() => router.push('/my-splits' as any)} />
            <View style={styles.divider} />
            <SettingRow icon="journal-outline" label="WORKOUT HISTORY" value="Every logged session" onPress={() => router.push('/workout-history' as any)} />
            <View style={styles.divider} />
            <SettingRow icon="trophy-outline" label="PRIMARY GOAL" value={profile?.goal ? GOAL_LABELS[profile.goal] : '—'} onPress={() => setGoalSheet(true)} />
            <View style={styles.divider} />
            <SettingRow icon="barbell-outline" label="EXPERIENCE" value={profile?.experience ? EXP_LABELS[profile.experience] : '—'} onPress={() => setExpSheet(true)} />
            <View style={styles.divider} />
            <SettingRow icon="calendar-outline" label="DAYS PER WEEK" value={profile?.days_per_week ? `${profile.days_per_week} days` : '—'} onPress={() => setDaysSheet(true)} />
            <View style={styles.divider} />
            <SettingRow icon="fitness-outline" label="EQUIPMENT" value={equipmentSummary(profile?.equipment)} onPress={openEquip} />
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.changePlanRow}
              onPress={() => setChangePlanSheet(true)}
            >
              <Text style={styles.changePlanText}>Change Plan</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Social (B3.2: hidden pre-activation — no network exists yet, so this
              is overwhelm, not value, before the core loop is proven) ──────────── */}
        {activated && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Social</Text>
            <View style={styles.card}>
              <SettingRow icon="people-outline" label="FRIENDS" value="Find people, share workouts & privacy" onPress={() => router.push('/social' as any)} />
            </View>
          </View>
        )}

      </ScrollView>

      {/* ── Log body measurement modal ────────────────────────────────────── */}
      <TempoSheet visible={bodyModal} onClose={() => setBodyModal(false)} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Log Measurement</Text>
            <Text style={styles.modalHint}>Weigh in regularly — even a few times a week is enough for Tempo to read your real trend. Body fat and waist are optional.</Text>

            <Text style={styles.modalLabel}>WEIGHT ({unitLabel(unit).toUpperCase()})</Text>
            <TextInput
              style={styles.modalInput}
              value={weightInput}
              onChangeText={setWeightInput}
              placeholder={unit === 'kg' ? 'e.g. 80' : 'e.g. 175'}
              placeholderTextColor={C.outline}
              keyboardType="decimal-pad"
              maxLength={6}
            />

            <Text style={styles.modalLabel}>BODY FAT % (OPTIONAL)</Text>
            <TextInput
              style={styles.modalInput}
              value={bodyFatInput}
              onChangeText={setBodyFatInput}
              placeholder="e.g. 18"
              placeholderTextColor={C.outline}
              keyboardType="decimal-pad"
              maxLength={5}
            />

            <Text style={styles.modalLabel}>WAIST (IN, OPTIONAL)</Text>
            <TextInput
              style={styles.modalInput}
              value={waistInput}
              onChangeText={setWaistInput}
              placeholder="e.g. 32"
              placeholderTextColor={C.outline}
              keyboardType="decimal-pad"
              maxLength={5}
            />

            <Text style={styles.modalLabel}>PROGRESS PHOTO (OPTIONAL)</Text>
            <TouchableOpacity style={styles.photoBtn} onPress={attachPhoto} disabled={photoBusy} activeOpacity={0.8}>
              {photoBusy ? (
                <ActivityIndicator color={C.primary} />
              ) : photoPreview ? (
                <>
                  <Image source={{ uri: photoPreview }} style={styles.photoThumb} contentFit="cover" />
                  <Text style={styles.photoBtnText}>Photo attached · tap to change</Text>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={18} color={C.primary} />
                  <Text style={styles.photoBtnText}>Add a progress photo</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.saveBtn, bodySaving && { opacity: 0.6 }]} onPress={saveBodyEntry} disabled={bodySaving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{bodySaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
      </TempoSheet>

      {/* ── Injuries / limitations modal ──────────────────────────────────── */}
      {/* `scroll`: single top-level BottomSheetScrollView — see AddWorkoutSheet for
          why a nested one inside a non-scroll TempoSheet leaves "Save" unreachable
          once the option list plus safe-area padding exceeds the 85% snap point. */}
      <TempoSheet visible={injuryModal} onClose={() => setInjuryModal(false)} snapPoints={['85%']} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Injuries & Limitations</Text>
            <Text style={styles.modalHint}>Tell Tempo what to work around. We'll steer your Quick Workouts away from the muscles and movements that aggravate these areas.</Text>

            <View style={{ gap: Spacing.xs, marginTop: Spacing.sm }}>
              {INJURY_OPTIONS.map((o) => {
                const sel = injurySel.includes(o.id)
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={[styles.equipRow, sel && styles.equipRowSel]}
                    onPress={() => toggleInjury(o.id)}
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

            <TouchableOpacity style={[styles.saveBtn, injurySaving && { opacity: 0.6 }]} onPress={saveInjuries} disabled={injurySaving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{injurySaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
      </TempoSheet>

      {/* ── Edit profile modal ────────────────────────────────────────────── */}
      <TempoSheet visible={editing} onClose={() => setEditing(false)} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
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

            <Text style={styles.modalLabel}>USERNAME</Text>
            <TextInput
              style={styles.modalInput}
              value={usernameInput}
              onChangeText={(v) => setUsernameInput(v.toLowerCase().replace(/[^a-z0-9_@]/g, ''))}
              placeholder="@username"
              placeholderTextColor={C.outline}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={21}
            />

            <Text style={styles.modalLabel}>AVATAR</Text>
            <View style={styles.avatarPickRow}>
              {/* Upload your own photo — reuses the exact same immediate upload +
                  save flow as tapping the hero avatar above. */}
              <TouchableOpacity
                style={[
                  styles.avatarPick, styles.avatarPickCustom,
                  !avatar.imageUri && styles.avatarPickCustomEmpty,
                  avatarId === CUSTOM_AVATAR_ID && styles.avatarPickSel,
                ]}
                onPress={handleAvatarPress}
                disabled={avatarUploading}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={avatar.imageUri ? 'Change your profile photo' : 'Upload a profile photo'}
              >
                {avatarUploading ? (
                  <ActivityIndicator color={C.primary} size="small" />
                ) : avatar.imageUri ? (
                  <Image source={{ uri: avatar.imageUri }} style={styles.avatarPickImg} contentFit="cover" />
                ) : (
                  <Ionicons name="image-outline" size={20} color={C.outline} />
                )}
                <View style={styles.avatarPickCamera}>
                  <Ionicons name="camera" size={10} color="#fff" />
                </View>
              </TouchableOpacity>

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
      </TempoSheet>

      {/* ── Equipment modal ───────────────────────────────────────────────── */}
      {/* `scroll`: see the injuries modal above — same fix, same reason. */}
      <TempoSheet visible={equipModal} onClose={() => setEquipModal(false)} snapPoints={['85%']} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
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
      </TempoSheet>

      {/* ── Swap editor modal ─────────────────────────────────────────────── */}
      <TempoSheet visible={swapModal !== null} onClose={() => setSwapModal(null)}>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Swap {swapModal?.originalName}</Text>
            <Text style={styles.modalHint}>
              Currently doing <Text style={{ color: C.primary, fontFamily: 'Inter_700Bold' }}>{swapModal?.substituteName}</Text> instead.
              Pick a different alternative, or go back to the original.
            </Text>

            {altsLoading ? (
              <View style={{ paddingVertical: Spacing.xl }}><PulseLoader caption="Loading…" /></View>
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
      </TempoSheet>

      <OptionSheet
        visible={changePlanSheet}
        title="Change Plan"
        subtitle="This will replace your current plan."
        options={[{ key: 'continue', label: 'Continue', icon: 'refresh-outline' }]}
        onSelect={() => { setChangePlanSheet(false); router.push('/onboarding/goal') }}
        onClose={() => setChangePlanSheet(false)}
      />

      <OptionSheet
        visible={goalSheet}
        title="Primary Goal"
        subtitle="Updates today — your upcoming sessions re-pick exercises to match."
        options={Object.entries(GOAL_LABELS).map(([key, label]) => ({ key, label, icon: 'trophy-outline' }))}
        onSelect={(key) => saveTrainingField('goal', key)}
        onClose={() => setGoalSheet(false)}
      />

      <OptionSheet
        visible={expSheet}
        title="Experience"
        subtitle="Updates today — your upcoming sessions re-pick exercises to match."
        options={Object.entries(EXP_LABELS).map(([key, label]) => ({ key, label, icon: 'barbell-outline' }))}
        onSelect={(key) => saveTrainingField('experience', key)}
        onClose={() => setExpSheet(false)}
      />

      <OptionSheet
        visible={daysSheet}
        title="Days Per Week"
        subtitle="Just updates your target — your current schedule or split stays exactly as-is."
        options={[2, 3, 4, 5, 6].map((d) => ({ key: String(d), label: `${d} days`, icon: 'calendar-outline' }))}
        onSelect={saveDaysPerWeek}
        onClose={() => setDaysSheet(false)}
      />

      <SaveProgressSheet
        visible={saveSheetVisible}
        context="profile"
        onClose={() => setSaveSheetVisible(false)}
        onLinked={() => { refreshProfile().catch(() => {}) }}
      />
    </ScreenTransition>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  friendBadge: {
    position: 'absolute', top: -4, right: -6, minWidth: 15, height: 15, borderRadius: Radius.full,
    backgroundColor: C.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  friendBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: '#fff' },
  badgeCount: {
    position: 'absolute', top: -4, right: -6, minWidth: 15, height: 15, borderRadius: Radius.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  headerLogo: { fontFamily: C.fontDisplay, fontSize: 16, color: C.primary, letterSpacing: 2 },
  scroll: { paddingBottom: BottomTabInset + 24, gap: Spacing.lg },

  // Hero
  // Dark modular profile card: a layered surface, not a solid colour block.
  hero: {
    marginHorizontal: Spacing.containerPadding,
    backgroundColor: C.surfaceContainer,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: C.glassBorder,
    ...Elevation.e2,
  },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroHeaderInfo: { flex: 1, gap: 3 },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroEditBtn: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  heroAvatarWrap: {},
  avatarLarge: { width: 68, height: 68, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: C.glassBorder },
  avatarImg: { width: '100%', height: '100%' },
  avatarEditBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: Radius.full,
    backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.surfaceContainer,
  },
  displayName: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3, flexShrink: 1 },
  username: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  levelChip: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 5, backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, marginTop: 2 },
  levelChipText: { fontFamily: C.fontDisplay, fontSize: 11, color: C.primary, letterSpacing: 0.4 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.gold, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  proBadgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 9.5, color: '#1b1400', letterSpacing: 0.6 },
  identitySection: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.lg, marginTop: Spacing.md },
  levelBarTrack: { height: 7, alignSelf: 'stretch', backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full },
  levelBarFill: { height: 7, backgroundColor: C.primary, borderRadius: Radius.full },
  levelHint: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },
  // Secondary stats grid inside the card.
  heroStatsGrid: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.sm, marginTop: 2 },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatValue: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.6 },
  heroStatLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, letterSpacing: 0.2 },
  heroStatDivider: { width: 1, height: 28, backgroundColor: C.outlineVariant },

  // Sections
  section: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, letterSpacing: -0.1 },
  sectionSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 2, marginBottom: Spacing.xs, lineHeight: 18 },
  sectionMeta: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline },
  sectionLink: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },

  // Save-your-progress card (guest-only, §1.1)
  saveCard: {
    marginHorizontal: Spacing.containerPadding,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primarySoft, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: C.primary,
  },
  saveIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center' },
  saveTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text, letterSpacing: -0.1 },
  saveBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  // Cards & lists
  card: { backgroundColor: C.background, borderRadius: Radius.xl, ...Elevation.e1, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden' },
  emptyHint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, padding: Spacing.md, lineHeight: 19 },

  // Body stats
  bodyRow: { flexDirection: 'row', alignItems: 'stretch', padding: Spacing.md },
  bodyCell: { flex: 1, gap: 3 },
  bodyCellDivider: { width: 1, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.md },
  bodyCellLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  bodyCellValue: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.5 },
  bodyCellUnit: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary },
  bodyCellSub: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, marginTop: 1 },
  bodyMetricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, marginTop: -Spacing.xs },
  bodyMetric: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, overflow: 'hidden' },
  bodyMetricVal: { fontFamily: 'Inter_700Bold', color: C.text },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 48,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, justifyContent: 'center',
  },
  photoThumb: { width: 32, height: 32, borderRadius: Radius.sm },
  photoBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },

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

  // Modal
  modalSheet: { padding: Spacing.lg, gap: Spacing.sm },
  modalTitle: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3 },
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
  avatarPickCustom: { backgroundColor: C.surfaceContainerHigh, overflow: 'hidden' },
  avatarPickCustomEmpty: { borderWidth: 1.5, borderColor: C.outlineVariant, borderStyle: 'dashed' },
  avatarPickImg: { width: 52, height: 52, borderRadius: Radius.full },
  avatarPickCamera: {
    position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.surface,
  },
  saveBtn: { height: 52, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
